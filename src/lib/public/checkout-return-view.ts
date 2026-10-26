/**
 * The payment return in one pure module (G4c; spec L1099-1104, L1163-1168, Decisions 13, 31, 32, 33, 63, 71). It holds
 * everything the pages and the block derive from a purchase, so no page re-writes a rule:
 *
 * - `paymentReturnOf`: for the séance page, which purchase the block describes, whether the visitor is booked, the props
 *   of the block and the line above the form. One rule decides the block and that line: `seatGoneOf` (the seat behind a
 *   buy + book purchase), whose hold rule is `liveHoldEnd`, both in `visibility.ts`.
 * - `checkoutBlockOf`: the props of the block for one purchase (the offer page uses it for a shop purchase).
 * - `returnViewOf`, `returnTextOf`: what `CheckoutReturn` says, so its view and its sentence are tested here and not pinned
 *   by regexes on the component.
 *
 * Client-safe (the component imports it): no database, no env, no `server-only`, type-only imports of the release core.
 * Nothing here knows a customer: a reference shows THAT purchase, never its customer (Decision 71).
 */
import { formatTime } from "@/lib/datetime";
import { COPY } from "@/lib/public/messages";
import type { AbandonOutcome } from "@/lib/public/release-actions";

import { liveHoldEnd, seatGoneOf, type PageBooking, type ReferenceView } from "./visibility";

/** The props of `CheckoutReturn`. */
export type CheckoutReturnProps = {
  slug: string;
  purchaseId: string;
  kind: "buybook" | "shop";
  status: "pending" | "paid" | "expired";
  processing: boolean;
  resumeUrl: string | null;
  holdUntilLabel: string | null;
  merciHref: string;
  /** An admin impersonating someone: the state without either control (Decision 19, G4b). */
  readOnly: boolean;
};

/** What a page knows of the pro and the request: the slug, the pro's zone, the request's one clock, the read-only flag. */
export type BlockContext = { slug: string; tz: string; now: Date; readOnly: boolean };

/**
 * The block of one purchase, or null when the seat behind it is gone for good (the pro cancelled the booking: the page
 * says so instead, never « réservez à nouveau »). A pending buy + book purchase whose hold ended, or whose booking
 * expired, is passed as `expired`. The Checkout URL goes only to a pending block that is not read-only, so an
 * impersonating admin's browser never receives it. The hold end is written in the PRO's zone.
 */
export function checkoutBlockOf(view: ReferenceView, ctx: BlockContext): CheckoutReturnProps | null {
  const gone = seatGoneOf(view, ctx.now);
  if (gone === "cancelled") return null;
  const status = gone === "expired" ? "expired" : view.status;
  const holdEnd = status === "pending" ? liveHoldEnd(view.holdExpiresAt, ctx.now) : null;
  return {
    slug: ctx.slug,
    purchaseId: view.purchaseId,
    kind: view.kind,
    status,
    processing: view.processing,
    resumeUrl: !ctx.readOnly && status === "pending" ? view.resumeUrl : null,
    holdUntilLabel: holdEnd === null ? null : formatTime(holdEnd, ctx.tz),
    merciHref: `/${ctx.slug}/merci?p=${encodeURIComponent(view.purchaseId)}`,
    readOnly: ctx.readOnly,
  };
}

/** What the Owner's own facts (`seanceVisitorFacts`, source "owner") say about this séance: the part the payment return reads. */
export type OwnerFacts = {
  /** her active booking: its status and its purchase (null for a booking paid with a held ticket) */
  booking: { status: "pending" | "confirmed"; purchaseId: string | null } | null;
  /** no active booking: how her latest booking on the séance ended */
  ended: "cancelled" | "expired" | null;
};

/** The purchase of the Owner's active PENDING booking: the id the page reads once more when the URL names another purchase. Null otherwise. */
export function ownerPendingPurchaseId(facts: OwnerFacts | null): string | null {
  return facts?.booking?.status === "pending" ? facts.booking.purchaseId : null;
}

export type PaymentReturn = {
  /** the booking state the page may act on: the Owner's active booking, or the reference's own (never a guest cookie's) */
  booked: PageBooking;
  /** the payment block, or null: nothing to describe, or a seat the pro cancelled */
  block: CheckoutReturnProps | null;
  /** the purchase the block shows: the Owner's holds list does not show it twice */
  shownPurchaseId: string | null;
  /** the line above the form when there is no block and no booking: the booking the pro cancelled, or how the Owner's last one ended */
  ended: "cancelled" | "expired" | null;
};

/**
 * What the séance page shows of a purchase. `reference` is the `?p=` purchase as the page may use it (`referenceForPage`:
 * on THIS séance, never another customer's of an Owner); `ownerPending` is the view of the purchase of the Owner's active
 * pending booking when the URL names another one (the page reads it by the id `ownerPendingPurchaseId` gives); `ownerFacts`
 * is the Owner's alone, never a guest cookie's.
 *
 * The purchase described: when the Owner has an active booking, only the purchase of THAT booking (her pending one wins over
 * a stale reference of her own, and « Votre place a été libérée » never sits beside « Un paiement est en attente » or
 * « Vous êtes inscrit(e) »); otherwise the reference. The line above the form comes from the same rule as the block: a seat
 * the pro cancelled gives « annulée », else the Owner's own ended booking.
 */
export function paymentReturnOf(a: {
  slug: string;
  tz: string;
  now: Date;
  readOnly: boolean;
  reference: ReferenceView | null;
  ownerFacts: OwnerFacts | null;
  ownerPending: ReferenceView | null;
}): PaymentReturn {
  const active = a.ownerFacts?.booking ?? null;
  const described: ReferenceView | null =
    active === null
      ? a.reference
      : active.purchaseId === null
        ? null
        : ([a.ownerPending, a.reference].find((v) => v?.purchaseId === active.purchaseId) ?? null);

  let booked: PageBooking = null;
  if (active !== null) booked = { status: active.status, via: "owner" };
  else if (a.reference?.booking) {
    const { booking, status, holdExpiresAt } = a.reference;
    if (booking.status === "confirmed") booked = { status: "confirmed", via: "reference" };
    else if (booking.status === "pending" && status === "pending" && liveHoldEnd(holdExpiresAt, a.now) !== null) {
      booked = { status: "pending", via: "reference" };
    }
  }

  const block = described === null ? null : checkoutBlockOf(described, a);
  const cancelledSeat = described !== null && seatGoneOf(described, a.now) === "cancelled";
  const ended = booked !== null || block !== null ? null : cancelledSeat ? "cancelled" : (a.ownerFacts?.ended ?? null);
  return { booked, block, shownPurchaseId: block?.purchaseId ?? null, ended };
}

/* ───────────────────────── what the block says ───────────────────────── */

const RELEASED_TEXT = "Votre place est libérée.";
const ENDED_TEXT = "Cette réservation n'est plus en attente de paiement.";
/** Under a pending purchase an impersonating admin may look at but not act on (no client identity, SEC-M6, G4b). */
export const READ_ONLY_TEXT = "Ce paiement ne peut être ni repris ni libéré quand vous êtes connecté en tant que ce compte.";

/** The line a release outcome leaves on the page (the action never fulfils: « Paiement reçu » only points to merci, Decision 33). */
export function releaseOutcomeText(outcome: AbandonOutcome): string {
  switch (outcome) {
    case "released":
      return RELEASED_TEXT;
    case "paid":
      return COPY.PAYMENT_RECEIVED;
    case "processing":
      return COPY.PROCESSING;
    case "already_ended":
      return ENDED_TEXT;
  }
}

export type ReturnView = "pending" | "paid" | "processing" | "expired" | "released" | "ended";

/** What the block says now: the outcome of a release made here wins over the props, which the revalidation then catches up with. */
export function returnViewOf(a: { status: "pending" | "paid" | "expired"; processing: boolean; outcome: AbandonOutcome | null }): ReturnView {
  if (a.outcome === "released") return "released";
  if (a.outcome === "already_ended") return "ended";
  if (a.outcome === "paid" || a.status === "paid") return "paid";
  if (a.outcome === "processing") return "processing";
  if (a.status === "expired") return "expired";
  return a.processing ? "processing" : "pending";
}

/** The sentence under the heading (null: nothing to say, e.g. a pending hold whose end the page could not read). */
export function returnTextOf(a: {
  view: ReturnView;
  kind: "buybook" | "shop";
  resumeUrl: string | null;
  holdUntilLabel: string | null;
  readOnly: boolean;
}): string | null {
  switch (a.view) {
    case "paid":
      return COPY.PAYMENT_RECEIVED;
    case "processing":
      return COPY.PROCESSING;
    case "released":
      return RELEASED_TEXT;
    case "ended":
      return ENDED_TEXT;
    case "expired":
      return a.kind === "buybook" ? "Votre place a été libérée. Vous pouvez réserver à nouveau." : "Ce paiement n'a pas abouti.";
    case "pending":
      if (a.kind === "shop") return "Votre achat n'est pas payé.";
      // Read-only, the page passes no Checkout URL: the block says how long the seat is held, never that it can be released.
      if (a.resumeUrl === null && !a.readOnly) return "La page de paiement a expiré. Vous pouvez libérer votre place maintenant.";
      return a.holdUntilLabel === null ? null : `Votre place est gardée jusqu'à ${a.holdUntilLabel}.`;
  }
}
