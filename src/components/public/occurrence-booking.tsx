"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type Ref } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { OtpDialog } from "@/components/auth/otp-dialog";
import { FormError } from "@/components/dashboard/form-error";
import { useRefusalFocus } from "@/components/dashboard/use-refusal-focus";
import { IdentityFields } from "@/components/public/identity-fields";
import { QuestionFields } from "@/components/public/question-fields";
import { TestPaymentsBanner } from "@/components/public/test-payments-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { INLINE_LINK_CLASS } from "@/components/ui/link-class";
import type { IdentityInput } from "@/lib/public/identity-schema";
import {
  BUY_TITLE,
  OFFERS_LEGEND,
  OFFER_TOO_SHORT,
  browserSessionStorage,
  firstCoveringOfferId,
  offerOptionLabel,
  payLabel,
  readHoldId,
  returnHref,
  safeCheckoutUrl,
  storeHoldId,
} from "@/lib/public/buy-and-book-form";
import type { VisitorState } from "@/lib/public/identity";
import { COPY, heldTicketButtonLabel } from "@/lib/public/messages";
import {
  answerErrorsById,
  answersFromValues,
  identityErrors,
  identityToSend,
  requiredAnswerErrors,
  type QuestionFieldDef,
} from "@/lib/public/occurrence-form";
import { PUBLIC_UNEXPECTED, type PublicFail } from "@/lib/public/result";
import { FREE_BOOKING_TITLE, SEANCE_HEADING_ID, TICKETS_BOOKING_TITLE, ticketUsedLine } from "@/lib/public/seance-copy";
import { canOfferCodeSignIn } from "@/lib/public/sign-in-flow";
import type { AnswerInput } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { bookWithHeldTicketAction, registerFreeAction, startBuyAndBookAction } from "@/server/public";

export type OccurrenceBookingProps = {
  slug: string;
  occurrenceId: string;
  /** The ISO start the page rendered: posted back so the engine can tell that the séance moved. */
  seenStartsAt: string;
  businessName: string;
  currency: string;
  mode: "free" | "tickets";
  questions: QuestionFieldDef[];
  offers: { offerId: string; label: string; priceCents: number; validityText: string | null; covers: boolean }[];
  visitor: {
    state: VisitorState;
    /** The session e-mail of a VERIFIED visitor only; never the e-mail of a cookie or of a typed address. */
    email: string | null;
    name: string | null;
    canSpend: boolean;
    leftAfter: number;
    typeName: string | null;
  };
  googleEnabled: boolean;
  returnTo: string;
  testMode: "mock" | "test" | null;
};

/** A Server Action call that never throws: a network failure or a deploy in between becomes a failure the form shows. */
async function call<R extends { ok: boolean }>(run: () => Promise<R>): Promise<R | PublicFail> {
  try {
    return await run();
  } catch {
    return { ok: false, error: PUBLIC_UNEXPECTED };
  }
}

/** The success line of a form: `succeed(true)` shows it and puts the focus on it once it is rendered (WCAG 2.4.3). */
function useStatusFocus() {
  const box = useRef<HTMLParagraphElement>(null);
  const [shown, setShown] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick > 0) box.current?.focus();
  }, [focusTick]);
  return {
    box,
    shown,
    succeed: (focus: boolean) => {
      setShown(true);
      if (focus) setFocusTick((n) => n + 1);
    },
    reset: () => setShown(false),
  };
}

/**
 * A success that books the signed-in visitor (a held ticket, or a free registration with the session's address): the
 * action revalidates the page, which renders the « booked » block, so this form and its status line go. The focus moves
 * to the séance heading, which the page always renders (WCAG 2.4.3, contract § 1). The sign-in dialog of
 * `HaveTicketsPrompt` hands the focus to the same heading after a sign-in (`OtpDialog` asks for it after a sign-in only,
 * so Escape gives the focus back to the button that opened the dialog): its prompt goes once the visitor is signed in (G3a).
 */
function seanceHeading(): HTMLElement | null {
  return document.getElementById(SEANCE_HEADING_ID);
}

function focusSeanceHeading() {
  seanceHeading()?.focus();
}

/** The always-mounted status and alert regions of a form: the text is inserted into a region that already exists. */
function Feedback({
  status,
  statusBox,
  error,
  errorBox,
}: {
  status: string | null;
  statusBox: Ref<HTMLParagraphElement>;
  error: string | null;
  errorBox: Ref<HTMLParagraphElement>;
}) {
  return (
    <>
      <div role="status">
        {status && (
          <p
            ref={statusBox}
            tabIndex={-1}
            className="flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0">{status}</span>
          </p>
        )}
      </div>
      <FormError alwaysMounted message={error} ref={errorBox} tabIndex={-1} />
    </>
  );
}

/**
 * What the three forms share when something is refused: the alert line, the field errors under the fields, the focus on
 * the first problem and the mapping of a server refusal onto them (the sentence of the refusal in the line, the errors of
 * its fields and of its answers under them), written once.
 */
function useRefusalState() {
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { root, errorBox, refused } = useRefusalFocus();
  return {
    error,
    setError,
    errors,
    setErrors,
    root,
    errorBox,
    refused,
    /** A refusal: its sentence in the alert line, its field errors under the fields, the focus on the first problem. */
    refuse(res: Pick<PublicFail, "error" | "fieldErrors">, answers: readonly AnswerInput[]) {
      setError(res.error);
      setErrors({ ...(res.fieldErrors ?? {}), ...answerErrorsById(answers, res.fieldErrors ?? {}) });
      refused();
    },
  };
}

/**
 * What the two forms that ask for an identity share (free registration, buy + book): the typed identity, the honeypot,
 * the answers, the field errors, the pending state and the focus after a refusal. The e-mail of a VERIFIED visitor is the
 * session's, whatever was typed before the session changed under the form: that rule is written here and nowhere else.
 */
function useTypedIdentityForm(p: OccurrenceBookingProps) {
  const { visitor } = p;
  const uid = useId();
  const emailLocked = visitor.state === "verified" && visitor.email !== null;
  const [identity, setIdentity] = useState<IdentityInput>({ name: visitor.name ?? "", email: visitor.email ?? "", phone: "" });
  const effective: IdentityInput = emailLocked && visitor.email !== null ? { ...identity, email: visitor.email } : identity;
  const [website, setWebsite] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const { error, setError, errors, setErrors, root, errorBox, refused, refuse } = useRefusalState();

  return {
    uid,
    emailLocked,
    effective,
    setIdentity,
    website,
    setWebsite,
    values,
    setValues,
    pending,
    setPending,
    error,
    errors,
    root,
    errorBox,
    /** The check of the browser: the answers to send and the pending state, or null once the field errors are shown (no call). */
    begin(): AnswerInput[] | null {
      setError(null);
      const local = { ...identityErrors(effective), ...requiredAnswerErrors(p.questions, values) };
      if (Object.keys(local).length > 0) {
        setErrors(local);
        refused();
        return null;
      }
      setErrors({});
      setPending(true);
      return answersFromValues(p.questions, values);
    },
    refuse,
  };
}

type TypedIdentityForm = ReturnType<typeof useTypedIdentityForm>;

/** The identity fields (with the honeypot) and the event's questions of a typed form. */
function TypedFields({ p, form }: { p: OccurrenceBookingProps; form: TypedIdentityForm }) {
  return (
    <>
      <IdentityFields
        idPrefix={form.uid}
        value={form.effective}
        onChange={form.setIdentity}
        emailLocked={form.emailLocked}
        errors={form.errors}
        businessName={p.businessName}
        website={form.website}
        onWebsite={form.setWebsite}
      />
      <QuestionFields idPrefix={form.uid} questions={p.questions} value={form.values} onChange={form.setValues} errors={form.errors} />
    </>
  );
}

/** Free registration (E3): identity, questions, « S'inscrire ». The e-mail is locked for a verified session only. */
function FreeForm({ p }: { p: OccurrenceBookingProps }) {
  const form = useTypedIdentityForm(p);
  const { effective, emailLocked, website, pending, setPending, error, root, errorBox } = form;
  const registered = useStatusFocus();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    registered.reset();
    const answers = form.begin();
    if (answers === null) return;
    const res = await call(() =>
      registerFreeAction({ slug: p.slug, occurrenceId: p.occurrenceId, seenStartsAt: p.seenStartsAt, identity: identityToSend(effective), answers, website }),
    );
    setPending(false);
    if (res.ok) {
      // A verified visitor is booked now and the page re-renders as « booked » (this form goes); a typed visitor keeps
      // the form, and the focus goes to its status line.
      if (emailLocked) focusSeanceHeading();
      registered.succeed(!emailLocked);
      return;
    }
    form.refuse(res, answers);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{FREE_BOOKING_TITLE}</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={root} method="post" onSubmit={submit} noValidate className="space-y-4">
          <TypedFields p={p} form={form} />
          <Feedback
            status={registered.shown ? COPY.REGISTERED : null}
            statusBox={registered.box}
            error={error}
            errorBox={errorBox}
          />
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {pending ? COPY.PENDING_REGISTER : "S'inscrire"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Booking with a held ticket (E2): the Owner's one-click spend; only the event's questions are asked. */
function HeldForm({ p }: { p: OccurrenceBookingProps }) {
  const { visitor } = p;
  const uid = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const { error, setError, errors, setErrors, root, errorBox, refused, refuse } = useRefusalState();
  const booked = useStatusFocus();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    booked.reset();
    setError(null);
    const local = requiredAnswerErrors(p.questions, values);
    if (Object.keys(local).length > 0) {
      setErrors(local);
      refused();
      return;
    }
    setErrors({});
    setPending(true);
    const answers = answersFromValues(p.questions, values);
    const res = await call(() =>
      bookWithHeldTicketAction({ slug: p.slug, occurrenceId: p.occurrenceId, seenStartsAt: p.seenStartsAt, answers }),
    );
    setPending(false);
    if (res.ok) {
      // The Owner is booked now: the page re-renders as « booked » and this form goes.
      focusSeanceHeading();
      booked.succeed(false);
      return;
    }
    refuse(res, answers);
  }

  return (
    <form ref={root} method="post" onSubmit={submit} noValidate className="space-y-4">
      {visitor.typeName && <p className="text-sm text-zinc-600 wrap-anywhere">{ticketUsedLine(visitor.typeName)}</p>}
      <QuestionFields idPrefix={uid} questions={p.questions} value={values} onChange={setValues} errors={errors} />
      <Feedback
        status={booked.shown ? COPY.BOOKED_WITH_TICKET : null}
        statusBox={booked.box}
        error={error}
        errorBox={errorBox}
      />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {pending ? COPY.PENDING_BOOK : heldTicketButtonLabel(visitor.leftAfter)}
      </Button>
    </form>
  );
}

/** Buy + book (E1): choose an offer, give an identity, pay on the payment page; the seat is held while the buyer pays. */
function BuyForm({ p }: { p: OccurrenceBookingProps }) {
  const form = useTypedIdentityForm(p);
  const { uid, effective, website, pending, setPending, error, root, errorBox } = form;
  const [offerId, setOfferId] = useState<string | null>(() => firstCoveringOfferId(p.offers));
  const [heldId, setHeldId] = useState<string | null>(null);

  // Back from the payment page through the history: the page comes back from the cache with the form still pending.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [setPending]);

  const offer = p.offers.find((o) => o.offerId === offerId && o.covers) ?? p.offers.find((o) => o.covers) ?? null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || offer === null) return;
    setHeldId(null);
    const answers = form.begin();
    if (answers === null) return;
    const res = await call(() =>
      startBuyAndBookAction({ slug: p.slug, occurrenceId: p.occurrenceId, offerId: offer.offerId, seenStartsAt: p.seenStartsAt, identity: identityToSend(effective), answers, website }),
    );
    if (res.ok) {
      const storage = browserSessionStorage();
      storeHoldId(storage, p.occurrenceId, res.purchaseId);
      const target = safeCheckoutUrl(res.checkoutUrl, window.location.origin);
      if (target !== null) {
        // The page leaves: the button keeps its « Redirection vers le paiement… » label until it is gone.
        window.location.assign(target);
        return;
      }
      setPending(false);
      setHeldId(readHoldId(storage, p.occurrenceId));
      form.refuse({ error: COPY.CHECKOUT_FAILED }, answers);
      return;
    }
    setPending(false);
    setHeldId(readHoldId(browserSessionStorage(), p.occurrenceId));
    form.refuse(res, answers);
  }

  if (offer === null) return <p className="text-sm text-zinc-600">{COPY.NO_COVERING_OFFER}</p>;

  return (
    <section aria-labelledby={`${uid}-buy`} className="space-y-4">
      <h4 id={`${uid}-buy`} className="text-base font-semibold">
        {BUY_TITLE}
      </h4>
      {p.testMode && <TestPaymentsBanner mode={p.testMode} />}
      <form ref={root} method="post" onSubmit={submit} noValidate className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{OFFERS_LEGEND}</legend>
          {p.offers.map((o) => {
            const id = `${uid}-offer-${o.offerId}`;
            const shortId = `${id}-short`;
            return (
              <div key={o.offerId}>
                <label
                  htmlFor={id}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-sm",
                    o.covers ? "cursor-pointer has-checked:border-ring has-checked:bg-accent" : "cursor-not-allowed opacity-60",
                  )}
                >
                  <input
                    id={id}
                    type="radio"
                    name={`${uid}-offer`}
                    value={o.offerId}
                    checked={offer.offerId === o.offerId}
                    disabled={!o.covers}
                    aria-describedby={o.covers ? undefined : shortId}
                    onChange={() => setOfferId(o.offerId)}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 wrap-anywhere">{offerOptionLabel(o, p.currency)}</span>
                </label>
                {!o.covers && (
                  <p id={shortId} className="mt-1 pl-3 text-xs text-zinc-600">
                    {OFFER_TOO_SHORT}
                  </p>
                )}
              </div>
            );
          })}
        </fieldset>
        <TypedFields p={p} form={form} />
        <Feedback status={null} statusBox={null} error={error} errorBox={errorBox} />
        {heldId !== null && (
          <p className="text-sm">
            <Link href={returnHref(p.slug, p.occurrenceId, heldId)} className={INLINE_LINK_CLASS}>
              {COPY.RETURN_LINK}
            </Link>
          </p>
        )}
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {pending ? COPY.PENDING_PAY : payLabel(offer, p.currency)}
        </Button>
      </form>
    </section>
  );
}

/** « J'ai déjà des tickets »: the sign-in dialog of an anonymous visitor (never prefilled with an address, Decision 7). */
function HaveTicketsPrompt({ p }: { p: OccurrenceBookingProps }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="min-w-0 text-sm text-zinc-600">{COPY.HAVE_TICKETS_HINT}</p>
      <Button type="button" variant="secondary" className="w-full sm:w-auto sm:shrink-0" onClick={() => setOpen(true)}>
        {COPY.HAVE_TICKETS}
      </Button>
      <OtpDialog open={open} onClose={() => setOpen(false)} returnTo={p.returnTo} googleEnabled={p.googleEnabled} returnFocusTo={seanceHeading} />
    </div>
  );
}

/** Tickets mode: spend a held ticket (Owner) or buy and book in one step; an anonymous visitor can sign in first, an unverified one is asked to confirm the address. */
function TicketsBooking({ p }: { p: OccurrenceBookingProps }) {
  const { visitor } = p;
  const canSignIn = canOfferCodeSignIn(visitor.state);
  const unverified = visitor.state === "unverified";
  // Without a usable ticket, the visitor buys and books in one step.
  const canBuy = !visitor.canSpend;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{TICKETS_BOOKING_TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {visitor.canSpend && <HeldForm p={p} />}
        {!visitor.canSpend && canSignIn && <HaveTicketsPrompt p={p} />}
        {!visitor.canSpend && unverified && <p className="text-sm text-zinc-600">{COPY.CONFIRM_EMAIL_TO_SPEND}</p>}
        {canBuy && <BuyForm p={p} />}
      </CardContent>
    </Card>
  );
}

/** The booking block of the séance page, by booking mode (contract § 3.23). */
export function OccurrenceBooking(props: OccurrenceBookingProps) {
  return props.mode === "free" ? <FreeForm p={props} /> : <TicketsBooking p={props} />;
}
