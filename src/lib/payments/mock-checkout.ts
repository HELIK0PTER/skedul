/**
 * The simulated checkout (spec E10 « route simulée », L1145-1147, contract
 * § 3.13): what stands in for Stripe Checkout while no Stripe key is set. A
 * GET shows a page and writes nothing; a same-origin POST pays; both only for
 * SIMULATED sessions (checkout_session_id null or `mock_<id>`, SEC-M3), so the
 * mock can never settle a purchase opened against Stripe. No redirect
 * parameter anywhere: the way back is /{slug of the purchase's own pro}/merci.
 * No `server-only`, no env, no process db: the route passes `db`.
 */
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { fulfillPurchase } from "@/lib/booking/fulfillment";
import type { Effect } from "@/lib/booking/types";
import type { Db } from "@/lib/db/atomic";
import { booking, event, occurrence, professional, ticketPurchase, ticketType } from "@/lib/db/schema";
import { escapeHtml } from "@/lib/email-layout";
import { cancelPathOf, isMockSession } from "@/lib/payments/checkout";
import { COPY } from "@/lib/public/messages";
import { isReferenceId } from "@/lib/public/purchase-reads";
import { formatMoney } from "@/lib/utils";

export type MockCheckoutView = {
  purchaseId: string;
  businessName: string;
  productLabel: string;
  amountLabel: string;
  cancelPath: string;
};

/**
 * The cancel link of the simulated page: the RDV type page of an RDV purchase (P5 O5: never the séance page, which
 * sends an RDV to the espace), else the séance of a buy + book, else the offer of a shop purchase, else the pro's page.
 * `occurrenceId` is a séance's only: the caller passes null for an RDV occurrence.
 */
export function mockCancelPath(p: {
  slug: string;
  purchaseId: string;
  occurrenceId: string | null;
  offerId: string | null;
  rdvTypeId: string | null;
}): string {
  if (p.rdvTypeId) return cancelPathOf({ kind: "rdv", slug: p.slug, purchaseId: p.purchaseId, ticketTypeId: p.rdvTypeId });
  if (p.occurrenceId) {
    return cancelPathOf({ kind: "buybook", slug: p.slug, purchaseId: p.purchaseId, occurrenceId: p.occurrenceId });
  }
  if (p.offerId) return cancelPathOf({ kind: "shop", slug: p.slug, purchaseId: p.purchaseId, offerId: p.offerId });
  return `/${p.slug}`;
}

const merciPathOf = (slug: string, purchaseId: string): string => `/${slug}/merci?p=${purchaseId}`;

/** The purchase when its id has the right shape, its ticket type is its pro's own and its session is simulated (null or a mock id); null otherwise, whatever its status. A séance or event of another pro is left out of the row, not a reason to refuse it. */
async function simulatedPurchase(db: Db, purchaseId: string) {
  if (!isReferenceId(purchaseId)) return null;
  // The RDV type of the booked occurrence, a second join of ticket_type (the first is the purchase's own type).
  const rdvType = alias(ticketType, "rdv_type");
  const [row] = await db
    .select({
      purchaseId: ticketPurchase.id,
      status: ticketPurchase.status,
      checkoutSessionId: ticketPurchase.checkoutSessionId,
      label: ticketPurchase.label,
      amountCents: ticketPurchase.amountCents,
      currency: ticketPurchase.currency,
      offerId: ticketPurchase.offerId,
      ticketTypeName: ticketType.name,
      slug: professional.slug,
      businessName: professional.businessName,
      // From the filtered join, not from the booking: a booking that points to another pro's séance has no séance here.
      occurrenceId: occurrence.id,
      // Set for an RDV occurrence (occurrence_kind_chk: an event or a ticket type, never both), null for a séance.
      occurrenceTypeId: occurrence.ticketTypeId,
      // The RDV's type through this pro's own join: a type of another pro is left out, its id never reaches the page.
      rdvTypeId: rdvType.id,
      eventTitle: event.title,
    })
    .from(ticketPurchase)
    .innerJoin(professional, eq(professional.id, ticketPurchase.professionalId))
    // The ticket type must be this pro's own too (its foreign key is single-column): a purchase that crossed two pros is
    // not found, so another pro's type name never reaches this pro's checkout page and the mock never pays such a row (G3b).
    .innerJoin(
      ticketType,
      and(eq(ticketType.id, ticketPurchase.ticketTypeId), eq(ticketType.professionalId, ticketPurchase.professionalId)),
    )
    .leftJoin(
      booking,
      and(eq(booking.purchaseId, ticketPurchase.id), eq(booking.professionalId, ticketPurchase.professionalId)),
    )
    // The séance and its event must be this pro's own (the foreign keys are single-column, so a row that crossed two pros
    // would otherwise put another pro's event title or séance id on this pro's checkout page): the same filters as
    // purchaseByReference (G2b).
    .leftJoin(
      occurrence,
      and(eq(occurrence.id, booking.occurrenceId), eq(occurrence.professionalId, ticketPurchase.professionalId)),
    )
    .leftJoin(event, and(eq(event.id, occurrence.eventId), eq(event.professionalId, ticketPurchase.professionalId)))
    .leftJoin(
      rdvType,
      and(eq(rdvType.id, occurrence.ticketTypeId), eq(rdvType.professionalId, ticketPurchase.professionalId)),
    )
    .where(eq(ticketPurchase.id, purchaseId));
  if (!row) return null;
  if (row.checkoutSessionId !== null && !isMockSession(row.checkoutSessionId)) return null;
  return row;
}

/** GET of the simulated checkout (no write): a pending purchase whose checkout_session_id is null or a mock id → its view; a paid one → its merci path; else null (a purchase opened against Stripe is never shown here, SEC-M3). */
export async function mockCheckoutState(
  db: Db,
  purchaseId: string,
): Promise<{ kind: "pending"; view: MockCheckoutView } | { kind: "paid"; merciPath: string } | null> {
  const p = await simulatedPurchase(db, purchaseId);
  if (!p) return null;
  if (p.status === "paid") return { kind: "paid", merciPath: merciPathOf(p.slug, p.purchaseId) };
  if (p.status !== "pending") return null;
  return {
    kind: "pending",
    view: {
      purchaseId: p.purchaseId,
      businessName: p.businessName,
      productLabel: `${p.eventTitle ?? p.ticketTypeName} · ${p.label}`,
      amountLabel: formatMoney(p.amountCents, p.currency),
      cancelPath: mockCancelPath({
        slug: p.slug,
        purchaseId: p.purchaseId,
        // An RDV occurrence is never sent to the séance page; a crossed RDV type falls back to the offer or the page.
        occurrenceId: p.occurrenceTypeId === null ? p.occurrenceId : null,
        offerId: p.offerId,
        rdvTypeId: p.rdvTypeId,
      }),
    },
  };
}

export type MockPayResult = { kind: "paid"; merciPath: string; effects: Effect[] } | { kind: "not_found" };

/** POST: only a purchase whose checkout_session_id is null or isMockSession (SEC-M3, « the mock pays only simulated sessions »): fulfillPurchase(db, id, { sessionId: null, paymentIntentId: null, livemode: false }) (L1112); merciPath = /{slug of the purchase's own pro}/merci?p={id} (L1146-1147: no redirect parameter); anything else → not_found. */
export async function mockPay(db: Db, purchaseId: string, now: Date): Promise<MockPayResult> {
  const p = await simulatedPurchase(db, purchaseId);
  if (!p) return { kind: "not_found" };
  const res = await fulfillPurchase(db, p.purchaseId, { sessionId: null, paymentIntentId: null, livemode: false }, now);
  // The purchase vanished between this read and the engine's own read (its pro was deleted in that instant): nothing
  // was paid, so the answer is not found. The engine has already done what it does for any payment on a missing
  // purchase: logged « [stripe] orphan payment -/- » (no ids) and counted it in the admin orphan counter. Only an id that
  // is not there at the first read (above) leaves that counter alone.
  if (res.outcome === "orphan") return { kind: "not_found" };
  return { kind: "paid", merciPath: merciPathOf(p.slug, p.purchaseId), effects: res.effects };
}

const STYLE = `
    body { margin: 0; background: #f4f4f5; color: #18181b; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; }
    main { box-sizing: border-box; max-width: 28rem; margin: 2rem auto; padding: 1.5rem; background: #fff; border: 1px solid #e4e4e7; border-radius: 1rem; }
    h1 { margin: 0 0 1rem; font-size: 1.25rem; }
    .business { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
    .product { margin: 0.25rem 0 0; overflow-wrap: anywhere; }
    .amount { margin: 0.25rem 0 1rem; font-size: 1.5rem; font-weight: 700; }
    .note { margin: 0 0 1.25rem; padding: 0.75rem; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 0.5rem; color: #78350f; font-size: 0.875rem; }
    button { font: inherit; font-weight: 600; padding: 0.75rem 1.25rem; color: #fff; background: #4f46e5; border: 0; border-radius: 0.625rem; cursor: pointer; }
    button:focus-visible, a:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }
    a { color: #4338ca; }
    .back { margin: 1rem 0 0; }
    @media (max-width: 640px) {
      main { margin: 0; border-radius: 0; border-left: 0; border-right: 0; }
      button { width: 100%; }
    }`;

/** Server-built page « Paiement simulé » (exact copy below); every value escaped; no script; the form POSTs to /api/mock-checkout. */
export function mockCheckoutHtml(view: MockCheckoutView): string {
  const e = escapeHtml;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="strict-origin">
<title>Paiement simulé</title>
<style>${STYLE}
</style>
</head>
<body>
<main>
  <h1>Paiement simulé</h1>
  <p class="business">${e(view.businessName)}</p>
  <p class="product">${e(view.productLabel)}</p>
  <p class="amount">${e(view.amountLabel)}</p>
  <p class="note">${e(COPY.PAYMENTS_TEST_MOCK)}</p>
  <form method="post" action="/api/mock-checkout">
    <input type="hidden" name="purchase" value="${e(view.purchaseId)}">
    <button type="submit">Payer (simulation)</button>
  </form>
  <p class="back"><a href="${e(view.cancelPath)}">Annuler et revenir</a></p>
</main>
</body>
</html>`;
}
