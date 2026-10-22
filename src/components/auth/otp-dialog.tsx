"use client";

import { useEffect, useId } from "react";

import { ClientSignInChoices } from "@/components/auth/client-sign-in-choices";
import { EmailCodeForm } from "@/components/auth/email-code-form";
import { Dialog } from "@/components/ui/dialog";
import { COPY } from "@/lib/public/messages";

const FIELD_PREFIX = "otp-dialog";

/**
 * « J'ai déjà des tickets »: the code sign-in in a dialog (spec L1357, L1368-1369). Mount it only for an anonymous
 * visitor (canOfferCodeSignIn, risk 7). The address field is empty and never locked: a personal-link cookie can be
 * planted by someone else, so it never names who signs in (Decision 7). On success the form closes the dialog and
 * refreshes the page; the opener stays on the page, so the dialog gives the focus back to it on its own. Full width
 * below 640 px, with stacked buttons (COV-M13).
 */
export function OtpDialog({
  open,
  onClose,
  returnTo,
  googleEnabled,
}: {
  open: boolean;
  onClose: () => void;
  returnTo: string;
  googleEnabled: boolean;
}) {
  const introId = useId();

  // The panel takes the focus when the dialog opens; the person came to type an address, so the field takes it next
  // (this effect runs after the dialog's own, the form being its child).
  useEffect(() => {
    if (open) document.getElementById(`${FIELD_PREFIX}-email`)?.focus();
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title="Retrouver mes tickets" describedBy={introId}>
      <p id={introId} className="text-sm text-zinc-600">
        {COPY.CODE_INTRO}
      </p>
      <div className="mt-4 space-y-4">
        <EmailCodeForm idPrefix={FIELD_PREFIX} askName onSignedIn={onClose} />
        <ClientSignInChoices returnTo={returnTo} googleEnabled={googleEnabled} />
      </div>
    </Dialog>
  );
}
