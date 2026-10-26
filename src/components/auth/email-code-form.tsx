"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { FormField } from "@/components/dashboard/form-field";
import { useRefusalFocus } from "@/components/dashboard/use-refusal-focus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { CODE_SENT, SEND_FAILED, VERIFY_FAILED, sendCodeFailure, verifyCodeFailure } from "@/lib/auth-messages";
import { COPY } from "@/lib/public/messages";
import { isPlainName } from "@/lib/public/plain-name";
import { codeInputValue, isCompleteCode, nameToSend } from "@/lib/public/sign-in-flow";
import { customerInputSchema } from "@/lib/tickets";
import { BOUNDS } from "@/lib/tickets-vocab";
import { parseFr } from "@/lib/zod-fr";

/** The e-mail rule of the engine's customer input: the same address check as everywhere else, in French. */
const emailOnly = customerInputSchema.pick({ email: true });
const CODE_FORMAT = "Saisissez les 6 chiffres du code.";

/**
 * Sign in by e-mail code (spec L1247-1249, L1314-1315): the address (and an optional name), then the 6-digit code.
 * Mount it only for an anonymous visitor (canOfferCodeSignIn, risk 7). The answer to « Recevoir un code » is always
 * the neutral CODE_SENT unless the send was rate limited or failed (it never says whether the address has an
 * account), and the address is never prefilled (Decision 7). After a good code the session is read once without the
 * cookie cache, then the page re-renders as signed in. `idPrefix` makes the field ids unique when two forms share a page.
 */
export function EmailCodeForm({
  idPrefix,
  askName = false,
  onSignedIn,
}: {
  idPrefix: string;
  askName?: boolean;
  onSignedIn?: () => void;
}) {
  const router = useRouter();
  const { root, errorBox, refused } = useRefusalFocus();
  const emailInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  /** The normalized address the code was sent to: the typed field may change after « Modifier l'adresse ». */
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [done, setDone] = useState(false);
  /** Bumped when the step changes or a code is re-sent: the effect below puts the focus in the field that now matters. */
  const [stepFocus, setStepFocus] = useState(0);
  const busy = sending || verifying || done;

  useEffect(() => {
    if (stepFocus === 0) return;
    (step === "code" ? codeInput : emailInput).current?.focus();
  }, [stepFocus, step]);

  /** Sends a sign-in code to `target`; true when the answer is the neutral one. */
  async function sendCode(target: string): Promise<boolean> {
    setSending(true);
    setError(null);
    setStatus(null);
    try {
      const res = await authClient.emailOtp.sendVerificationOtp({ email: target, type: "sign-in" });
      const failure = sendCodeFailure(res.error);
      if (failure) {
        setError(failure);
        refused();
        return false;
      }
      setStatus(CODE_SENT);
      return true;
    } catch {
      setError(SEND_FAILED);
      refused();
      return false;
    } finally {
      setSending(false);
    }
  }

  // Both handlers stop the event as well: the dialog is not portalled, so a caller may hold it inside its own form,
  // and the submit must not reach that form.
  async function onSend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setEmailError(null);
    setNameError(null);
    const parsed = parseFr(emailOnly, { email: email.trim() });
    const plain = !askName || isPlainName(name.trim());
    if (!parsed.ok) setEmailError(parsed.fieldErrors.email ?? parsed.error);
    if (!plain) setNameError(COPY.PLAIN_NAME);
    if (!parsed.ok || !plain) {
      refused();
      return;
    }
    if (await sendCode(parsed.data.email)) {
      setAddress(parsed.data.email);
      setCode("");
      setCodeError(null);
      setStep("code");
      setStepFocus((n) => n + 1);
    }
  }

  async function onVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setError(null);
    if (!isCompleteCode(code)) {
      setCodeError(CODE_FORMAT);
      refused();
      return;
    }
    setCodeError(null);
    setVerifying(true);
    try {
      const res = await authClient.signIn.emailOtp({ email: address, otp: code, name: askName ? nameToSend(name) : undefined });
      if (res.error) {
        setError(verifyCodeFailure(res.error));
        refused();
        return;
      }
      // The session cookie cache (5 minutes) still says « signed out »: read the session once without it, then the page re-renders as signed in.
      try {
        await authClient.getSession({ query: { disableCookieCache: true } });
      } catch {
        // A network failure here only delays what the page shows until the cache expires.
      }
      setDone(true);
      onSignedIn?.();
      router.refresh();
    } catch {
      setError(VERIFY_FAILED);
      refused();
    } finally {
      setVerifying(false);
    }
  }

  async function resend() {
    if (busy) return;
    if (await sendCode(address)) {
      setCode("");
      setCodeError(null);
      setStepFocus((n) => n + 1);
    }
  }

  function editAddress() {
    if (busy) return;
    setStep("email");
    setCode("");
    setCodeError(null);
    setError(null);
    setStatus(null);
    setStepFocus((n) => n + 1);
  }

  return (
    <form ref={root} method="post" onSubmit={step === "email" ? onSend : onVerify} noValidate className="space-y-4">
      {step === "email" ? (
        <>
          <FormField label="Email" htmlFor={`${idPrefix}-email`} error={emailError}>
            <Input
              id={`${idPrefix}-email`}
              name="email"
              ref={emailInput}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError(null);
              }}
            />
          </FormField>
          {askName && (
            <FormField
              label="Votre nom"
              htmlFor={`${idPrefix}-name`}
              optional
              help={COPY.CODE_NAME_HELP}
              error={nameError}
            >
              <Input
                id={`${idPrefix}-name`}
                name="name"
                autoComplete="name"
                maxLength={BOUNDS.name}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
              />
            </FormField>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-600 wrap-anywhere">{`Saisissez le code à 6 chiffres envoyé à ${address}.`}</p>
          <FormField
            label="Code reçu par email"
            htmlFor={`${idPrefix}-code`}
            help="6 chiffres, valable 5 minutes."
            error={codeError}
          >
            <Input
              id={`${idPrefix}-code`}
              name="otp"
              ref={codeInput}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => {
                setCode(codeInputValue(e.target.value));
                setCodeError(null);
                setError(null);
              }}
              className="text-center text-lg tracking-[0.4em]"
            />
          </FormField>
        </>
      )}

      {/* Both regions are mounted from the first render: a live region inserted together with its text is not reliably announced. */}
      <div role="status" className="text-sm text-green-700">
        {status && <p>{status}</p>}
      </div>
      <div role="alert">
        {error && (
          <p
            ref={errorBox}
            tabIndex={-1}
            className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {error}
          </p>
        )}
      </div>

      {step === "email" ? (
        <Button type="submit" className="w-full sm:w-auto" disabled={busy}>
          {sending && <Loader2 className="animate-spin" aria-hidden />}
          {sending ? COPY.PENDING_SEND : "Recevoir un code"}
        </Button>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {/* Enabled as soon as the field holds something: Enter with fewer than 6 digits is answered with CODE_FORMAT, not ignored. */}
          <Button type="submit" className="w-full sm:w-auto" disabled={busy || code === ""}>
            {verifying && <Loader2 className="animate-spin" aria-hidden />}
            {verifying ? COPY.PENDING_VERIFY : "Valider le code"}
          </Button>
          <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={resend} disabled={busy}>
            {sending && <Loader2 className="animate-spin" aria-hidden />}
            Renvoyer le code
          </Button>
          <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={editAddress} disabled={busy}>
            {"Modifier l'adresse"}
          </Button>
        </div>
      )}
    </form>
  );
}
