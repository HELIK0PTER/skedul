"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2, Mail } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const SENT = "Si l'adresse est valide, un code a été envoyé.";
const RATE_LIMITED = "Trop de demandes. Réessayez dans quelques minutes.";
const WRONG_CODE = "Code incorrect ou expiré.";
const SEND_FAILED = "L'envoi a échoué. Réessayez dans un instant.";
const VERIFY_FAILED = "La vérification a échoué. Réessayez dans un instant.";
const CODE_FORMAT = "Saisissez les 6 chiffres du code.";

/**
 * « Confirmez votre adresse »: the e-mail code flow of an unverified pro account (spec § 12).
 *
 * The layout mounts it only for a signed-in, unverified account that is not being impersonated (an admin must not
 * verify the pro's address). After a send, whatever the outcome except 429, the answer is the same sentence: the
 * endpoint never says whether the address exists. The success lines live in regions that stay mounted, so a screen
 * reader announces the text when it appears.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const bannerErrorBox = useRef<HTMLParagraphElement>(null);
  const dialogErrorBox = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  /** A code was sent at least once: the banner keeps saying so, the code is still valid for 5 minutes. */
  const [sent, setSent] = useState(false);
  /** Same sentence inside the dialog; it is emptied while a (re)send runs so that the new answer is announced. */
  const [dialogSent, setDialogSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  /** Bumped with each failed call: the effect below puts the focus on the error box once it is rendered. */
  const [errorFocus, setErrorFocus] = useState(0);

  // The buttons are disabled while a call runs, which drops the focus on the page: a keyboard or screen-reader user lands on the message.
  useEffect(() => {
    if (errorFocus > 0) (dialogErrorBox.current ?? bannerErrorBox.current)?.focus();
  }, [errorFocus]);

  /** Escape, the cross and the backdrop do nothing while a call runs. Focus returns to the button that opened the dialog (disabled during the send, so the dialog may not have remembered it). */
  function closeDialog() {
    if (sending || verifying) return;
    setOpen(false);
    trigger.current?.focus();
  }

  async function sendCode() {
    if (sending || verifying) return;
    setSending(true);
    setBannerError(null);
    setDialogError(null);
    setDialogSent(false);
    // The error belongs where the person is looking: the dialog when it is open.
    const fail = (message: string) => {
      if (open) setDialogError(message);
      else setBannerError(message);
      setErrorFocus((n) => n + 1);
    };
    try {
      const res = await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
      if (res.error?.status === 429) {
        fail(RATE_LIMITED);
        return;
      }
      // Any other outcome gets the same answer: the endpoint never says whether the address exists.
      setSent(true);
      setDialogSent(true);
      setCode("");
      setCodeError(null);
      setOpen(true);
      // Inside an open dialog the disabled « Renvoyer le code » dropped the focus: back to the field. When the dialog opens, its autoFocus does it.
      if (open) codeInput.current?.focus();
    } catch {
      fail(SEND_FAILED);
    } finally {
      setSending(false);
    }
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (verifying || sending) return;
    if (!/^\d{6}$/.test(code)) {
      setCodeError(CODE_FORMAT);
      codeInput.current?.focus();
      return;
    }
    setCodeError(null);
    setDialogError(null);
    setVerifying(true);
    try {
      const res = await authClient.emailOtp.verifyEmail({ email, otp: code });
      if (res.error) {
        setDialogError(res.error.status === 429 ? RATE_LIMITED : WRONG_CODE);
        setErrorFocus((n) => n + 1);
        return;
      }
      // The session cookie cache (5 minutes) still says « not verified »: refresh the cookie first, then the page.
      await authClient.getSession({ query: { disableCookieCache: true } });
      setOpen(false);
      router.refresh();
    } catch {
      setDialogError(VERIFY_FAILED);
      setErrorFocus((n) => n + 1);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Mail className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-foreground wrap-anywhere">
              {`Confirmez votre adresse ${email} pour sécuriser votre compte.`}
            </p>
            <div role="status">
              {sent && !bannerError && <p className="mt-1 text-green-700">{SENT}</p>}
            </div>
            <div role="alert">
              {bannerError && (
                <p
                  ref={bannerErrorBox}
                  tabIndex={-1}
                  className="mt-1 rounded text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {bannerError}
                </p>
              )}
            </div>
          </div>
        </div>
        <Button
          ref={trigger}
          type="button"
          size="sm"
          className="w-full sm:w-auto"
          onClick={sendCode}
          disabled={sending}
        >
          {sending && <Loader2 className="animate-spin" aria-hidden />}
          Recevoir un code
        </Button>
      </div>

      <Dialog
        open={open}
        onClose={closeDialog}
        title="Confirmer votre adresse"
        describedBy="verify-email-intro"
      >
        <form onSubmit={verify} noValidate className="space-y-4">
          <div>
            <p id="verify-email-intro" className="text-sm text-zinc-600 wrap-anywhere">
              {`Saisissez le code à 6 chiffres envoyé à ${email}.`}
            </p>
            <div role="status">
              {dialogSent && <p className="mt-1 text-sm text-green-700">{SENT}</p>}
            </div>
          </div>
          <FormField
            label="Code reçu par email"
            htmlFor="verify-email-code"
            help="6 chiffres, valable 5 minutes."
            error={codeError}
          >
            <Input
              id="verify-email-code"
              name="otp"
              ref={codeInput}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                // An edit drops the messages: the next submit checks everything again.
                setCodeError(null);
                setDialogError(null);
              }}
              className="text-center text-lg tracking-[0.4em]"
            />
          </FormField>
          <FormError message={dialogError} ref={dialogErrorBox} tabIndex={-1} />
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={sendCode} disabled={sending || verifying}>
              {sending && <Loader2 className="animate-spin" aria-hidden />}
              Renvoyer le code
            </Button>
            <Button type="submit" disabled={verifying || sending}>
              {verifying && <Loader2 className="animate-spin" aria-hidden />}
              Confirmer
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
