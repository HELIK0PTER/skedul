"use client";

import { startTransition, useEffect, useRef, useState, useTransition } from "react";
import { Check, Loader2, Pencil, Unlink } from "lucide-react";

import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { revokeLinksCopy, revokeLinksDoneNotice } from "@/lib/back-office/confirm-copy";
import { withoutErrorsUnder } from "@/lib/back-office/form-errors";
import { REQUEST_FAILED } from "@/lib/pro-messages";
import { customerInputSchema } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";
import { revokeLinksAction, updateCustomerAction } from "@/server/pro-clients";

const EMAIL_HELP = "L'email identifie la fiche : il ne se modifie pas.";

/** The name and phone rules of the engine's updateCustomer (the e-mail is the key of the record and never changes). */
const editSchema = customerInputSchema.pick({ name: true, phone: true });

type HeaderCustomer = { id: string; name: string; email: string; phone: string | null; linkedAccount: boolean };

/**
 * « Fiche »: name, e-mail, phone and linked account of the client, with « Modifier » (name and phone) and
 * « Déconnecter ses liens ». The form is filled from the CURRENT props each time it opens, the actions read
 * `customer.id` when they run, and the page is never refreshed by hand: the actions revalidate the dashboard layout and
 * Next brings the new props. A refused check names the field under its input (and clears with the next edit of that
 * field); a failed call lands in the error box, which takes the focus.
 */
export function ClientHeader({ customer }: { customer: HeaderCustomer }) {
  const formRef = useRef<HTMLFormElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState<string | null>(null);
  /** Bumped with each failed call: the effect below puts the focus on the error box once it is rendered. */
  const [errorFocus, setErrorFocus] = useState(0);
  /** Bumped with each refused check: the effect below puts the focus on the first field rendered aria-invalid. */
  const [fieldFocus, setFieldFocus] = useState(0);
  /** Bumped when the form closes: the focus goes back to « Modifier » (the button that held it is gone). */
  const [returnFocus, setReturnFocus] = useState(0);
  const [saving, startSave] = useTransition();
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revoking, startRevoke] = useTransition();

  // The save button is disabled while the call runs, which drops the focus on the page: a keyboard or screen-reader user lands on the message.
  useEffect(() => {
    if (errorFocus > 0) errorBox.current?.focus();
  }, [errorFocus]);
  useEffect(() => {
    if (fieldFocus > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fieldFocus]);
  useEffect(() => {
    if (returnFocus > 0) editButton.current?.focus();
  }, [returnFocus]);

  function startEditing() {
    setName(customer.name);
    setPhone(customer.phone ?? "");
    setFieldErrors({});
    setEditError(null);
    setNotice(null);
    setEditing(true);
  }

  function stopEditing() {
    setEditing(false);
    setReturnFocus((n) => n + 1);
  }

  /** An edit drops the message of the field it changed, and the box above the buttons: the next submit validates everything again. */
  function edited(field: "name" | "phone") {
    setFieldErrors((errors) => withoutErrorsUnder(errors, [field]));
    setEditError(null);
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    setEditError(null);
    const parsed = parseFr(editSchema, { name, phone: phone.trim() === "" ? undefined : phone });
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      setFieldFocus((n) => n + 1);
      return;
    }
    setFieldErrors({});
    startSave(async () => {
      let res: Awaited<ReturnType<typeof updateCustomerAction>>;
      try {
        res = await updateCustomerAction({
          customerId: customer.id,
          name: parsed.data.name,
          phone: parsed.data.phone ?? null,
        });
      } catch {
        res = { ok: false, error: REQUEST_FAILED };
      }
      // After an await the updates leave the transition: wrapped again, they commit together with the new props.
      startTransition(() => {
        if (!res.ok) {
          setEditError(res.error);
          setErrorFocus((n) => n + 1);
          return;
        }
        setNotice("Fiche enregistrée.");
        stopEditing();
      });
    });
  }

  function openRevoke() {
    setRevokeError(null);
    setNotice(null);
    setRevokeOpen(true);
  }

  function confirmRevoke() {
    startRevoke(async () => {
      let res: Awaited<ReturnType<typeof revokeLinksAction>>;
      try {
        res = await revokeLinksAction({ customerId: customer.id });
      } catch {
        res = { ok: false, error: REQUEST_FAILED };
      }
      startTransition(() => {
        if (!res.ok) {
          setRevokeError(res.error);
          return;
        }
        setRevokeOpen(false);
        setNotice(revokeLinksDoneNotice({ linkedAccount: customer.linkedAccount }));
      });
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fiche</CardTitle>
      </CardHeader>
      <CardContent>
        {editing ? (
          <form ref={formRef} onSubmit={save} noValidate className="space-y-4">
            {/* FormField wires aria-describedby and aria-invalid into the input. */}
            <FormField label="Nom" htmlFor="client-name" error={fieldErrors.name}>
              <Input
                id="client-name"
                name="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  edited("name");
                }}
                autoComplete="off"
                autoFocus
              />
            </FormField>
            <FormField label="Téléphone" htmlFor="client-phone" optional error={fieldErrors.phone}>
              <Input
                id="client-phone"
                name="phone"
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  edited("phone");
                }}
                autoComplete="off"
              />
            </FormField>
            <div className="space-y-1">
              <p className="text-sm font-medium">Email</p>
              <p className="text-sm text-zinc-600 wrap-anywhere">{customer.email}</p>
              <p className="text-xs text-zinc-600">{EMAIL_HELP}</p>
            </div>
            <FormError message={editError} ref={errorBox} tabIndex={-1} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={saving}>
                {saving && <Loader2 className="animate-spin" />}
                Enregistrer
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={stopEditing} disabled={saving}>
                Annuler
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="min-w-0 space-y-0.5">
              <p className="font-semibold wrap-anywhere">{customer.name}</p>
              <p className="text-sm text-zinc-600 wrap-anywhere">{customer.email}</p>
              <p className="text-sm text-zinc-600 wrap-anywhere">{customer.phone ?? "Pas de téléphone"}</p>
            </div>
            <Badge variant={customer.linkedAccount ? "success" : "neutral"}>
              {customer.linkedAccount ? "Compte client lié" : "Pas de compte client"}
            </Badge>
            <div className="flex flex-wrap gap-2">
              <Button ref={editButton} type="button" variant="secondary" size="sm" onClick={startEditing}>
                <Pencil />
                Modifier
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={openRevoke}>
                <Unlink />
                Déconnecter ses liens
              </Button>
            </div>
          </div>
        )}
        {/* Always mounted, so that a screen reader announces the text when it appears. */}
        <div role="status">
          {notice && (
            <p className="mt-4 flex items-center gap-2 rounded-xl bg-success-muted px-3 py-2 text-sm text-foreground">
              <Check className="size-4 shrink-0 text-green-700" aria-hidden="true" />
              {notice}
            </p>
          )}
        </div>
      </CardContent>

      <ConfirmDialog
        open={revokeOpen}
        copy={revokeLinksCopy({ name: customer.name })}
        pending={revoking}
        error={revokeError}
        onConfirm={confirmRevoke}
        onClose={() => {
          if (!revoking) setRevokeOpen(false);
        }}
      />
    </Card>
  );
}
