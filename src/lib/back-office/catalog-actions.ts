/**
 * Catalog cores (spec § 9 and § 13.1): ticket types, offers, per-type RDV
 * hours and questions. Each core takes (db, ctx, input, now), validates its
 * input with parseFr BEFORE the engine (no English zod text reaches the UI),
 * checks the P3 rules the engine does not know (rdv_free, effective booking
 * window) and turns engine failures into French (context "catalog").
 * professionalId always comes from ctx. No server-only and no next/*: the
 * "use server" wrappers live in src/server/pro-catalog.ts.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  createOffer,
  createTicketType,
  deleteOffer,
  deleteTicketType,
  setAvailabilityRules,
  setTicketTypeArchived,
  setTypeQuestions,
  updateOffer,
  updateTicketType,
} from "@/lib/booking/catalog";
import type { EngineFail } from "@/lib/booking/types";
import { effectiveWindow } from "@/lib/booking-window";
import type { Db } from "@/lib/db/atomic";
import { ticketOffer, ticketType } from "@/lib/db/schema";
import {
  availabilityRuleInputSchema,
  BOUNDS,
  idSchema,
  offerInputSchema,
  questionInputSchema,
  ticketTypeInputSchema,
  type AvailabilityRuleInput,
  type OfferInput,
  type QuestionInput,
  type TicketTypeInput,
} from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";

import { readFreeBlockers, readProWindow } from "./catalog-reads";
import { NOTICE_TOO_LONG, noticeExceedsHorizon } from "./notice";
import { offerPriceMinimumError, offerPriceRefusal, stripeMinimumCents } from "./offer-price";
import { actionFail, fromEngine, type ActionFail, type CoreResult, type ProCtx } from "./result";
import { mergeAvailabilityRules } from "./week-hours";

export type TicketTypePatch = Partial<TicketTypeInput>;

export const RDV_FREE_NO_OFFER = "Un rendez-vous gratuit ne se vend pas : retirez l'option « Gratuit » pour créer une offre.";
/** Shown when an existing offer would be (or stay) en vente on a free type: it has to stay « Pas en vente ». */
export const RDV_FREE_OFFER_STAYS_OFF = "Un rendez-vous gratuit ne se vend pas : cette offre doit rester hors vente.";
export const RDV_FREE_HAS_SALES =
  "Ce type a des offres en vente, un paiement en cours, des tickets valides ou des réservations à venir : il ne peut pas devenir gratuit.";

/** Test-only: passed to the engine, it runs between the engine's plan and its batch (after this core's own checks). */
type RaceOpts = { afterPlan?: () => Promise<void> };

/**
 * An engine failure in French. On these paths the engine's `stale` is only its FR:F9 guard: the type turned
 * « Gratuit » (or the switch met a sale) after this core's own check, in another tab of the pro. It reads as the
 * free-type sentence of the action (`onStale`), the code kept.
 */
function catalogFail(res: EngineFail, onStale: string): ActionFail {
  return res.code === "stale" ? actionFail(onStale, "stale") : fromEngine(res, "catalog");
}

/** Hours of one type: at most 24 ranges a day. */
const MAX_HOURS_RULES = 7 * 24;

const typeIdSchema = z.object({ ticketTypeId: idSchema });
const archiveSchema = z.object({ ticketTypeId: idSchema, archived: z.boolean() });
const updateTypeSchema = z.object({ ticketTypeId: idSchema, patch: z.record(z.string(), z.unknown()) });
const offerIdSchema = z.object({ offerId: idSchema });
const updateOfferSchema = z.object({ offerId: idSchema, offer: z.record(z.string(), z.unknown()) });
const offerActiveSchema = z.object({ offerId: idSchema, isActive: z.boolean() });
const hoursSchema = z.object({
  ticketTypeId: idSchema,
  rules: z.array(availabilityRuleInputSchema).max(MAX_HOURS_RULES),
});
const questionsSchema = z.object({
  ticketTypeId: idSchema,
  questions: z.array(questionInputSchema).max(BOUNDS.questions),
});

/** The fields a patch may carry (anything else is ignored). */
const PATCH_KEYS = [
  "name",
  "description",
  "color",
  "rdvEnabled",
  "rdvFree",
  "rdvDurationMin",
  "rdvBufferBeforeMin",
  "rdvBufferAfterMin",
  "rdvOverrides",
] as const satisfies readonly (keyof TicketTypeInput)[];

type ParsedType = z.output<typeof ticketTypeInputSchema>;

const notFound = (): ActionFail => fromEngine({ ok: false, code: "not_found" }, "catalog");

/** Row → TicketTypeInput (the base a patch is merged over). */
function typeInputOf(row: typeof ticketType.$inferSelect): TicketTypeInput {
  return {
    name: row.name,
    description: row.description,
    color: row.color,
    rdvEnabled: row.rdvEnabled,
    rdvFree: row.rdvFree,
    rdvDurationMin: row.rdvDurationMin,
    rdvBufferBeforeMin: row.rdvBufferBeforeMin,
    rdvBufferAfterMin: row.rdvBufferAfterMin,
    rdvOverrides: {
      bookingHorizonDays: row.rdvBookingHorizonDays,
      minNoticeMinutes: row.rdvMinNoticeMinutes,
      cancelDeadlineHours: row.rdvCancelDeadlineHours,
    },
  };
}

/** The type row of this pro (null for another pro's or an unknown id). */
async function readType(db: Db, professionalId: string, ticketTypeId: string) {
  const [row] = await db
    .select()
    .from(ticketType)
    .where(and(eq(ticketType.id, ticketTypeId), eq(ticketType.professionalId, professionalId)));
  return row ?? null;
}

/** The non-archived offer of this pro (null otherwise). */
async function readOffer(db: Db, professionalId: string, offerId: string) {
  const [row] = await db
    .select()
    .from(ticketOffer)
    .where(and(eq(ticketOffer.id, offerId), eq(ticketOffer.professionalId, professionalId), isNull(ticketOffer.archivedAt)));
  return row ?? null;
}

/**
 * True while one of the facts of readFreeBlockers holds at `now`: an offer en vente, a checkout that can still be
 * paid, a usable ticket, or a ticket booked on an occurrence to come. The page reads the same facts (canBecomeFree).
 */
async function hasSalesOrTickets(db: Db, professionalId: string, ticketTypeId: string, now: Date): Promise<boolean> {
  const f = await readFreeBlockers(db, professionalId, ticketTypeId, now);
  return f.offersOnSale + f.livePurchases + f.usableTickets + f.upcomingBooked > 0;
}

/** NOTICE_TOO_LONG when an RDV type's effective notice is longer than its effective horizon. */
async function noticeRefusal(db: Db, ctx: ProCtx, type: ParsedType): Promise<ActionFail | null> {
  if (!type.rdvEnabled) return null;
  const pro = await readProWindow(db, ctx.professionalId);
  if (!pro) return notFound();
  const effective = effectiveWindow(pro, type.rdvOverrides);
  return noticeExceedsHorizon(effective.minNoticeMinutes, effective.bookingHorizonDays) ? actionFail(NOTICE_TOO_LONG) : null;
}

/**
 * RDV_FREE_OFFER_STAYS_OFF when an existing offer would be (or stay) en vente on an rdv_free type:
 * its tickets are usable nowhere. An offer left inactive by the switch to « Gratuit » can still be
 * edited as long as it stays « Pas en vente » (isActive false).
 */
async function freeTypeRefusal(db: Db, professionalId: string, ticketTypeId: string, isActive: boolean): Promise<ActionFail | null> {
  if (!isActive) return null;
  const [t] = await db
    .select({ rdvFree: ticketType.rdvFree })
    .from(ticketType)
    .where(and(eq(ticketType.id, ticketTypeId), eq(ticketType.professionalId, professionalId)));
  return t?.rdvFree ? actionFail(RDV_FREE_OFFER_STAYS_OFF) : null;
}

/* ───────────────────────────── Ticket types ───────────────────────────── */

/** parseFr(ticketTypeInputSchema), RDV window check, createTicketType. */
export async function createTicketTypeCore(
  db: Db,
  ctx: ProCtx,
  input: TicketTypeInput,
  now: Date,
): Promise<CoreResult<{ ticketTypeId: string }>> {
  const parsed = parseFr(ticketTypeInputSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const refusal = await noticeRefusal(db, ctx, parsed.data);
  if (refusal) return refusal;
  const res = await createTicketType(db, { professionalId: ctx.professionalId, type: parsed.data }, now);
  return res.ok ? res : fromEngine(res, "catalog");
}

/**
 * Reads the type (pro), merges the patch over its current values, parseFr the
 * full type, refuses rdvFree false → true while an offer en vente, a live checkout, a usable ticket or a ticket
 * booked on an occurrence to come exists (RDV_FREE_HAS_SALES; tickets booked on over séances do not count, see
 * readFreeBlockers), refuses an effective notice longer than
 * the horizon (NOTICE_TOO_LONG) when the patch carries rdvEnabled or rdvOverrides,
 * then updateTicketType (whose batch re-checks the switch: its stale is RDV_FREE_HAS_SALES).
 */
export async function updateTicketTypeCore(
  db: Db,
  ctx: ProCtx,
  input: { ticketTypeId: string; patch: TicketTypePatch },
  now: Date,
  opts: RaceOpts = {},
): Promise<CoreResult> {
  const head = parseFr(updateTypeSchema, input);
  if (!head.ok) return actionFail(head.error);
  const row = await readType(db, ctx.professionalId, head.data.ticketTypeId);
  if (!row) return notFound();

  const merged: Record<string, unknown> = { ...typeInputOf(row) };
  for (const key of PATCH_KEYS) {
    const value = head.data.patch[key];
    if (value !== undefined) merged[key] = value;
  }
  const parsed = parseFr(ticketTypeInputSchema, merged);
  if (!parsed.ok) return actionFail(parsed.error);

  if (parsed.data.rdvFree && !row.rdvFree && (await hasSalesOrTickets(db, ctx.professionalId, row.id, now))) {
    return actionFail(RDV_FREE_HAS_SALES);
  }
  // The window is checked only when the patch touches it: a rename from the « Informations » card must not
  // be refused for booking rules that card does not show (e.g. the pro lowered their horizon since).
  const touchesWindow = head.data.patch.rdvEnabled !== undefined || head.data.patch.rdvOverrides !== undefined;
  const refusal = touchesWindow ? await noticeRefusal(db, ctx, parsed.data) : null;
  if (refusal) return refusal;

  const res = await updateTicketType(db, { professionalId: ctx.professionalId, ticketTypeId: row.id, type: parsed.data }, now, opts);
  return res.ok ? res : catalogFail(res, RDV_FREE_HAS_SALES);
}

export async function setTicketTypeArchivedCore(
  db: Db,
  ctx: ProCtx,
  input: { ticketTypeId: string; archived: boolean },
  now: Date,
): Promise<CoreResult> {
  const parsed = parseFr(archiveSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await setTicketTypeArchived(
    db,
    { professionalId: ctx.professionalId, ticketTypeId: parsed.data.ticketTypeId, archived: parsed.data.archived },
    now,
  );
  return res.ok ? res : fromEngine(res, "catalog");
}

/** deleteTicketType: physical delete when unused, else archived (outcome). */
export async function deleteTicketTypeCore(
  db: Db,
  ctx: ProCtx,
  input: { ticketTypeId: string },
  now: Date,
): Promise<CoreResult<{ outcome: "deleted" | "archived" }>> {
  const parsed = parseFr(typeIdSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await deleteTicketType(db, { professionalId: ctx.professionalId, ticketTypeId: parsed.data.ticketTypeId }, now);
  return res.ok ? res : fromEngine(res, "catalog");
}

/* ───────────────────────────── Offers ───────────────────────────── */

/**
 * parseFr(offerInputSchema, input), then the Stripe minimum of the pro's currency (P4 final review PAY-3): a price under
 * it, 0 included, is refused with « Prix : minimum 0,50 € » (offerPriceRefusal), never the schema's « minimum 1 », a
 * count of cents the pro never typed. The schema's other refusals stand when the price is not under it.
 */
function parseOffer(input: unknown, currency: string) {
  const parsed = parseFr(offerInputSchema, input);
  const price = typeof input === "object" && input !== null ? (input as { priceCents?: unknown }).priceCents : undefined;
  const underMinimum = offerPriceRefusal(price, currency);
  return underMinimum === null ? parsed : { ok: false as const, error: underMinimum };
}

/** parseOffer (the schema, then the Stripe minimum of ctx.currency); the type must be the pro's, not archived, not rdv_free (RDV_FREE_NO_OFFER, also the engine's stale); createOffer. */
export async function createOfferCore(
  db: Db,
  ctx: ProCtx,
  input: OfferInput,
  now: Date,
  opts: RaceOpts = {},
): Promise<CoreResult<{ offerId: string }>> {
  const parsed = parseOffer(input, ctx.currency);
  if (!parsed.ok) return actionFail(parsed.error);
  const [type] = await db
    .select({ rdvFree: ticketType.rdvFree })
    .from(ticketType)
    .where(
      and(
        eq(ticketType.id, parsed.data.ticketTypeId),
        eq(ticketType.professionalId, ctx.professionalId),
        isNull(ticketType.archivedAt),
      ),
    );
  if (!type) return notFound();
  if (type.rdvFree) return actionFail(RDV_FREE_NO_OFFER);
  const res = await createOffer(db, { professionalId: ctx.professionalId, offer: parsed.data }, now, opts);
  return res.ok ? res : catalogFail(res, RDV_FREE_NO_OFFER);
}

/** parseOffer (the schema, then the Stripe minimum of ctx.currency) with ticketTypeId forced to the offer's own type; no en vente offer on an rdv_free type (RDV_FREE_OFFER_STAYS_OFF, also the engine's stale); updateOffer. */
export async function updateOfferCore(
  db: Db,
  ctx: ProCtx,
  input: { offerId: string; offer: OfferInput },
  now: Date,
  opts: RaceOpts = {},
): Promise<CoreResult> {
  const head = parseFr(updateOfferSchema, input);
  if (!head.ok) return actionFail(head.error);
  const row = await readOffer(db, ctx.professionalId, head.data.offerId);
  if (!row) return notFound();
  const parsed = parseOffer({ ...head.data.offer, ticketTypeId: row.ticketTypeId }, ctx.currency);
  if (!parsed.ok) return actionFail(parsed.error);
  const refusal = await freeTypeRefusal(db, ctx.professionalId, row.ticketTypeId, parsed.data.isActive);
  if (refusal) return refusal;
  const res = await updateOffer(db, { professionalId: ctx.professionalId, offerId: row.id, offer: parsed.data }, now, opts);
  return res.ok ? res : catalogFail(res, RDV_FREE_OFFER_STAYS_OFF);
}

/**
 * « En vente » toggle: reads the offer (pro, not archived), refuses to put it en vente on an rdv_free type
 * (RDV_FREE_OFFER_STAYS_OFF) or under the Stripe minimum of ctx.currency (an offer written before PAY-3: it can be
 * taken off sale, never put back on it until its price is raised) and calls updateOffer with its fields and the new isActive
 * (the engine's stale is RDV_FREE_OFFER_STAYS_OFF too).
 */
export async function setOfferActiveCore(
  db: Db,
  ctx: ProCtx,
  input: { offerId: string; isActive: boolean },
  now: Date,
  opts: RaceOpts = {},
): Promise<CoreResult> {
  const parsed = parseFr(offerActiveSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const row = await readOffer(db, ctx.professionalId, parsed.data.offerId);
  if (!row) return notFound();
  if (parsed.data.isActive && row.priceCents < stripeMinimumCents(ctx.currency)) {
    return actionFail(`${offerPriceMinimumError(ctx.currency)} Modifiez son prix pour la mettre en vente.`);
  }
  const refusal = await freeTypeRefusal(db, ctx.professionalId, row.ticketTypeId, parsed.data.isActive);
  if (refusal) return refusal;
  const res = await updateOffer(
    db,
    {
      professionalId: ctx.professionalId,
      offerId: row.id,
      offer: {
        ticketTypeId: row.ticketTypeId,
        label: row.label,
        quantity: row.quantity,
        priceCents: row.priceCents,
        validityCount: row.validityCount,
        validityUnit: row.validityUnit,
        isActive: parsed.data.isActive,
      },
    },
    now,
    opts,
  );
  return res.ok ? res : catalogFail(res, RDV_FREE_OFFER_STAYS_OFF);
}

export async function deleteOfferCore(
  db: Db,
  ctx: ProCtx,
  input: { offerId: string },
  now: Date,
): Promise<CoreResult<{ outcome: "deleted" | "archived" }>> {
  const parsed = parseFr(offerIdSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await deleteOffer(db, { professionalId: ctx.professionalId, offerId: parsed.data.offerId }, now);
  return res.ok ? res : fromEngine(res, "catalog");
}

/* ───────────────────────────── Hours and questions ───────────────────────────── */

/** Per-type RDV hours (empty list = back to the global hours): parseFr(array of availabilityRuleInputSchema, max 168), overlapping and touching ranges of a day merged into one, setAvailabilityRules. */
export async function setTypeHoursCore(
  db: Db,
  ctx: ProCtx,
  input: { ticketTypeId: string; rules: AvailabilityRuleInput[] },
  now: Date,
): Promise<CoreResult> {
  const parsed = parseFr(hoursSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await setAvailabilityRules(
    db,
    { professionalId: ctx.professionalId, ticketTypeId: parsed.data.ticketTypeId, rules: mergeAvailabilityRules(parsed.data.rules) },
    now,
  );
  return res.ok ? res : fromEngine(res, "catalog");
}

/** RDV questions: parseFr(array of questionInputSchema, max 20), setTypeQuestions. */
export async function setTypeQuestionsCore(
  db: Db,
  ctx: ProCtx,
  input: { ticketTypeId: string; questions: QuestionInput[] },
  now: Date,
): Promise<CoreResult> {
  const parsed = parseFr(questionsSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await setTypeQuestions(
    db,
    { professionalId: ctx.professionalId, ticketTypeId: parsed.data.ticketTypeId, questions: parsed.data.questions },
    now,
  );
  return res.ok ? res : fromEngine(res, "catalog");
}
