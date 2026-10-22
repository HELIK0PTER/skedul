"use client";

import { useEffect, useId } from "react";

import { ClientSignInChoices } from "@/components/auth/client-sign-in-choices";
import { EmailCodeForm } from "@/components/auth/email-code-form";
import { Dialog } from "@/components/ui/dialog";
import { COPY } from "@/lib/public/messages";

/**
 * « J'ai déjà des tickets »: the code sign-in in a dialog (spec L1357, L1368-1369). Mount it only for an anonymous
 * visitor (canOfferCodeSignIn, risk 7). The address field is empty and never locked: a personal-link cookie can be
 * planted by someone else, so it never names who signs in (Decision 7). On success the form closes the dialog and
 * refreshes the page. The dialog gives the focus back to its opener on its own; a caller whose opener goes away once
 * the visitor is signed in (the anonymous controls become « Mon espace ») passes `returnFocusTo`, a heading that exists
 * in both states, with a stable identity (useCallback), like `Dialog` asks. The field ids come from `useId`, so two
 * dialogs on one page (the séance page mounts two) never share one. Full width below 640 px, with stacked buttons
 * (COV-M13).
 */
export function OtpDialog({
  open,
  onClose,
  returnTo,
  googleEnabled,
  returnFocusTo,
}: {
  open: boolean;
  onClose: () => void;
  returnTo: string;
  googleEnabled: boolean;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const introId = useId();
  const fieldPrefix = useId();

  // The panel takes the focus when the dialog opens; the person came to type an address, so the field takes it next
  // (this effect runs after the dialog's own, the form being its child).
  useEffect(() => {
    if (open) document.getElementById(`${fieldPrefix}-email`)?.focus();
  }, [open, fieldPrefix]);

  return (
    <Dialog open={open} onClose={onClose} title="Retrouver mes tickets" describedBy={introId} returnFocusTo={returnFocusTo}>
      <p id={introId} className="text-sm text-zinc-600">
        {COPY.CODE_INTRO}
      </p>
      <div className="mt-4 space-y-4">
        <EmailCodeForm idPrefix={fieldPrefix} askName onSignedIn={onClose} />
        <ClientSignInChoices returnTo={returnTo} googleEnabled={googleEnabled} />
      </div>
    </Dialog>
  );
}
