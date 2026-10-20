"use client";

import Link from "next/link";
import { createContext, startTransition, useContext, useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, Gift, Loader2 } from "lucide-react";

import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { TypeOption } from "@/lib/back-office/catalog-reads";
import { closeTicketsCopy, retireTicketsCopy } from "@/lib/back-office/confirm-copy";
import { withoutErrorsUnder } from "@/lib/back-office/form-errors";
import { formatCount, plural } from "@/lib/back-office/format";
import { checkClose, checkOffer, countCap, parseCount, type CloseChoice } from "@/lib/back-office/wallet-form";
import type { WalletGroup } from "@/lib/back-office/wallet-view";
import type { DateKey } from "@/lib/civil-date";
import { REQUEST_FAILED } from "@/lib/pro-messages";
import { BOUNDS, CLOSE_REASON_LABELS } from "@/lib/tickets-vocab";
import {
  closeTicketsAction,
  convertTicketsAction,
  offerTicketsAction,
  pointTicketsAction,
  retireTicketsAction,
  unpointTicketsAction,
} from "@/server/pro-clients";

const noop = () => {};

const NO_ACTIVE_TYPE = "Aucun type actif : créez-en un dans";
const NO_OTHER_TYPE = "Aucun autre type actif : créez-en un dans";
const NOTHING_LEFT = "Plus aucun ticket pour cette action : rafraîchissez la page.";
/** An inline link in a note on bg-muted: accent-foreground reads 6.4:1 there (text-primary is about 4.2:1). */
const LINK_CLASS =
  "rounded font-medium text-accent-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type CallResult = { ok: true; count: number } | { ok: false; error: string };

/**
 * One Server Action call at a time. `run` clears the previous error, calls, and on success hands the count to
 * `onSuccess`; on failure the French error of the action (or REQUEST_FAILED when the call itself fails) is kept in
 * `error` and the focus goes to the error box (the submit button was disabled while the call ran, which dropped the
 * focus on the page). The updates that follow the await run in a transition again, so that they commit together with
 * the page the action revalidated and never show the old wallet under a closed dialog. `focusInvalid` puts the focus
 * on the first field rendered aria-invalid once the refused check has been drawn.
 */
function useWalletAction() {
  const formRef = useRef<HTMLFormElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const [pending, startAction] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Bumped with each failed call: the effect below puts the focus on the error box once it is rendered. */
  const [errorFocus, setErrorFocus] = useState(0);
  /** Bumped with each refused check: the effect below puts the focus on the first field rendered aria-invalid. */
  const [fieldFocus, setFieldFocus] = useState(0);

  useEffect(() => {
    if (errorFocus > 0) errorBox.current?.focus();
  }, [errorFocus]);
  useEffect(() => {
    if (fieldFocus > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fieldFocus]);

  function run(call: () => Promise<CallResult>, onSuccess: (count: number) => void) {
    if (pending) return;
    setError(null);
    startAction(async () => {
      let res: CallResult;
      try {
        res = await call();
      } catch {
        res = { ok: false, error: REQUEST_FAILED };
      }
      startTransition(() => {
        if (!res.ok) {
          setError(res.error);
          setErrorFocus((n) => n + 1);
          return;
        }
        onSuccess(res.count);
      });
    });
  }

  return {
    pending,
    error,
    setError,
    formRef,
    errorBox,
    run,
    focusInvalid: () => setFieldFocus((n) => n + 1),
  };
}

function cleanNote(raw: string): string | null {
  const text = raw.trim();
  return text === "" ? null : text;
}

/** The success line. The live region around it (`NoticeRegion`) is always mounted, so that the text is announced when it appears. */
function NoticeRegion({ message }: { message: string | null }) {
  return (
    <div role="status">
      {message && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-foreground wrap-anywhere">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-700" aria-hidden />
          {message}
        </p>
      )}
    </div>
  );
}

function FormFooter({
  onBack,
  pending,
  submitLabel,
  disabled = false,
}: {
  onBack: () => void;
  pending: boolean;
  submitLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2 pt-1">
      <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
        Retour
      </Button>
      <Button type="submit" disabled={pending || disabled}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {submitLabel}
      </Button>
    </div>
  );
}

/** « Nombre », 1 to `max`. A change drops the message of the field (the next submit checks again). */
function QuantityField({
  id,
  value,
  max,
  error,
  autoFocus,
  onChange,
}: {
  id: string;
  value: string;
  max: number;
  error: string | undefined;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  const help = max < 1 ? NOTHING_LEFT : max > 1 ? `Entre 1 et ${formatCount(max)}.` : undefined;
  return (
    <FormField label="Nombre" htmlFor={id} error={error} help={help}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={Math.max(max, 1)}
        step={1}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormField>
  );
}

/* ───────────────────────────── Offrir des tickets ───────────────────────────── */

type OfferScope = {
  open: () => void;
  notice: string | null;
  /** Set by a success: the trigger that is on screen then takes the focus if it fell on the page. */
  armedRef: React.MutableRefObject<boolean>;
};

const OfferContext = createContext<OfferScope | null>(null);

function useOfferScope(): OfferScope {
  const scope = useContext(OfferContext);
  if (scope === null) throw new Error("OfferTicketsButton and OfferNotice belong inside OfferTicketsProvider.");
  return scope;
}

/**
 * The offer of the wallet card, owned once: the open state, the success line and the ONE dialog live here, whichever
 * trigger opened it. The card header shows the trigger when the wallet holds tickets, the empty state shows it when it
 * does not; the two never exist together, and the line (an always-mounted status region, `OfferNotice`) stays in the
 * header, so that the first offer of an empty wallet is announced even though the empty state is gone by then.
 */
export function OfferTicketsProvider({
  customerId,
  typeOptions,
  todayKey,
  children,
}: {
  customerId: string;
  typeOptions: TypeOption[];
  todayKey: DateKey;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const armedRef = useRef(false);

  // The focus rescue is for the moment right after a success only: the next click or key press of the user ends it,
  // so a later render never takes the focus away from where the user put it.
  useEffect(() => {
    const disarm = () => {
      armedRef.current = false;
    };
    document.addEventListener("pointerdown", disarm, true);
    document.addEventListener("keydown", disarm, true);
    return () => {
      document.removeEventListener("pointerdown", disarm, true);
      document.removeEventListener("keydown", disarm, true);
    };
  }, []);

  const scope: OfferScope = {
    open: () => {
      setNotice(null);
      setOpen(true);
    },
    notice,
    armedRef,
  };

  return (
    <OfferContext.Provider value={scope}>
      {children}
      {open && (
        <OfferDialog
          customerId={customerId}
          typeOptions={typeOptions}
          todayKey={todayKey}
          onClose={() => setOpen(false)}
          onDone={(message) => {
            armedRef.current = true;
            setOpen(false);
            setNotice(message);
          }}
        />
      )}
    </OfferContext.Provider>
  );
}

/** The success line of the offer: its status region is always mounted, in the card header. */
export function OfferNotice() {
  return <NoticeRegion message={useOfferScope().notice} />;
}

/**
 * Opens the offer dialog of the enclosing OfferTicketsProvider. Only one is on screen at a time. The dialog hands the
 * focus back to the button that opened it; when that button is gone after a success (the empty state is replaced by
 * the header trigger as the first group appears) and the focus fell on the page, the trigger that is on screen takes it.
 */
export function OfferTicketsButton() {
  const { open, armedRef } = useOfferScope();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!armedRef.current) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    armedRef.current = false;
    button.current?.focus();
  });

  return (
    <Button ref={button} type="button" size="sm" onClick={open}>
      <Gift aria-hidden />
      Offrir des tickets
    </Button>
  );
}

function OfferDialog({
  customerId,
  typeOptions,
  todayKey,
  onClose,
  onDone,
}: {
  customerId: string;
  typeOptions: TypeOption[];
  todayKey: DateKey;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  // A « Gratuit » (rdv_free) type holds no tickets: the core refuses to offer it, so it is not proposed.
  const options = typeOptions.filter((t) => !t.rdvFree);
  const [typeId, setTypeId] = useState(options[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [validity, setValidity] = useState<"none" | "until">("none");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, error, setError, formRef, errorBox, run, focusInvalid } = useWalletAction();

  // The list can change while the dialog is open (a type archived elsewhere).
  const selectedType = options.some((t) => t.id === typeId) ? typeId : (options[0]?.id ?? "");

  /** An edit drops the message of the field it changed, and the box above the buttons: the next submit checks again. */
  function edited(field: "quantity" | "until") {
    setErrors((current) => withoutErrorsUnder(current, [field]));
    setError(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || selectedType === "") return;
    const checked = checkOffer({ quantity, validity, until }, todayKey);
    if (!checked.ok) {
      setErrors(checked.errors);
      focusInvalid();
      return;
    }
    setErrors({});
    run(
      () =>
        offerTicketsAction({
          customerId,
          ticketTypeId: selectedType,
          quantity: checked.quantity,
          lastValidDay: checked.lastValidDay,
          reason: cleanNote(reason),
          notify,
        }),
      (count) => onDone(`${plural(count, "ticket offert", "tickets offerts")}.`),
    );
  }

  return (
    <Dialog open onClose={pending ? noop : onClose} title="Offrir des tickets">
      <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-4">
        {options.length === 0 ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-zinc-600">
            {NO_ACTIVE_TYPE}{" "}
            <Link href="/dashboard/tickets" className={LINK_CLASS}>
              Tickets
            </Link>
            .
          </p>
        ) : (
          <FormField label="Type" htmlFor="offer-type">
            <Select
              id="offer-type"
              value={selectedType}
              autoFocus
              onChange={(e) => {
                setTypeId(e.target.value);
                setError(null);
              }}
            >
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        <FormField label="Quantité" htmlFor="offer-quantity" error={errors.quantity}>
          <Input
            id="offer-quantity"
            type="number"
            inputMode="numeric"
            min={1}
            max={BOUNDS.walletQuantity}
            step={1}
            value={quantity}
            onChange={(e) => {
              setQuantity(e.target.value);
              edited("quantity");
            }}
          />
        </FormField>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Validité</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="offer-validity"
              className="size-4 accent-primary"
              checked={validity === "none"}
              onChange={() => {
                setValidity("none");
                edited("until");
              }}
            />
            Sans limite
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="offer-validity"
                className="size-4 accent-primary"
                checked={validity === "until"}
                onChange={() => setValidity("until")}
              />
              {"Jusqu'au"}
            </label>
            <Input
              id="offer-until"
              type="date"
              aria-label="Dernier jour de validité"
              aria-invalid={errors.until ? true : undefined}
              aria-describedby={errors.until ? "offer-until-error" : undefined}
              min={todayKey}
              value={until}
              onChange={(e) => {
                setUntil(e.target.value);
                setValidity("until");
                edited("until");
              }}
              className="w-auto"
            />
          </div>
          {errors.until && (
            <p id="offer-until-error" role="alert" className="text-xs text-rose-700">
              {errors.until}
            </p>
          )}
        </fieldset>

        <FormField label="Motif" htmlFor="offer-reason" optional>
          <Input
            id="offer-reason"
            maxLength={BOUNDS.note}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
          />
        </FormField>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          Prévenir le client par email
        </label>

        <FormError message={error} ref={errorBox} tabIndex={-1} />
        <FormFooter onBack={onClose} pending={pending} submitLabel="Offrir" disabled={options.length === 0} />
      </form>
    </Dialog>
  );
}

/* ───────────────────────────── Actions d'un groupe ───────────────────────────── */

type DialogKind = "point" | "unpoint" | "convert" | "close" | "retire";

type GroupDialogProps = {
  customerId: string;
  groupName: string;
  onClose: () => void;
  onDone: (message: string) => void;
};

export function WalletGroupActions({
  customerId,
  group,
  typeOptions,
}: {
  customerId: string;
  group: { ticketTypeId: string; name: string; ids: WalletGroup["ids"] };
  typeOptions: TypeOption[];
}) {
  const [open, setOpen] = useState<DialogKind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Bumped when an action succeeded: the effect below keeps the keyboard focus in the block if its button is gone. */
  const [doneCount, setDoneCount] = useState(0);
  /** Armed by a success, consumed once when the rescue below runs: a later change of the buttons never moves the focus again. */
  const rescueArmed = useRef(false);
  const block = useRef<HTMLDivElement>(null);
  const { ids } = group;

  const buttons: { kind: DialogKind; label: string; available: number }[] = [
    { kind: "point", label: "Pointer", available: ids.point.length },
    { kind: "unpoint", label: "Annuler le pointage", available: ids.unpoint.length },
    { kind: "convert", label: "Convertir", available: ids.convert.length },
    { kind: "close", label: "Clore", available: ids.closeAny.length },
    { kind: "retire", label: "Retirer", available: ids.retire.length },
  ];
  const visible = buttons.filter((b) => b.available > 0);
  const visibleKinds = visible.map((b) => b.kind).join();

  // The dialog hands the focus back to the button that opened it. When that button is gone (the last pointed ticket
  // was just un-pointed, so « Annuler le pointage » left), the focus fell on the page: it goes to the first button
  // left in the block, or to the block itself, once. The check runs again when the buttons change while armed, as the
  // new page may arrive after the dialog closed; opening a dialog again disarms it.
  useEffect(() => {
    if (!rescueArmed.current) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    rescueArmed.current = false;
    const el = block.current;
    (el?.querySelector<HTMLElement>("button") ?? el)?.focus();
  }, [doneCount, visibleKinds]);

  // A group with nothing to do and nothing to say draws nothing. Once it has said something (the last ticket was
  // just closed) the block stays, so that the status region that holds the line was mounted before the line came.
  if (visible.length === 0 && notice === null) return null;

  const common = {
    customerId,
    groupName: group.name,
    onClose: () => setOpen(null),
    onDone: (message: string) => {
      rescueArmed.current = true;
      setOpen(null);
      setNotice(message);
      setDoneCount((n) => n + 1);
    },
  };

  return (
    <div ref={block} tabIndex={-1} className="mt-3 border-t border-border pt-3 outline-none">
      {visible.length > 0 && (
        <div role="group" aria-label={`Actions sur les tickets « ${group.name} »`} className="flex flex-wrap gap-2">
          {visible.map((b) => (
            <Button
              key={b.kind}
              type="button"
              size="sm"
              variant="secondary"
              aria-label={`${b.label} ${group.name}`}
              onClick={() => {
                rescueArmed.current = false;
                setNotice(null);
                setOpen(b.kind);
              }}
            >
              {b.label}
            </Button>
          ))}
        </div>
      )}
      <NoticeRegion message={notice} />
      {open === "point" && <PointDialog {...common} ids={ids.point} />}
      {open === "unpoint" && <UnpointDialog {...common} ids={ids.unpoint} />}
      {open === "convert" && (
        <ConvertDialog {...common} ids={ids.convert} fromTypeId={group.ticketTypeId} typeOptions={typeOptions} />
      )}
      {open === "close" && <CloseDialog {...common} ids={ids} />}
      {open === "retire" && <RetireDialog {...common} ids={ids.retire} />}
    </div>
  );
}

function PointDialog({ customerId, groupName, ids, onClose, onDone }: GroupDialogProps & { ids: string[] }) {
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [quantityError, setQuantityError] = useState<string | undefined>(undefined);
  const { pending, error, setError, formRef, errorBox, run, focusInvalid } = useWalletAction();
  const max = countCap(ids.length);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const count = parseCount(quantity, max);
    if (!count.ok) {
      setQuantityError(count.error);
      focusInvalid();
      return;
    }
    run(
      () => pointTicketsAction({ customerId, ticketIds: ids.slice(0, count.count), note: cleanNote(note) }),
      (done) => onDone(`${plural(done, "ticket pointé", "tickets pointés")}.`),
    );
  }

  return (
    <Dialog open onClose={pending ? noop : onClose} title={`Pointer des tickets « ${groupName} »`}>
      <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-4">
        <p className="text-sm text-zinc-600">Le ticket est consommé sur place, sans inscription.</p>
        <QuantityField
          id="point-quantity"
          value={quantity}
          max={max}
          error={quantityError}
          autoFocus
          onChange={(value) => {
            setQuantity(value);
            setQuantityError(undefined);
            setError(null);
          }}
        />
        <FormField label="Note" htmlFor="point-note" optional>
          <Input
            id="point-note"
            maxLength={BOUNDS.note}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setError(null);
            }}
          />
        </FormField>
        <FormError message={error} ref={errorBox} tabIndex={-1} />
        <FormFooter onBack={onClose} pending={pending} submitLabel="Pointer" disabled={ids.length === 0} />
      </form>
    </Dialog>
  );
}

function UnpointDialog({ customerId, groupName, ids, onClose, onDone }: GroupDialogProps & { ids: string[] }) {
  const [quantity, setQuantity] = useState("1");
  const [quantityError, setQuantityError] = useState<string | undefined>(undefined);
  const { pending, error, setError, formRef, errorBox, run, focusInvalid } = useWalletAction();
  const max = countCap(ids.length);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const count = parseCount(quantity, max);
    if (!count.ok) {
      setQuantityError(count.error);
      focusInvalid();
      return;
    }
    run(
      () => unpointTicketsAction({ customerId, ticketIds: ids.slice(0, count.count) }),
      (done) => onDone(`Pointage annulé : ${plural(done, "ticket", "tickets")}.`),
    );
  }

  return (
    <Dialog open onClose={pending ? noop : onClose} title={`Annuler le pointage « ${groupName} »`}>
      <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-4">
        <p className="text-sm text-zinc-600">
          Les derniers tickets pointés redeviennent disponibles, ou expirés si leur date est passée.
        </p>
        <QuantityField
          id="unpoint-quantity"
          value={quantity}
          max={max}
          error={quantityError}
          autoFocus
          onChange={(value) => {
            setQuantity(value);
            setQuantityError(undefined);
            setError(null);
          }}
        />
        <FormError message={error} ref={errorBox} tabIndex={-1} />
        <FormFooter onBack={onClose} pending={pending} submitLabel="Annuler le pointage" disabled={ids.length === 0} />
      </form>
    </Dialog>
  );
}

function ConvertDialog({
  customerId,
  groupName,
  ids,
  fromTypeId,
  typeOptions,
  onClose,
  onDone,
}: GroupDialogProps & { ids: string[]; fromTypeId: string; typeOptions: TypeOption[] }) {
  // The core converts to an active type that holds tickets (not « Gratuit »); the type of the group is no target.
  const targets = typeOptions.filter((t) => !t.rdvFree && t.id !== fromTypeId);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [quantityError, setQuantityError] = useState<string | undefined>(undefined);
  const { pending, error, setError, formRef, errorBox, run, focusInvalid } = useWalletAction();

  const target = targets.find((t) => t.id === targetId) ?? targets[0] ?? null;
  const max = countCap(ids.length);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || target === null) return;
    const count = parseCount(quantity, max);
    if (!count.ok) {
      setQuantityError(count.error);
      focusInvalid();
      return;
    }
    run(
      () => convertTicketsAction({ customerId, ticketIds: ids.slice(0, count.count), toTicketTypeId: target.id }),
      (done) => onDone(`${plural(done, "ticket converti", "tickets convertis")} en « ${target.name} ».`),
    );
  }

  return (
    <Dialog open onClose={pending ? noop : onClose} title={`Convertir des tickets « ${groupName} »`}>
      <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-4">
        {target === null ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm text-zinc-600">
            {NO_OTHER_TYPE}{" "}
            <Link href="/dashboard/tickets" className={LINK_CLASS}>
              Tickets
            </Link>
            .
          </p>
        ) : (
          <FormField label="Vers le type" htmlFor="convert-target">
            <Select
              id="convert-target"
              value={target.id}
              autoFocus
              onChange={(e) => {
                setTargetId(e.target.value);
                setError(null);
              }}
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <p className="text-sm text-zinc-600">Ils gardent leur statut (payé ou offert) et leur date de validité.</p>
        <QuantityField
          id="convert-quantity"
          value={quantity}
          max={max}
          error={quantityError}
          onChange={(value) => {
            setQuantity(value);
            setQuantityError(undefined);
            setError(null);
          }}
        />
        <FormError message={error} ref={errorBox} tabIndex={-1} />
        <FormFooter
          onBack={onClose}
          pending={pending}
          submitLabel="Convertir"
          disabled={target === null || ids.length === 0}
        />
      </form>
    </Dialog>
  );
}

/**
 * « Clore » and « Retirer » ask twice: the form, then the confirmation with the consequences. The confirmation opens
 * ON TOP of the form, which stays mounted: « Retour » in the confirmation hands the focus back to the button that
 * opened it, the form keeps what was typed, and the form's own Escape / backdrop / X are muted meanwhile, so one Escape
 * closes only the confirmation. What the confirmation says is what it sends: the ticket ids, the reason and the note
 * are frozen when it opens, so a new page behind it can neither change the count it shows nor make « Clore » do nothing.
 */
type CloseConfirm = { ids: string[]; reason: CloseChoice; note: string | null };
function CloseDialog({ customerId, groupName, ids, onClose, onDone }: GroupDialogProps & { ids: WalletGroup["ids"] }) {
  const hasPaid = ids.closePaid.length > 0;
  const [reason, setReason] = useState<CloseChoice>(hasPaid ? "rembourse" : "autre");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<CloseConfirm | null>(null);
  const { pending, error, setError, formRef, run, focusInvalid } = useWalletAction();

  // « Remboursé » and « Compensé » concern paid tickets only; « Autre » any usable ticket.
  const pool = reason === "autre" ? ids.closeAny : ids.closePaid;
  const max = countCap(pool.length);

  function chooseReason(next: CloseChoice) {
    setReason(next);
    // The pool changes with the reason: what was said about the quantity or the note may no longer hold.
    setErrors({});
  }

  function onReview(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const checked = checkClose({ quantity, reason, note }, max);
    if (!checked.ok) {
      setErrors(checked.errors);
      focusInvalid();
      return;
    }
    setErrors({});
    setConfirming({ ids: pool.slice(0, checked.count), reason, note: cleanNote(note) });
  }

  function onConfirm() {
    if (confirming === null) return;
    run(
      () =>
        closeTicketsAction({
          customerId,
          ticketIds: confirming.ids,
          reason: confirming.reason,
          note: confirming.note,
        }),
      (done) => onDone(`${plural(done, "ticket clos", "tickets clos")}.`),
    );
  }

  return (
    <>
      <Dialog open onClose={confirming !== null ? noop : onClose} title={`Clore des tickets « ${groupName} »`}>
        <form ref={formRef} onSubmit={onReview} noValidate className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Motif</legend>
            {hasPaid && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="close-reason"
                    className="size-4 accent-primary"
                    checked={reason === "rembourse"}
                    onChange={() => chooseReason("rembourse")}
                  />
                  {CLOSE_REASON_LABELS.rembourse}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="close-reason"
                    className="size-4 accent-primary"
                    checked={reason === "compense"}
                    onChange={() => chooseReason("compense")}
                  />
                  {CLOSE_REASON_LABELS.compense}
                </label>
              </>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="close-reason"
                className="size-4 accent-primary"
                checked={reason === "autre"}
                onChange={() => chooseReason("autre")}
              />
              {CLOSE_REASON_LABELS.autre}
            </label>
          </fieldset>
          <QuantityField
            id="close-quantity"
            value={quantity}
            max={max}
            error={errors.quantity}
            onChange={(value) => {
              setQuantity(value);
              setErrors((current) => withoutErrorsUnder(current, ["quantity"]));
            }}
          />
          <FormField
            label="Note"
            htmlFor="close-note"
            optional={reason !== "autre"}
            help={reason === "autre" ? "Obligatoire avec ce motif." : undefined}
            error={errors.note}
          >
            <Input
              id="close-note"
              maxLength={BOUNDS.note}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setErrors((current) => withoutErrorsUnder(current, ["note"]));
              }}
            />
          </FormField>
          <FormFooter onBack={onClose} pending={false} submitLabel="Clore" disabled={pool.length === 0} />
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirming !== null}
        copy={closeTicketsCopy({
          count: confirming?.ids.length ?? 0,
          reasonLabel: CLOSE_REASON_LABELS[confirming?.reason ?? reason],
        })}
        pending={pending}
        error={error}
        onConfirm={onConfirm}
        onClose={() => {
          setError(null);
          setConfirming(null);
        }}
      />
    </>
  );
}

type RetireConfirm = { ids: string[]; note: string | null };

function RetireDialog({ customerId, groupName, ids, onClose, onDone }: GroupDialogProps & { ids: string[] }) {
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [quantityError, setQuantityError] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState<RetireConfirm | null>(null);
  const { pending, error, setError, formRef, run, focusInvalid } = useWalletAction();
  const max = countCap(ids.length);

  function onReview(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const checked = parseCount(quantity, max);
    if (!checked.ok) {
      setQuantityError(checked.error);
      focusInvalid();
      return;
    }
    setQuantityError(undefined);
    setConfirming({ ids: ids.slice(0, checked.count), note: cleanNote(note) });
  }

  function onConfirm() {
    if (confirming === null) return;
    run(
      () => retireTicketsAction({ customerId, ticketIds: confirming.ids, note: confirming.note }),
      (done) => onDone(`${plural(done, "ticket retiré", "tickets retirés")}.`),
    );
  }

  return (
    <>
      <Dialog open onClose={confirming !== null ? noop : onClose} title={`Retirer des tickets « ${groupName} »`}>
        <form ref={formRef} onSubmit={onReview} noValidate className="space-y-4">
          <p className="text-sm text-zinc-600">Seuls les tickets offerts peuvent être retirés.</p>
          <QuantityField
            id="retire-quantity"
            value={quantity}
            max={max}
            error={quantityError}
            autoFocus
            onChange={(value) => {
              setQuantity(value);
              setQuantityError(undefined);
            }}
          />
          <FormField label="Note" htmlFor="retire-note" optional>
            <Input id="retire-note" maxLength={BOUNDS.note} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          <FormFooter onBack={onClose} pending={false} submitLabel="Retirer" disabled={ids.length === 0} />
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirming !== null}
        copy={retireTicketsCopy({ count: confirming?.ids.length ?? 0 })}
        pending={pending}
        error={error}
        onConfirm={onConfirm}
        onClose={() => {
          setError(null);
          setConfirming(null);
        }}
      />
    </>
  );
}
