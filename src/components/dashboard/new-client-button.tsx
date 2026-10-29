"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { withoutErrorsUnder } from "@/lib/back-office/form-errors";
import { REQUEST_FAILED } from "@/lib/pro-messages";
import { customerInputSchema } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";
import { createCustomerAction } from "@/server/pro-clients";

const EMAIL_HELP =
  "L'email identifie la fiche : il ne se modifie pas. Si cet email a déjà une fiche, elle s'ouvre et prend le nom saisi.";

/**
 * « Nouveau client »: the check runs in the browser with the schema of the engine, so a bad field is named under its
 * own input and the dialog stays filled when the action fails. An e-mail that already has a record opens that record
 * with the typed name on it (the action answers `created: false`, the help text says so beforehand, and the push carries
 * `?existant=1` for the record page to say so afterwards). Success is `router.push` alone.
 */
export function NewClientButton() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  /** Bumped with each failed call: the effect below puts the focus on the error box once it is rendered. */
  const [errorFocus, setErrorFocus] = useState(0);
  /** Bumped with each refused check: the effect below puts the focus on the first field rendered aria-invalid. */
  const [fieldFocus, setFieldFocus] = useState(0);
  const [pending, startTransition] = useTransition();

  // The submit button is disabled while the call runs, which drops the focus on the page: a keyboard or screen-reader user lands on the message.
  useEffect(() => {
    if (errorFocus > 0) errorBox.current?.focus();
  }, [errorFocus]);
  useEffect(() => {
    if (fieldFocus > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fieldFocus]);

  function openDialog() {
    setName("");
    setEmail("");
    setPhone("");
    setFieldErrors({});
    setError(null);
    setOpen(true);
  }

  function closeDialog() {
    if (!pending) setOpen(false);
  }

  /** An edit drops the message of the field it changed, and the box above the buttons: the next submit validates everything again. */
  function edited(field: "name" | "email" | "phone") {
    setFieldErrors((errors) => withoutErrorsUnder(errors, [field]));
    setError(null);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const parsed = parseFr(customerInputSchema, {
      name,
      email: email.trim(),
      phone: phone.trim() === "" ? undefined : phone,
    });
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      setFieldFocus((n) => n + 1);
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      try {
        const res = await createCustomerAction({
          name: parsed.data.name,
          email: parsed.data.email,
          phone: parsed.data.phone ?? null,
        });
        if (!res.ok) {
          setError(res.error);
          setErrorFocus((n) => n + 1);
          return;
        }
        // An e-mail that already had a record opens it with the typed name: the record page says so (?existant=1).
        router.push(`/dashboard/clients/${res.customerId}${res.created ? "" : "?existant=1"}`);
      } catch {
        setError(REQUEST_FAILED);
        setErrorFocus((n) => n + 1);
      }
    });
  }

  return (
    <>
      <Button onClick={openDialog}>
        <Plus />
        Nouveau client
      </Button>
      <Dialog open={open} onClose={closeDialog} title="Nouveau client">
        <form ref={formRef} method="post" onSubmit={submit} noValidate className="space-y-4">
          {/* FormField wires aria-describedby (helper, then error) and aria-invalid into the input. */}
          <FormField label="Nom" htmlFor="new-client-name" error={fieldErrors.name}>
            <Input
              id="new-client-name"
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
          <FormField label="Email" htmlFor="new-client-email" help={EMAIL_HELP} error={fieldErrors.email}>
            <Input
              id="new-client-email"
              name="email"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                edited("email");
              }}
              autoComplete="off"
            />
          </FormField>
          <FormField label="Téléphone" htmlFor="new-client-phone" optional error={fieldErrors.phone}>
            <Input
              id="new-client-phone"
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
          <FormError message={error} ref={errorBox} tabIndex={-1} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={closeDialog} disabled={pending}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Créer la fiche
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
