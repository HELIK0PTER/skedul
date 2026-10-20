/**
 * The checks of the wallet dialogs of the client record (offer, point, unpoint, convert, close, retire). Pure and
 * client-safe: they run in the browser with parseFr before the Server Action, so a typo is named under its own field
 * in French and costs no round trip. The core checks everything again (client-actions.ts): the day of an offer against
 * the pro's today, the last day of the calendar, the ticket ids against the wallet.
 */
import { z } from "zod";

import { formatCount } from "@/lib/back-office/format";
import type { DateKey } from "@/lib/civil-date";
import { dateKeySchema } from "@/lib/tickets";
import { BOUNDS, type TicketCloseReason } from "@/lib/tickets-vocab";
import { parseFr } from "@/lib/zod-fr";

/** The reasons « Clore » offers: « Retiré » is the action « Retirer », not a choice here. */
export type CloseChoice = Exclude<TicketCloseReason, "retire">;

/** The last key of the calendar: the midnight that follows it has no key, so the core refuses it. Shared with client-actions.ts. */
export const LAST_CALENDAR_DAY: DateKey = "9999-12-31";

export const LAST_DAY_REQUIRED = "Choisissez le dernier jour de validité.";
/** The wording of the two refusals of an offer's last day: client-actions.ts imports them (its EXPIRY_IN_PAST), so the browser and the core always say the same. */
export const LAST_DAY_PAST = "La date de fin de validité doit être aujourd'hui ou plus tard.";
export const LAST_DAY_TOO_FAR = "La date de fin de validité est trop lointaine.";
export const NOTE_REQUIRED = "Précisez le motif.";

export type CountResult = { ok: true; count: number } | { ok: false; error: string };

export const NOTHING_TO_ACT_ON = "Aucun ticket disponible pour cette action.";

/**
 * The most tickets one call can take: the tickets the action still applies to, and never more than the core accepts
 * in one call (ticketIdsSchema: BOUNDS.walletQuantity). A group of 250 tickets reads « Entre 1 et 100 ».
 */
export function countCap(available: number): number {
  return Math.min(available, BOUNDS.walletQuantity);
}

/** « Indiquez un nombre entier entre 1 et 100. » (« Indiquez 1. » when one ticket is all there is, a line of its own when none is). */
export function countMessage(max: number): string {
  if (max < 1) return NOTHING_TO_ACT_ON;
  return max === 1 ? "Indiquez 1." : `Indiquez un nombre entier entre 1 et ${formatCount(max)}.`;
}

/** A whole number from 1 to `max` (the tickets the action can still take). The text of the field, trimmed; empty and non-numeric read as wrong. */
export function parseCount(raw: string, max: number): CountResult {
  const message = countMessage(max);
  if (max < 1) return { ok: false, error: message };
  const text = raw.trim();
  const schema = z.number(message).int(message).min(1, message).max(max, message);
  const parsed = parseFr(schema, text === "" ? Number.NaN : Number(text));
  return parsed.ok ? { ok: true, count: parsed.data } : { ok: false, error: message };
}

export type OfferFormValue = { quantity: string; validity: "none" | "until"; until: string };
export type OfferChecked =
  | { ok: true; quantity: number; lastValidDay: DateKey | null }
  | { ok: false; errors: { quantity?: string; until?: string } };

/**
 * « Offrir des tickets »: the quantity (1 to BOUNDS.walletQuantity) and, under « Jusqu'au », a real calendar day that is
 * `today` (the pro's day, from the server) or later. A day typed and then left under « Sans limite » is ignored.
 */
export function checkOffer(value: OfferFormValue, today: DateKey): OfferChecked {
  const errors: { quantity?: string; until?: string } = {};
  const count = parseCount(value.quantity, BOUNDS.walletQuantity);
  if (!count.ok) errors.quantity = count.error;

  let lastValidDay: DateKey | null = null;
  if (value.validity === "until") {
    if (value.until === "") {
      errors.until = LAST_DAY_REQUIRED;
    } else {
      const schema = dateKeySchema
        .refine((day) => day >= today, LAST_DAY_PAST)
        .refine((day) => day !== LAST_CALENDAR_DAY, LAST_DAY_TOO_FAR);
      const parsed = parseFr(schema, value.until);
      if (parsed.ok) lastValidDay = parsed.data;
      else errors.until = parsed.error;
    }
  }

  if (errors.quantity !== undefined || errors.until !== undefined) return { ok: false, errors };
  return count.ok ? { ok: true, quantity: count.count, lastValidDay } : { ok: false, errors };
}

export type CloseFormValue = { quantity: string; reason: CloseChoice; note: string };
export type CloseChecked =
  | { ok: true; count: number }
  | { ok: false; errors: { quantity?: string; note?: string } };

/** « Clore »: a quantity within the pool of the chosen reason, and a note when the reason is « Autre ». */
export function checkClose(value: CloseFormValue, max: number): CloseChecked {
  const errors: { quantity?: string; note?: string } = {};
  const count = parseCount(value.quantity, max);
  if (!count.ok) errors.quantity = count.error;
  if (value.reason === "autre" && value.note.trim() === "") errors.note = NOTE_REQUIRED;
  if (errors.quantity !== undefined || errors.note !== undefined) return { ok: false, errors };
  return count.ok ? { ok: true, count: count.count } : { ok: false, errors };
}
