/**
 * Who sees what on a séance, an offer or an RDV page (spec L1445-1455, Decisions 9, 21, 63, 71). Pure: the page reads the
 * `?p=` purchase, the visitor and the customer facts, and these functions decide what each of them may use. The one
 * rule that runs through all of them: a `?p=` reference shows THAT purchase and its own booking, never its customer,
 * because the customer of a purchase came from an e-mail somebody typed (SEC-C1). Nothing here imports the database.
 */
import type { BookingMode, BookingStatus, PurchaseStatus } from "@/lib/tickets-vocab";

import type { PublicVisitor, WalletOwner } from "./identity";
import type { PublicSeanceState } from "./planning-view";
import type { PurchaseReference } from "./purchase-reads";

/**
 * What a purchase holds, as the payment return words it: a séance seat (`buybook`), an RDV slot (`rdv`, an occurrence
 * with no event: « créneau », never « place », P5 § 3.13) or nothing (`shop`).
 */
export type ReferenceKind = "buybook" | "rdv" | "shop";

/** What a ?p= reference lets a page show: THAT purchase and its own booking, never its customer (Decision 71). */
export type ReferenceView = {
  purchaseId: string;
  kind: ReferenceKind;
  status: PurchaseStatus;
  processing: boolean;
  livemode: boolean;
  resumeUrl: string | null;
  /** ISO */
  holdExpiresAt: string | null;
  booking: { occurrenceId: string; status: BookingStatus } | null;
};

/** The page a reference is shown on: a séance, an offer, or an RDV type (P5 dossier § 3.8). */
export type ReferencePage =
  | { kind: "seance"; occurrenceId: string }
  | { kind: "offer"; offerId: string }
  | { kind: "rdv"; ticketTypeId: string };

/**
 * The reference as this page may use it, or null: null for no reference; on a séance page when its booking is not on
 * this occurrence; on an offer page when its offer is not this offer or it has a booking; on an RDV page when it has
 * no booking, or its booking is not an RDV, or not an RDV of THIS type (a type read through the pro's own join, so a
 * row pointing at another pro's type never matches); and whenever an Owner is signed in and the reference is not her
 * customer's (OUT:74). The customerId is compared here and dropped.
 */
export function referenceForPage(
  ref: PurchaseReference | null,
  page: ReferencePage,
  owner: WalletOwner | null,
): ReferenceView | null {
  if (ref === null) return null;
  if (owner !== null && ref.customerId !== owner.customerId) return null;
  if (page.kind === "seance") {
    if (ref.booking === null || ref.booking.occurrenceId !== page.occurrenceId) return null;
  } else if (page.kind === "rdv") {
    if (ref.booking === null || !ref.booking.isRdv || ref.booking.ticketTypeId !== page.ticketTypeId) return null;
  } else if (ref.offerId !== page.offerId || ref.booking !== null) {
    return null;
  }
  return {
    purchaseId: ref.purchaseId,
    kind: ref.booking === null ? "shop" : ref.booking.isRdv ? "rdv" : "buybook",
    status: ref.status,
    processing: ref.processing,
    livemode: ref.livemode,
    resumeUrl: ref.resumeUrl,
    holdExpiresAt: ref.booking?.holdExpiresAt?.toISOString() ?? null,
    booking: ref.booking === null ? null : { occurrenceId: ref.booking.occurrenceId, status: ref.booking.status },
  };
}

export type SeanceViewer =
  | { kind: "customer"; customerId: string; source: "owner" | "guest" }
  | { kind: "reference"; reference: ReferenceView }
  | null;

/**
 * A purchase reference shows THAT purchase and its own booking, never its customer: the customer of a purchase came
 * from a typed e-mail (SEC-C1). Order: the Owner -> customer/owner; an impersonating or verified session without a
 * record -> the reference when set, else null (the cookie is ignored, L1370); the guest cookie customer ->
 * customer/guest; else the reference when set; else null. Never a typed e-mail.
 */
export function seanceViewerOf(a: { visitor: PublicVisitor; reference: ReferenceView | null }): SeanceViewer {
  const { visitor, reference } = a;
  const byReference: SeanceViewer = reference === null ? null : { kind: "reference", reference };
  if (visitor.owner !== null && visitor.state === "verified") {
    return { kind: "customer", customerId: visitor.owner.customerId, source: "owner" };
  }
  if (visitor.state === "impersonating" || visitor.state === "verified") return byReference;
  if (visitor.guestCustomerId !== null) return { kind: "customer", customerId: visitor.guestCustomerId, source: "guest" };
  return byReference;
}

/**
 * L1452: a private séance is shown to the page owner, to a customer viewer (Owner or guest) with an active booking on
 * it, or to a reference whose booking is on it (referenceForPage already checked the occurrence); else notFound().
 */
export function canSeePrivateSeance(a: {
  isPageOwner: boolean;
  viewer: SeanceViewer;
  customerHasActiveBooking: boolean;
}): boolean {
  if (a.isPageOwner) return true;
  if (a.viewer === null) return false;
  if (a.viewer.kind === "customer") return a.customerHasActiveBooking;
  return a.viewer.reference.booking !== null;
}

/**
 * The booking state the page may act on: the Owner's active booking (from seanceVisitorFacts), or the reference's own
 * booking (pending while the purchase is pending and its hold has not ended, confirmed when confirmed); NEVER the
 * guest cookie's (Decision 63).
 */
export type PageBooking = { status: "pending" | "confirmed"; via: "owner" | "reference" } | null;

/**
 * The end of a hold that is still running, else null: THE hold rule, written once (G4c). A seat counts as free from
 * `hold_expires_at` (Decision 31), even before the nightly sweep, so a hold ending at `now` or earlier is over, and no
 * readable hold end holds nothing. `seatGoneOf`, the booked state of a reference and the « gardée jusqu'à » line all ask here.
 */
export function liveHoldEnd(holdExpiresAt: string | null, now: Date): Date | null {
  if (holdExpiresAt === null) return null;
  const end = new Date(holdExpiresAt);
  return end.getTime() > now.getTime() ? end : null;
}

/**
 * Whether the seat behind a buy + book purchase is gone, so that the payment block never promises it (Task 28). The
 * booking the pro cancelled (alone or with the whole séance) is `"cancelled"` for as long as the purchase is not paid and
 * no payment is on its way: while it is still pending (its Checkout session stays open until the expiry webhook, up to 31
 * minutes in mock mode) AND once it has expired (`releasePurchase` only expires a PENDING booking, the cancelled one stays
 * cancelled), so the page says COPY.ENDED_CANCELLED in both windows, never the « réserver à nouveau » of an expired hold.
 * For a PENDING purchase only, the seat is also gone when the booking expired (the sweep) or when the hold ended (a seat
 * counts as free from `hold_expires_at`, Decision 31, even before the nightly sweep; no readable hold end holds nothing):
 * `"expired"`. An expired purchase with a booking that is not cancelled already says so through its status. A payment on
 * its way (`processing`: the webhook decides, a late payment is fulfilled from `expired`), a paid purchase and a shop
 * purchase (no seat) are never judged by the seat.
 */
export function seatGoneOf(ref: ReferenceView, now: Date): "cancelled" | "expired" | null {
  if (ref.processing || ref.booking === null || ref.status === "paid") return null;
  if (ref.booking.status === "cancelled") return "cancelled";
  if (ref.status !== "pending") return null;
  if (ref.booking.status === "expired") return "expired";
  return liveHoldEnd(ref.holdExpiresAt, now) === null ? "expired" : null;
}

export type SeancePageMode =
  | { kind: "state"; state: PublicSeanceState }
  | { kind: "booked"; status: "pending" | "confirmed"; via: "owner" | "reference" }
  | { kind: "free" }
  | { kind: "tickets"; canSpend: boolean; coveringOffers: number };

/**
 * Decision 9, precedence (exact): booked (PageBooking) -> booked; state cancelled -> state; archived -> state closed
 * (COV-M4b); private -> state closed (COV-M4a: a private séance is never bookable online); any other state than free /
 * open -> state; then the mode's form. A guest cookie's booking never hides the form: the page shows
 * COPY.GUEST_BOOKING_EXISTS above it instead.
 */
export function seancePageMode(a: {
  state: PublicSeanceState;
  archived: boolean;
  isPrivate: boolean;
  booked: PageBooking;
  mode: BookingMode;
  canSpend: boolean;
  coveringOffers: number;
}): SeancePageMode {
  if (a.booked !== null) return { kind: "booked", status: a.booked.status, via: a.booked.via };
  if (a.state.kind === "cancelled") return { kind: "state", state: a.state };
  if (a.archived || a.isPrivate) return { kind: "state", state: { kind: "closed" } };
  if (a.state.kind !== "free" && a.state.kind !== "open") return { kind: "state", state: a.state };
  if (a.mode === "free") return { kind: "free" };
  if (a.mode === "tickets") return { kind: "tickets", canSpend: a.canSpend, coveringOffers: a.coveringOffers };
  return { kind: "state", state: { kind: "onsite" } };
}
