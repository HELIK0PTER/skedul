/**
 * Types and tiny pure helpers shared by every public action (contract § 3.7). No `server-only`, no env, no db: the
 * cores take a `PublicPro`, an `ActionVisitor` and `PublicDeps` that the server wrapper builds from the slug, the
 * fresh session and the request, never from the action input.
 */
import type { BookingWindow } from "@/lib/booking-window";
import type { CheckoutGateway } from "@/lib/payments/checkout";
import type { SessionFacts, WalletOwner } from "@/lib/public/identity";

export type PublicPro = {
  professionalId: string;
  slug: string;
  businessName: string;
  timezone: string;
  currency: string;
  /** professional.user_id: page-owner detection only, never sent to the browser */
  ownerUserId: string;
  window: BookingWindow;
};

export type PublicDeps = {
  appUrl: string;
  checkout: CheckoutGateway;
  mockAllowed: boolean;
  /** APP_ENV, stamped on every Checkout session (SEC-I7) */
  env: string;
};

/** Built on the server per action: never from input. guestCustomerId is null for a verified or impersonating session. */
export type ActionVisitor = {
  session: SessionFacts | null;
  owner: WalletOwner | null;
  guestCustomerId: string | null;
  ipHash: string;
  wideIpHash: string | null;
};

/** The alphabet and length of a pro address (src/lib/slug.ts): the only slugs an action accepts. */
export const SLUG_PARAM_RE = /^[a-z0-9-]{1,60}$/;

/** PublicPro of a professional row: only the fields the cores need, so no Stripe or Google id travels further. */
export function publicProOfRow(row: {
  id: string;
  slug: string;
  businessName: string;
  timezone: string;
  currency: string;
  userId: string;
  bookingHorizonDays: number;
  minNoticeMinutes: number;
  cancelDeadlineHours: number;
}): PublicPro {
  return {
    professionalId: row.id,
    slug: row.slug,
    businessName: row.businessName,
    timezone: row.timezone,
    currency: row.currency,
    ownerUserId: row.userId,
    window: {
      bookingHorizonDays: row.bookingHorizonDays,
      minNoticeMinutes: row.minNoticeMinutes,
      cancelDeadlineHours: row.cancelDeadlineHours,
    },
  };
}

/** True for an object literal or a null-prototype object: what a Server Action argument is once decoded. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * A Server Action input split into its slug and the rest: a plain object gives { slug: input.slug, rest: a copy of
 * the object without slug }; anything else gives { slug: undefined, rest: input } (the wrapper answers PAGE_GONE for
 * the missing slug, and the core's strict schema refuses the rest whole, SEC-M15).
 */
export function splitActionInput(input: unknown): { slug: unknown; rest: unknown } {
  if (!isPlainObject(input)) return { slug: undefined, rest: input };
  const { slug, ...rest } = input;
  return { slug, rest };
}
