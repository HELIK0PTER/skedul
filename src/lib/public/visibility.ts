/**
 * Who sees what on a séance or an offer page (spec L1445-1455, Decisions 9, 21, 63, 71). Pure: the page reads the
 * `?p=` purchase, the visitor and the customer facts, and these functions decide what each of them may use. The one
 * rule that runs through all of them: a `?p=` reference shows THAT purchase and its own booking, never its customer,
 * because the customer of a purchase came from an e-mail somebody typed (SEC-C1). Nothing here imports the database.
 */
import type { BookingMode, BookingStatus, PurchaseStatus } from "@/lib/tickets-vocab";

import type { PublicVisitor, WalletOwner } from "./identity";
import type { PublicSeanceState } from "./planning-view";
import type { PurchaseReference } from "./purchase-reads";

/** What a ?p= reference lets a page show: THAT purchase and its own booking, never its customer (Decision 71). */
export type ReferenceView = {
  purchaseId: string;
  kind: "buybook" | "shop";
  status: PurchaseStatus;
  processing: boolean;
  livemode: boolean;
  resumeUrl: string | null;
  /** ISO */
  holdExpiresAt: string | null;
  booking: { occurrenceId: string; status: BookingStatus } | null;
};

/**
 * The reference as this page may use it, or null: null for no reference; on a séance page when its booking is not on
 * this occurrence; on an offer page when its offer is not this offer or it has a booking; and whenever an Owner is
 * signed in and the reference is not her customer's (OUT:74). The customerId is compared here and dropped.
 */
export function referenceForPage(
  ref: PurchaseReference | null,
  page: { kind: "seance"; occurrenceId: string } | { kind: "offer"; offerId: string },
  owner: WalletOwner | null,
): ReferenceView | null {
  if (ref === null) return null;
  if (owner !== null && ref.customerId !== owner.customerId) return null;
  if (page.kind === "seance") {
    if (ref.booking === null || ref.booking.occurrenceId !== page.occurrenceId) return null;
  } else if (ref.offerId !== page.offerId || ref.booking !== null) {
    return null;
  }
  return {
    purchaseId: ref.purchaseId,
    kind: ref.booking === null ? "shop" : "buybook",
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
 * Whether the seat behind a pending buy + book purchase is gone although its Checkout session may still be open, so that
 * the payment block never promises it (Task 28). Two ways: the hold ended (a seat counts as free from `hold_expires_at`,
 * Decision 31, even before the nightly sweep; no readable hold end holds nothing), or the booking is no longer pending
 * (the pro cancelled it or the whole séance, the sweep expired it) while the purchase waits for the expiry webhook, up to
 * 31 minutes in mock mode. `"cancelled"` wins over a lapsed hold: the page then says COPY.ENDED_CANCELLED instead of the
 * « réserver à nouveau » of an expired hold. A payment on its way (`processing`: the webhook decides), a settled purchase
 * and a shop purchase (no seat) are never judged by the seat.
 */
export function seatGoneOf(ref: ReferenceView, now: Date): "cancelled" | "expired" | null {
  if (ref.status !== "pending" || ref.processing || ref.booking === null) return null;
  if (ref.booking.status === "cancelled") return "cancelled";
  if (ref.booking.status === "expired") return "expired";
  const holdEnd = ref.holdExpiresAt === null ? null : new Date(ref.holdExpiresAt).getTime();
  return holdEnd !== null && holdEnd > now.getTime() ? null : "expired";
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
