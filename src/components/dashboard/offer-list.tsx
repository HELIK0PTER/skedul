"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";

import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { Switch } from "@/components/dashboard/switch";
import { useRefusalFocus } from "@/components/dashboard/use-refusal-focus";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { OfferView } from "@/lib/back-office/catalog-reads";
import { deleteOfferCopy, deleteOfferDoneNotice } from "@/lib/back-office/confirm-copy";
import { errorAfterEdit, OFFER_ERROR_FIELDS } from "@/lib/back-office/form-errors";
import { currencySymbol, plural } from "@/lib/back-office/format";
import {
  EMPTY_OFFER_FORM,
  offerErrorField,
  offerFormFromView,
  offerInputFromForm,
  type OfferField,
  type OfferFormValues,
  type ValidityChoice,
} from "@/lib/back-office/offer-form";
import { callOrFail } from "@/lib/pro-messages";
import { formatMoney } from "@/lib/utils";
import { createOfferAction, deleteOfferAction, setOfferActiveAction, updateOfferAction } from "@/server/pro-catalog";

const QUANTITY_HELP = "Nombre de tickets de l'offre : 1 pour « À l'unité ».";
const PRICE_HELP = "Pas d'offre gratuite : pour donner des tickets, utilisez « Offrir » dans la fiche client.";
const LABEL_HELP = "Laissé vide : « À l'unité » ou « Carnet de N ».";
const VALIDITY_HELP = "Comptée à partir de l'achat ; le ticket reste valable jusqu'à la fin du dernier jour.";

/** The dialog works on one offer by id: « new » or the offer to edit. */
type Editing = { kind: "new" } | { kind: "edit"; offerId: string };

/** « Offres » of a type: rows with the « En vente » switch, add / edit dialog, delete with confirmation, archived offers. */
export function OfferList({
  ticketTypeId,
  offers,
  archivedOffers,
  currency,
  rdvFree,
  typeArchived,
}: {
  ticketTypeId: string;
  offers: OfferView[];
  archivedOffers: OfferView[];
  currency: string;
  rdvFree: boolean;
  typeArchived: boolean;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toggling, startToggle] = useTransition();
  const [deleting, startDelete] = useTransition();

  // The switch answers at once; the page props catch up when the action has revalidated the page.
  const [shownOffers, applyToggle] = useOptimistic(offers, (current, change: { offerId: string; isActive: boolean }) =>
    current.map((o) => (o.id === change.offerId ? { ...o, isActive: change.isActive } : o)),
  );

  // The edit dialog starts from what the pro sees: a switch just flipped is not undone by an edit opened right after.
  const edited = editing?.kind === "edit" ? shownOffers.find((o) => o.id === editing.offerId) : undefined;
  const toDelete = deleteId === null ? undefined : offers.find((o) => o.id === deleteId);

  function onToggle(offerId: string, isActive: boolean) {
    setToggleError(null);
    setNotice(null);
    startToggle(async () => {
      applyToggle({ offerId, isActive });
      const res = await callOrFail(() => setOfferActiveAction({ offerId, isActive }));
      if (!res.ok) setToggleError(res.error);
    });
  }

  function onConfirmDelete(offerId: string) {
    setDeleteError(null);
    startDelete(async () => {
      const res = await callOrFail(() => deleteOfferAction({ offerId }));
      if (!res.ok) {
        setDeleteError(res.error);
        return;
      }
      setDeleteId(null);
      setNotice(deleteOfferDoneNotice({ outcome: res.outcome, sold: (offers.find((o) => o.id === offerId)?.sold ?? 0) > 0 }));
    });
  }

  return (
    <div className="space-y-4">
      {rdvFree && (
        <p className="text-sm text-muted-foreground">Un rendez-vous gratuit ne se vend pas : il n&apos;a pas d&apos;offre.</p>
      )}
      {!rdvFree && offers.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucune offre : ajoutez-en une pour vendre ce type.</p>
      )}

      {shownOffers.length > 0 && (
        <ul className="space-y-3">
          {shownOffers.map((offer) => (
            <li
              key={offer.id}
              className="flex flex-col gap-3 rounded-xl border border-border p-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-medium">{offer.label}</span>
                  <span className="text-sm font-medium tabular-nums">{formatMoney(offer.priceCents, currency)}</span>
                </p>
                <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
                  <span>{plural(offer.quantity, "ticket", "tickets")}</span>
                  <span>{offer.validityText === null ? "Sans limite de validité" : `Validité : ${offer.validityText}`}</span>
                  <span>{plural(offer.sold, "vendue", "vendues")}</span>
                </p>
              </div>
              <div role="group" aria-label={`Offre ${offer.label}`} className="flex flex-wrap items-center gap-3">
                <Switch
                  id={`on-sale-${offer.id}`}
                  checked={offer.isActive}
                  onCheckedChange={(value) => onToggle(offer.id, value)}
                  label="En vente"
                  disabled={typeArchived || toggling || (rdvFree && !offer.isActive)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Modifier l'offre ${offer.label}`}
                  onClick={() => setEditing({ kind: "edit", offerId: offer.id })}
                >
                  Modifier
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10"
                  aria-label={`Supprimer l'offre ${offer.label}`}
                  onClick={() => {
                    setDeleteError(null);
                    setNotice(null);
                    setDeleteId(offer.id);
                  }}
                >
                  Supprimer
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {typeArchived && <p className="text-sm text-muted-foreground">Type archivé : ses offres ne sont pas proposées.</p>}
      <FormError message={toggleError} />
      {/* Always mounted, so a screen reader announces the notice when it appears. */}
      <p role="status" className={notice !== null ? "rounded-lg bg-muted px-3 py-2 text-sm" : "sr-only"}>
        {notice}
      </p>

      {!rdvFree && (
        <Button variant="secondary" disabled={typeArchived} onClick={() => setEditing({ kind: "new" })}>
          <Plus />
          Ajouter une offre
        </Button>
      )}

      {archivedOffers.length > 0 && (
        <details className="rounded-xl border border-border">
          <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Offres archivées ({archivedOffers.length})
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {archivedOffers.map((offer) => (
              <li key={offer.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className="font-medium">{offer.label}</span>
                <span className="flex flex-wrap gap-x-4 text-muted-foreground">
                  <span>{formatMoney(offer.priceCents, currency)}</span>
                  <span>{plural(offer.sold, "vendue", "vendues")}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {editing?.kind === "new" && (
        <OfferDialog
          key="new"
          ticketTypeId={ticketTypeId}
          offerId={null}
          initial={EMPTY_OFFER_FORM}
          currency={currency}
          rdvFree={rdvFree}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.kind === "edit" && edited && (
        <OfferDialog
          key={edited.id}
          ticketTypeId={ticketTypeId}
          offerId={edited.id}
          initial={offerFormFromView(edited)}
          currency={currency}
          rdvFree={rdvFree}
          onClose={() => setEditing(null)}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          open
          copy={deleteOfferCopy({ label: toDelete.label, sold: toDelete.sold > 0, checkedOut: toDelete.purchases > 0 })}
          pending={deleting}
          error={deleteError}
          onConfirm={() => onConfirmDelete(toDelete.id)}
          onClose={() => {
            if (deleting) return;
            setDeleteId(null);
            setDeleteError(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * The « Validité » control: a unit choice and a count. FormField wires the help and
 * the error of the field into it (it forwards both to the controls, as FormField asks).
 */
function ValidityInput({
  id,
  choice,
  count,
  onChoice,
  onCount,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: {
  id: string;
  choice: ValidityChoice;
  count: string;
  onChoice: (value: ValidityChoice) => void;
  onCount: (value: string) => void;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  return (
    <div className="flex gap-2">
      <Select
        id={id}
        value={choice}
        onChange={(e) => onChoice(e.target.value as ValidityChoice)}
        className="min-w-0 flex-1"
        aria-describedby={describedBy}
        aria-invalid={invalid}
      >
        <option value="none">Sans limite</option>
        <option value="day">En jours</option>
        <option value="month">En mois</option>
      </Select>
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={1000}
        step={1}
        aria-label="Durée de validité"
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className="w-28"
        value={count}
        disabled={choice === "none"}
        onChange={(e) => onCount(e.target.value)}
      />
    </div>
  );
}

/**
 * Add / edit dialog. Mounted per opening, so its fields start from the offer as it is when the pro clicks.
 * On an rdv_free type the « En vente » switch is locked (the server refuses an offer en vente there).
 * The form always sends `isActive` (the row's current value when editing): the server reads a missing one as « en vente ».
 */
function OfferDialog({
  ticketTypeId,
  offerId,
  initial,
  currency,
  rdvFree,
  onClose,
}: {
  ticketTypeId: string;
  offerId: string | null;
  initial: OfferFormValues;
  currency: string;
  rdvFree: boolean;
  onClose: () => void;
}) {
  const uid = useId();
  const [values, setValues] = useState<OfferFormValues>(initial);
  const [error, setError] = useState<{ field: OfferField | null; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const { root, errorBox, refused } = useRefusalFocus();

  const set = <K extends keyof OfferFormValues>(key: K, value: OfferFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    // The field that was edited no longer shows its message (and loses its aria-invalid); the next submit checks it again.
    setError((current) => errorAfterEdit(current, OFFER_ERROR_FIELDS[key]));
  };
  const under = (field: OfferField): string | null => (error !== null && error.field === field ? error.message : null);
  const general = error !== null && error.field === null ? error.message : null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const built = offerInputFromForm(ticketTypeId, values);
    if (!built.ok) {
      setError({ field: built.field, message: built.error });
      refused();
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await callOrFail(() =>
        offerId === null ? createOfferAction(built.input) : updateOfferAction({ offerId, offer: built.input }),
      );
      if (!res.ok) {
        setError({ field: offerErrorField(res.error), message: res.error });
        refused();
        return;
      }
      onClose();
    });
  }

  return (
    <Dialog open onClose={() => (pending ? undefined : onClose())} title={offerId === null ? "Nouvelle offre" : "Modifier l'offre"}>
      <form ref={root} method="post" onSubmit={onSubmit} noValidate className="space-y-4">
        {/* FormField wires aria-describedby (helper, then error) and aria-invalid into each control. */}
        <FormField label="Quantité" htmlFor={`${uid}-quantity`} help={QUANTITY_HELP} error={under("quantity")}>
          <Input
            id={`${uid}-quantity`}
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            step={1}
            value={values.quantity}
            onChange={(e) => set("quantity", e.target.value)}
          />
        </FormField>
        <FormField label={`Prix (${currencySymbol(currency)})`} htmlFor={`${uid}-price`} help={PRICE_HELP} error={under("price")}>
          <Input
            id={`${uid}-price`}
            inputMode="decimal"
            autoComplete="off"
            value={values.price}
            onChange={(e) => set("price", e.target.value)}
          />
        </FormField>
        <FormField label="Libellé" htmlFor={`${uid}-label`} optional help={LABEL_HELP} error={under("label")}>
          <Input
            id={`${uid}-label`}
            value={values.label}
            maxLength={80}
            autoComplete="off"
            onChange={(e) => set("label", e.target.value)}
          />
        </FormField>
        <FormField label="Validité" htmlFor={`${uid}-validity`} help={VALIDITY_HELP} error={under("validity")}>
          <ValidityInput
            id={`${uid}-validity`}
            choice={values.validity}
            count={values.validityCount}
            onChoice={(value) => set("validity", value)}
            onCount={(value) => set("validityCount", value)}
          />
        </FormField>
        <Switch
          id={`${uid}-active`}
          checked={values.isActive}
          onCheckedChange={(value) => set("isActive", value)}
          label="En vente"
          description={rdvFree ? "Un rendez-vous gratuit ne se vend pas." : undefined}
          disabled={rdvFree && !initial.isActive}
        />
        <FormError message={general} ref={errorBox} tabIndex={-1} />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Retour
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {offerId === null ? "Ajouter l'offre" : "Enregistrer"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
