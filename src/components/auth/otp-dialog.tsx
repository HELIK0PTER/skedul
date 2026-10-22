"use client";

import { useCallback, useEffect, useId, useRef } from "react";

import { ClientSignInChoices } from "@/components/auth/client-sign-in-choices";
import { EmailCodeForm } from "@/components/auth/email-code-form";
import { Dialog } from "@/components/ui/dialog";
import { COPY } from "@/lib/public/messages";
import { focusTargetOnClose } from "@/lib/public/sign-in-flow";

/**
 * « J'ai déjà des tickets »: the code sign-in in a dialog (spec L1357, L1368-1369). Mount it only for an anonymous
 * visitor (canOfferCodeSignIn, risk 7). The address field is empty and never locked: a personal-link cookie can be
 * planted by someone else, so it never names who signs in (Decision 7). On success the form closes the dialog and
 * refreshes the page.
 *
 * Focus when it closes: without a sign-in (Escape, « Fermer ») the focus goes back to the control that opened the
 * dialog, as `Dialog` does. After a sign-in that control is usually gone, so a caller passes `returnFocusTo`, an element
 * that exists in every state and that the refresh does not swap (a heading outside the component that changes), with a
 * stable identity (useCallback), like `Dialog` asks; it is asked after a sign-in only. The field ids come from
 * `useId`, so two dialogs on one page (the séance page mounts two) never share one. Full width below 640 px, with
 * stacked buttons (COV-M13).
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
  // A ref, not a state: `Dialog` reads its target in the cleanup of the render that closes it, a closure of the render
  // before, which would still hold the old value of a state set in the same batch as the close.
  const signedIn = useRef(false);

  // The panel takes the focus when the dialog opens; the person came to type an address, so the field takes it next
  // (this effect runs after the dialog's own, the form being its child).
  useEffect(() => {
    if (open) document.getElementById(`${fieldPrefix}-email`)?.focus();
  }, [open, fieldPrefix]);

  // A new opening starts without a sign-in.
  useEffect(() => {
    if (open) signedIn.current = false;
  }, [open]);

  const focusAfterClose = useCallback(() => focusTargetOnClose(signedIn.current, returnFocusTo), [returnFocusTo]);

  function signedInThenClose() {
    signedIn.current = true;
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Retrouver mes tickets" describedBy={introId} returnFocusTo={focusAfterClose}>
      <p id={introId} className="text-sm text-zinc-600">
        {COPY.CODE_INTRO}
      </p>
      <div className="mt-4 space-y-4">
        <EmailCodeForm idPrefix={fieldPrefix} askName onSignedIn={signedInThenClose} />
        <ClientSignInChoices returnTo={returnTo} googleEnabled={googleEnabled} />
      </div>
    </Dialog>
  );
}
