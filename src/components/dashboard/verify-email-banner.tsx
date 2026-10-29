"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Mail } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { CODE_SENT, SEND_FAILED, sendCodeFailure, VERIFY_FAILED, verifyCodeFailure } from "@/lib/auth-messages";
import { COPY } from "@/lib/public/messages";

const CODE_FORMAT = "Saisissez les 6 chiffres du code.";
const CONFIRMED = "Adresse confirmée.";

/**
 * « Confirmez votre adresse »: the e-mail code flow of an unverified pro account (spec § 12).
 *
 * The layout renders it for every signed-in account that is not being impersonated (an admin must not verify the
 * pro's address) and keeps it mounted when `verified` flips to true after `router.refresh()`: that is what lets the
 * « Adresse confirmée. » line be announced and take the focus the banner had. A verified account that did not just
 * confirm gets an empty status region and nothing else.
 *
 * After a send, whatever the outcome except 429 and a server failure, the answer is the same sentence: the endpoint
 * never says whether the address exists. The success lines live in regions that stay mounted, so a screen reader
 * announces the text when it appears; so does the dialog's failure line (`FormError alwaysMounted`). While a call runs
 * its button says so (« Envoi… », « Vérification… », the client pages' COPY labels: the banner is shown to clients too).
 */
export function VerifyEmailBanner({ email, verified }: { email: string; verified: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const trigger = useRef<HTMLButtonElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const bannerErrorBox = useRef<HTMLParagraphElement>(null);
  const dialogErrorBox = useRef<HTMLParagraphElement>(null);
  const confirmedBox = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  /** A code was sent at least once: the banner keeps saying so (the code is valid for 5 minutes) and the button reopens the dialog. */
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
  /** The page where the code was accepted: the confirmation line stays until the person leaves it. */
  const [confirmedOn, setConfirmedOn] = useState<string | null>(null);
  // « Adjust state when a prop changes »: another page drops the line (and a confirmation that only reaches the layout later, once the session cache has expired, never shows).
  if (confirmedOn !== null && confirmedOn !== pathname) setConfirmedOn(null);
  const justConfirmed = confirmedOn !== null;

  // The buttons are disabled while a call runs, which drops the focus on the page: a keyboard or screen-reader user lands on the message.
  useEffect(() => {
    if (errorFocus > 0) (dialogErrorBox.current ?? bannerErrorBox.current)?.focus();
  }, [errorFocus]);

  // The banner and its button are gone once the session says « verified »: the confirmation line takes the focus, once, on that flip.
  useEffect(() => {
    if (verified && justConfirmed) confirmedBox.current?.focus();
  }, [verified, justConfirmed]);

  function openDialog() {
    setCodeError(null);
    setDialogError(null);
    setOpen(true);
  }

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
      const failure = sendCodeFailure(res.error);
      if (failure) {
        fail(failure);
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
        setDialogError(verifyCodeFailure(res.error));
        setErrorFocus((n) => n + 1);
        return;
      }
      // From here the address is verified, whatever happens next: the refresh below always runs.
      // The session cookie cache (5 minutes) still says « not verified »: refresh the cookie first, then the page.
      try {
        await authClient.getSession({ query: { disableCookieCache: true } });
      } catch {
        // A network failure here only leaves the banner up until the cache expires.
      }
      setConfirmedOn(pathname);
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
      {/* Mounted whatever the state, before the banner: the line is inserted into a live region that already exists. */}
      <div role="status">
        {verified && justConfirmed && (
          <p
            ref={confirmedBox}
            tabIndex={-1}
            className="mb-6 flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CheckCircle2 className="size-5 shrink-0" aria-hidden />
            {CONFIRMED}
          </p>
        )}
      </div>

      {!verified && (
        <>
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <Mail className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 text-sm">
                <p className="font-medium text-foreground wrap-anywhere">
                  {`Confirmez votre adresse ${email} pour sécuriser votre compte.`}
                </p>
                <div role="status">
                  {sent && !bannerError && <p className="mt-1 text-green-700">{CODE_SENT}</p>}
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
              onClick={sent ? openDialog : sendCode}
              disabled={sending}
            >
              {sending && <Loader2 className="animate-spin" aria-hidden />}
              {sending ? COPY.PENDING_SEND : sent ? "Saisir le code" : "Recevoir un code"}
            </Button>
          </div>

          <Dialog
            open={open}
            onClose={closeDialog}
            title="Confirmer votre adresse"
            describedBy="verify-email-intro"
          >
            <form method="post" onSubmit={verify} noValidate className="space-y-4">
              <div>
                <p id="verify-email-intro" className="text-sm text-zinc-600 wrap-anywhere">
                  {`Saisissez le code à 6 chiffres envoyé à ${email}.`}
                </p>
                <div role="status">
                  {dialogSent && <p className="mt-1 text-sm text-green-700">{CODE_SENT}</p>}
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
              <FormError alwaysMounted message={dialogError} ref={dialogErrorBox} tabIndex={-1} />
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={sendCode} disabled={sending || verifying}>
                  {sending && <Loader2 className="animate-spin" aria-hidden />}
                  {sending ? COPY.PENDING_SEND : "Renvoyer le code"}
                </Button>
                <Button type="submit" disabled={verifying || sending}>
                  {verifying && <Loader2 className="animate-spin" aria-hidden />}
                  {verifying ? COPY.PENDING_VERIFY : "Confirmer"}
                </Button>
              </div>
            </form>
          </Dialog>
        </>
      )}
    </>
  );
}
