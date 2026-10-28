"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { OtpDialog } from "@/components/auth/otp-dialog";
import { announceSignIn } from "@/components/auth/sign-in-status";
import { FormError } from "@/components/dashboard/form-error";
import { useRefusalFocus } from "@/components/dashboard/use-refusal-focus";
import { IdentityFields } from "@/components/public/identity-fields";
import { QuestionFields } from "@/components/public/question-fields";
import { TestPaymentsBanner } from "@/components/public/test-payments-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { INLINE_LINK_CLASS } from "@/components/ui/link-class";
import { BUY_TITLE, OFFERS_LEGEND, browserSessionStorage, offerOptionLabel, payLabel, safeCheckoutUrl } from "@/lib/public/buy-and-book-form";
import type { VisitorState } from "@/lib/public/identity";
import type { IdentityInput } from "@/lib/public/identity-schema";
import { COPY, heldTicketButtonLabel } from "@/lib/public/messages";
import {
  answerErrorsById,
  answersFromValues,
  identityErrors,
  identityToSend,
  requiredAnswerErrors,
  type QuestionFieldDef,
} from "@/lib/public/occurrence-form";
import type { BookRdvActionInput } from "@/lib/public/rdv-actions";
import { readRdvHoldId, rdvReturnHref, storeRdvHoldId } from "@/lib/public/rdv-form";
import {
  RDV_CHOSEN_LABEL,
  RDV_DAYS_LABEL,
  rdvBookedLine,
  rdvDayChipLabel,
  rdvSignInHint,
  rdvSlotCountLabel,
  rdvSlotMode,
  rdvTimesLabel,
  type RdvDayVM,
  type RdvSlotVM,
} from "@/lib/public/rdv-view";
import { PUBLIC_UNEXPECTED, type PublicFail } from "@/lib/public/result";
import { SEE_MY_SPACE } from "@/lib/public/seance-copy";
import { RDV_HEADING_ID } from "@/lib/public-anchors";
import { cn } from "@/lib/utils";
import { bookRdvAction } from "@/server/public";

/** An offer of the type as the buy form needs it: `coversUntil` is the ISO end of its tickets if bought now, null without validity. */
export type RdvOfferProp = {
  offerId: string;
  label: string;
  priceCents: number;
  validityText: string | null;
  coversUntil: string | null;
};

export type RdvBookingProps = {
  slug: string;
  ticketTypeId: string;
  businessName: string;
  currency: string;
  isFree: boolean;
  /** The seven days of the shown week, every label and every ISO start rendered by the server in the pro's zone. */
  days: RdvDayVM[];
  questions: QuestionFieldDef[];
  offers: RdvOfferProp[];
  /** The Owner's tickets of THIS type (their ISO expiry), null for anyone else and on a free type. */
  ownerTickets: { expiresAt: string | null }[] | null;
  visitor: {
    state: VisitorState;
    /** The session e-mail of a VERIFIED visitor only; never the e-mail of a cookie or of a typed address. */
    email: string | null;
    name: string | null;
  };
  googleEnabled: boolean;
  /** /{slug}/rdv/{ticketTypeId}: where a Google or password sign-in comes back (never a `p`). */
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

/**
 * Where the code dialog hands the focus once the visitor is signed in (UI-1): the RDV heading, which every state of the
 * page renders and the refresh leaves in place, while this block is remounted on the new visitor state. `OtpDialog`
 * asks for it after a sign-in only, so the page's one `SignInStatus` line says « Connexion réussie. » then and only then
 * (WCAG 2.4.3, 4.1.3). A module-level function, so that its identity is stable, as `Dialog` asks.
 */
function rdvHeadingAfterSignIn(): HTMLElement | null {
  announceSignIn(COPY.SIGNED_IN);
  return document.getElementById(RDV_HEADING_ID);
}

/** « J'ai déjà des tickets »: the sign-in dialog of an anonymous visitor (never prefilled with an address, Decision 7). */
function HaveTicketsPrompt({ p }: { p: RdvBookingProps }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="min-w-0 text-sm text-zinc-600">{COPY.HAVE_TICKETS_HINT}</p>
      <Button type="button" variant="secondary" className="w-full sm:w-auto sm:shrink-0" onClick={() => setOpen(true)}>
        {COPY.HAVE_TICKETS}
      </Button>
      <OtpDialog open={open} onClose={() => setOpen(false)} returnTo={p.returnTo} googleEnabled={p.googleEnabled} returnFocusTo={rdvHeadingAfterSignIn} />
    </div>
  );
}

/** The time chips of one day: one toggle per slot, named by its full date and time (`ariaLabel`), its text the start. */
function TimeChips({
  day,
  selectedIso,
  onSelect,
}: {
  day: RdvDayVM;
  selectedIso: string | null;
  onSelect: (slot: RdvSlotVM) => void;
}) {
  return (
    <div role="group" aria-label={rdvTimesLabel(day.label)} className="flex flex-wrap gap-2">
      {day.slots.map((slot) => {
        const pressed = slot.iso === selectedIso;
        return (
          <button
            key={slot.iso}
            type="button"
            aria-pressed={pressed}
            aria-label={slot.ariaLabel}
            onClick={() => onSelect(slot)}
            className={cn(
              "h-10 min-w-[4.75rem] cursor-pointer rounded-xl border px-3 text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 active:scale-[0.98]",
              pressed
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-card text-foreground hover:border-ring hover:bg-accent",
            )}
          >
            {slot.time}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The booking block of the RDV page (P5 dossier § 3.3, § 3.6; O15): the days of the week and their time chips (from
 * 640 px a row of day toggles and the times of the chosen day, below it a list per day), then the form of the chosen
 * slot in the mode § 3.6 gives it: free, held ticket (the Owner only) or buy with the offers covering that start. The
 * start it posts is the server's ISO string, never a rebuilt wall time. The status and alert regions live here, outside
 * the slot form, so a success or a refusal stays said when the revalidation or the refetch takes the slot away.
 */
export function RdvBooking(p: RdvBookingProps) {
  const { visitor } = p;
  const uid = useId();
  const router = useRouter();

  const firstDay = p.days.find((day) => day.slots.length > 0)?.key ?? p.days[0]?.key ?? null;
  const [dayKey, setDayKey] = useState<string | null>(firstDay);
  const [selectedIso, setSelectedIso] = useState<string | null>(null);

  // What the visitor typed survives a change of slot: the identity, the honeypot, the answers and the offer.
  const emailLocked = visitor.state === "verified" && visitor.email !== null;
  const [identity, setIdentity] = useState<IdentityInput>({ name: visitor.name ?? "", email: visitor.email ?? "", phone: "" });
  const effective: IdentityInput = emailLocked && visitor.email !== null ? { ...identity, email: visitor.email } : identity;
  const [website, setWebsite] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [offerId, setOfferId] = useState<string | null>(null);

  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const [resumeHref, setResumeHref] = useState<string | null>(null);
  const { root, errorBox, refused } = useRefusalFocus();
  const statusBox = useRef<HTMLParagraphElement>(null);
  const [statusTick, setStatusTick] = useState(0);
  const panel = useRef<HTMLDivElement>(null);

  // The success line takes the focus once it is rendered (WCAG 2.4.3): the slot it booked is gone after the revalidation.
  useEffect(() => {
    if (statusTick > 0) statusBox.current?.focus();
  }, [statusTick]);

  // Back from the payment page through the history: the page comes back from the cache with the form still pending.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // A chosen slot brings its form into view when it starts below the fold (the list per day of a phone).
  useEffect(() => {
    if (selectedIso === null) return;
    const el = panel.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight - 96) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
  }, [selectedIso]);

  const withSlots = p.days.filter((day) => day.slots.length > 0);
  const slotDay = selectedIso === null ? null : (p.days.find((day) => day.slots.some((s) => s.iso === selectedIso)) ?? null);
  const slot = slotDay?.slots.find((s) => s.iso === selectedIso) ?? null;
  const shownDay =
    slotDay ?? p.days.find((day) => day.key === dayKey && day.slots.length > 0) ?? withSlots[0] ?? null;
  const mode = slot === null ? null : rdvSlotMode({ isFree: p.isFree, startsAtIso: slot.iso, ownerTickets: p.ownerTickets, offers: p.offers });
  const covering = mode?.kind === "buy" ? mode.offers : [];
  const offer = covering.find((o) => o.offerId === offerId) ?? covering[0] ?? null;
  const hint = rdvSignInHint({ isFree: p.isFree, state: visitor.state });

  /** A new choice starts over: what the last attempt said goes, what was typed stays. */
  function clearOutcome() {
    setError(null);
    setBooked(null);
    setResumeHref(null);
    setErrors({});
  }

  function chooseDay(key: string) {
    if (pending) return;
    setDayKey(key);
    if (slotDay?.key !== key) setSelectedIso(null);
  }

  function chooseSlot(next: RdvSlotVM) {
    if (pending) return;
    clearOutcome();
    setSelectedIso(next.iso);
    const day = p.days.find((d) => d.slots.some((s) => s.iso === next.iso));
    if (day) setDayKey(day.key);
  }

  /** The resume link of a refused or failed attempt: the Owner's own hold (server), else the purchase this tab started. */
  function resumeOf(res: Pick<PublicFail, "resumeHref">, startsAtIso: string): string | null {
    const own = `/${encodeURIComponent(p.slug)}/rdv/`;
    if (res.resumeHref !== undefined && res.resumeHref.startsWith(own)) return res.resumeHref;
    const held = readRdvHoldId(browserSessionStorage(), p.ticketTypeId, startsAtIso);
    return held === null ? null : rdvReturnHref(p.slug, p.ticketTypeId, held);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || slot === null || mode === null) return;
    const chosenOffer = mode.kind === "buy" ? offer : null;
    if (mode.kind === "buy" && chosenOffer === null) return;
    clearOutcome();
    const typed = mode.kind !== "held";
    const local = { ...(typed ? identityErrors(effective) : {}), ...requiredAnswerErrors(p.questions, values) };
    if (Object.keys(local).length > 0) {
      setErrors(local);
      refused();
      return;
    }
    setPending(true);
    const answers = answersFromValues(p.questions, values);
    // The start is the server's ISO string of the chip, posted verbatim; the mode is the one § 3.6 gave this slot.
    const slotInput = { ticketTypeId: p.ticketTypeId, startsAt: slot.iso, answers };
    const input: BookRdvActionInput =
      chosenOffer !== null
        ? { ...slotInput, mode: "buy", offerId: chosenOffer.offerId, identity: identityToSend(effective), website }
        : mode.kind === "free"
          ? { ...slotInput, mode: "free", identity: identityToSend(effective), website }
          : { ...slotInput, mode: "held_ticket" };
    const res = await call(() => bookRdvAction({ slug: p.slug, ...input }));
    if (res.ok && res.kind === "checkout") {
      const storage = browserSessionStorage();
      storeRdvHoldId(storage, p.ticketTypeId, slot.iso, res.purchaseId);
      const target = safeCheckoutUrl(res.checkoutUrl, window.location.origin);
      if (target !== null) {
        // The page leaves: the button keeps its « Redirection vers le paiement… » label until it is gone.
        window.location.assign(target);
        return;
      }
      setPending(false);
      setError(COPY.CHECKOUT_FAILED);
      setResumeHref(resumeOf({}, slot.iso));
      refused();
      return;
    }
    setPending(false);
    if (res.ok) {
      // Booked: the action revalidated the page, which drops the slot from the week; the line stays and takes the focus.
      setBooked(rdvBookedLine(slot.whenLabel, mode.kind === "held"));
      setSelectedIso(null);
      setStatusTick((n) => n + 1);
      return;
    }
    setErrors({ ...(res.fieldErrors ?? {}), ...answerErrorsById(answers, res.fieldErrors ?? {}) });
    setError(res.error);
    setResumeHref(resumeOf(res, slot.iso));
    refused();
    // A refusal revalidates nothing: a slot just taken, or no longer offered, is fetched again (fresh slots, no refresh call).
    if (res.code === "slot_taken" || res.code === "unavailable") {
      router.replace(`${window.location.pathname}${window.location.search}`, { scroll: false });
    }
  }

  const submitLabel =
    mode === null
      ? COPY.RDV_BOOK
      : mode.kind === "held"
        ? heldTicketButtonLabel(mode.leftAfter)
        : mode.kind === "buy" && offer !== null
          ? payLabel({ ...offer, covers: true }, p.currency)
          : COPY.RDV_BOOK;
  const pendingLabel = mode?.kind === "buy" ? COPY.PENDING_PAY : COPY.PENDING_BOOK;

  return (
    <Card>
      <CardContent className="space-y-5 p-4 sm:p-6">
        {hint === "prompt" && <HaveTicketsPrompt p={p} />}
        {hint === "confirm" && <p className="text-sm text-zinc-600">{COPY.CONFIRM_EMAIL_TO_SPEND}</p>}

        {/* From 640 px: the seven day toggles, then the times of the chosen day. */}
        <div className="hidden space-y-4 sm:block">
          <div role="group" aria-label={RDV_DAYS_LABEL} className="grid grid-cols-7 gap-2">
            {p.days.map((day) => {
              const pressed = shownDay?.key === day.key;
              const empty = day.slots.length === 0;
              return (
                <button
                  key={day.key}
                  type="button"
                  aria-pressed={pressed}
                  aria-label={rdvDayChipLabel(day)}
                  disabled={empty}
                  onClick={() => chooseDay(day.key)}
                  className={cn(
                    "flex min-w-0 cursor-pointer flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
                    pressed
                      ? "border-primary bg-primary-muted text-accent-foreground"
                      : "border-border bg-card text-foreground hover:border-ring hover:bg-accent",
                  )}
                >
                  <span className="text-sm font-semibold first-letter:uppercase">{day.shortLabel}</span>
                  <span className={cn("text-xs", pressed ? "text-accent-foreground" : "text-zinc-600")}>{rdvSlotCountLabel(day.slots.length)}</span>
                </button>
              );
            })}
          </div>
          {shownDay && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-zinc-700 first-letter:uppercase">{shownDay.label}</p>
              <TimeChips day={shownDay} selectedIso={selectedIso} onSelect={chooseSlot} />
            </div>
          )}
        </div>

        {/* Below 640 px: a list per day, the days with a slot only (P4 Decision 46). */}
        <div className="space-y-5 sm:hidden">
          {withSlots.map((day) => (
            <section key={day.key} aria-labelledby={`${uid}-day-${day.key}`} className="space-y-2">
              <h4 id={`${uid}-day-${day.key}`} className="text-sm font-semibold text-zinc-700 first-letter:uppercase">
                {day.label}
              </h4>
              <TimeChips day={day} selectedIso={selectedIso} onSelect={chooseSlot} />
            </section>
          ))}
        </div>

        {slot !== null && mode !== null && (
          <div ref={panel} className="scroll-mt-4 space-y-4 rounded-2xl border border-border bg-background p-4 sm:p-5">
            <p className="text-sm wrap-anywhere">
              <span className="font-semibold">{`${RDV_CHOSEN_LABEL} : `}</span>
              {slot.whenLabel}
            </p>
            {mode.kind === "buy" && offer === null ? (
              <p className="text-sm text-zinc-600">{COPY.RDV_NO_OFFER}</p>
            ) : (
              <form ref={root} method="post" onSubmit={submit} noValidate className="space-y-4">
                {mode.kind === "buy" && offer !== null && (
                  <section aria-labelledby={`${uid}-buy`} className="space-y-4">
                    <h4 id={`${uid}-buy`} className="text-base font-semibold">
                      {BUY_TITLE}
                    </h4>
                    {p.testMode && <TestPaymentsBanner mode={p.testMode} />}
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium">{OFFERS_LEGEND}</legend>
                      {covering.map((o) => {
                        const id = `${uid}-offer-${o.offerId}`;
                        return (
                          <label
                            key={o.offerId}
                            htmlFor={id}
                            className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-3 text-sm has-checked:border-ring has-checked:bg-accent"
                          >
                            <input
                              id={id}
                              type="radio"
                              name={`${uid}-offer`}
                              value={o.offerId}
                              checked={offer.offerId === o.offerId}
                              onChange={() => setOfferId(o.offerId)}
                              className="mt-0.5 size-4 shrink-0 accent-primary"
                            />
                            <span className="min-w-0 wrap-anywhere">{offerOptionLabel({ ...o, covers: true }, p.currency)}</span>
                          </label>
                        );
                      })}
                    </fieldset>
                  </section>
                )}
                {mode.kind !== "held" && (
                  <IdentityFields
                    idPrefix={uid}
                    value={effective}
                    onChange={setIdentity}
                    emailLocked={emailLocked}
                    errors={errors}
                    businessName={p.businessName}
                    website={website}
                    onWebsite={setWebsite}
                  />
                )}
                <QuestionFields idPrefix={uid} questions={p.questions} value={values} onChange={setValues} errors={errors} />
                <Button type="submit" disabled={pending} className="w-full sm:w-auto">
                  {pending && <Loader2 className="animate-spin" aria-hidden />}
                  {pending ? pendingLabel : submitLabel}
                </Button>
              </form>
            )}
          </div>
        )}

        {/* Always mounted: the text is inserted into a region that already exists (G4c), and outlives the slot it names. */}
        <div role="status">
          {booked && (
            <p
              ref={statusBox}
              tabIndex={-1}
              className="flex flex-wrap items-start gap-x-2 gap-y-1 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{booked}</span>
              <Link href={`/${p.slug}/espace`} className={INLINE_LINK_CLASS}>
                {SEE_MY_SPACE}
              </Link>
            </p>
          )}
        </div>
        <FormError alwaysMounted message={error} ref={errorBox} tabIndex={-1} />
        {resumeHref !== null && (
          <p className="text-sm">
            <Link href={resumeHref} className={INLINE_LINK_CLASS}>
              {COPY.RETURN_LINK}
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
