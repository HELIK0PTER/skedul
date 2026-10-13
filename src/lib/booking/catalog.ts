/**
 * Catalog writes (spec § 9 « Archiver ou supprimer », decision 13): ticket
 * types, offers, RDV hours and questions, booking settings. Used by the seed,
 * bootstrap-content and the P3 actions (src/server/pro-catalog.ts). Every
 * statement filters professional_id; every write is one tryAtomic, so CHECK
 * and FK errors come back as engine codes.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { G, PlanError, textArray, tryAtomic, ts, type Db, type Query } from "@/lib/db/atomic";
import { availabilityRule, professional, question, ticketOffer, ticketType } from "@/lib/db/schema";
import {
  availabilityRuleInputSchema,
  bookingSettingsSchema,
  BOUNDS,
  offerInputSchema,
  questionInputSchema,
  ticketTypeInputSchema,
  type AvailabilityRuleInput,
  type BookingSettings,
  type OfferInput,
  type QuestionInput,
  type TicketTypeInput,
} from "@/lib/tickets";

import { fail, failOf, type EngineFail, type EngineResult } from "./types";

/** zod → data, or `invalid` with the first issue's message. */
function parse<S extends z.ZodType>(schema: S, input: unknown): { ok: true; data: z.output<S> } | EngineFail {
  const r = schema.safeParse(input);
  return r.success ? { ok: true, data: r.data } : fail("invalid", r.error.issues[0]?.message);
}

const typeExists = (professionalId: string, ticketTypeId: string, opts: { active?: boolean } = {}) =>
  sql`exists (select 1 from ticket_type where id = ${ticketTypeId} and professional_id = ${professionalId}${
    opts.active ? sql` and archived_at is null` : sql``
  })`;

function typeColumns(t: z.output<typeof ticketTypeInputSchema>) {
  return {
    name: t.name,
    description: t.description || null,
    color: t.color,
    rdvEnabled: t.rdvEnabled,
    rdvFree: t.rdvFree,
    rdvDurationMin: t.rdvDurationMin,
    rdvBufferBeforeMin: t.rdvBufferBeforeMin,
    rdvBufferAfterMin: t.rdvBufferAfterMin,
    rdvBookingHorizonDays: t.rdvOverrides.bookingHorizonDays,
    rdvMinNoticeMinutes: t.rdvOverrides.minNoticeMinutes,
    rdvCancelDeadlineHours: t.rdvOverrides.cancelDeadlineHours,
  };
}

function offerColumns(o: z.output<typeof offerInputSchema>) {
  return {
    label: o.label || null,
    quantity: o.quantity,
    priceCents: o.priceCents,
    validityCount: o.validityCount,
    validityUnit: o.validityUnit,
    isActive: o.isActive,
  };
}

/* ───────────────────────────── Ticket types ───────────────────────────── */

/** Inserts a type at the end of the list (position = max + 1). Errors: invalid. */
export async function createTicketType(
  db: Db,
  input: { professionalId: string; type: TicketTypeInput },
  now: Date = new Date(),
): Promise<EngineResult<{ ticketTypeId: string }>> {
  const parsed = parse(ticketTypeInputSchema, input.type);
  if (!parsed.ok) return parsed;
  const ticketTypeId = nanoid();
  const res = await tryAtomic(db, async () => () => [
    db.insert(ticketType).values({
      id: ticketTypeId,
      professionalId: input.professionalId,
      ...typeColumns(parsed.data),
      position: sql`(select coalesce(max(position) + 1, 0) from ticket_type where professional_id = ${input.professionalId})`,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
  if (!res.ok) return failOf(res);
  return { ok: true, effects: [], ticketTypeId };
}

/** Replaces the editable fields (archived or not). Errors: invalid, not_found. */
export async function updateTicketType(
  db: Db,
  input: { professionalId: string; ticketTypeId: string; type: TicketTypeInput },
  now: Date = new Date(),
): Promise<EngineResult> {
  const parsed = parse(ticketTypeInputSchema, input.type);
  if (!parsed.ok) return parsed;
  const res = await tryAtomic(db, async () => () => [
    db
      .update(ticketType)
      .set({ ...typeColumns(parsed.data), updatedAt: now })
      .where(and(eq(ticketType.id, input.ticketTypeId), eq(ticketType.professionalId, input.professionalId))),
    G(db, typeExists(input.professionalId, input.ticketTypeId), "not_found"),
  ]);
  return res.ok ? { ok: true, effects: [] } : failOf(res);
}

/** Sets or clears archived_at; offers and event links are left untouched (unarchiving restores everything). Errors: not_found. */
export async function setTicketTypeArchived(
  db: Db,
  input: { professionalId: string; ticketTypeId: string; archived: boolean },
  now: Date = new Date(),
): Promise<EngineResult> {
  const res = await tryAtomic(db, async () => () => [
    db
      .update(ticketType)
      .set({ archivedAt: input.archived ? sql`coalesce(archived_at, ${ts(now)})` : null, updatedAt: now })
      .where(and(eq(ticketType.id, input.ticketTypeId), eq(ticketType.professionalId, input.professionalId))),
    G(db, typeExists(input.professionalId, input.ticketTypeId), "not_found"),
  ]);
  return res.ok ? { ok: true, effects: [] } : failOf(res);
}

/**
 * « Supprimer »: DELETE (offers, links, questions and hours cascade). A type
 * with tickets, purchases or RDV occurrences raises 23503 (in_use) and is
 * archived instead. Errors: not_found.
 */
export async function deleteTicketType(
  db: Db,
  input: { professionalId: string; ticketTypeId: string },
  now: Date = new Date(),
): Promise<EngineResult<{ outcome: "deleted" | "archived" }>> {
  const where = and(eq(ticketType.id, input.ticketTypeId), eq(ticketType.professionalId, input.professionalId));
  const res = await tryAtomic(
    db,
    async () => {
      const [row] = await db.select({ id: ticketType.id }).from(ticketType).where(where);
      if (!row) throw new PlanError("not_found");
      return () => [db.delete(ticketType).where(where)];
    },
    { ctx: "delete" },
  );
  if (res.ok) return { ok: true, effects: [], outcome: "deleted" };
  if (res.code !== "in_use") return failOf(res);
  const archived = await setTicketTypeArchived(db, { ...input, archived: true }, now);
  return archived.ok ? { ok: true, effects: [], outcome: "archived" } : archived;
}

/* ───────────────────────────── Offers ───────────────────────────── */

/** Adds an offer at the end of its type's list. Errors: invalid, not_found (type unknown or archived). */
export async function createOffer(
  db: Db,
  input: { professionalId: string; offer: OfferInput },
  now: Date = new Date(),
): Promise<EngineResult<{ offerId: string }>> {
  const parsed = parse(offerInputSchema, input.offer);
  if (!parsed.ok) return parsed;
  const o = parsed.data;
  const offerId = nanoid();
  const res = await tryAtomic(db, async () => {
    const [type] = await db
      .select({ id: ticketType.id })
      .from(ticketType)
      .where(
        and(
          eq(ticketType.id, o.ticketTypeId),
          eq(ticketType.professionalId, input.professionalId),
          isNull(ticketType.archivedAt),
        ),
      );
    if (!type) throw new PlanError("not_found");
    return () => [
      db.insert(ticketOffer).values({
        id: offerId,
        professionalId: input.professionalId,
        ticketTypeId: o.ticketTypeId,
        ...offerColumns(o),
        position: sql`(select coalesce(max(position) + 1, 0) from ticket_offer where ticket_type_id = ${o.ticketTypeId})`,
        createdAt: now,
        updatedAt: now,
      }),
      G(db, typeExists(input.professionalId, o.ticketTypeId, { active: true }), "not_found"),
    ];
  });
  if (!res.ok) return failOf(res);
  return { ok: true, effects: [], offerId };
}

/**
 * Edits an offer (ticketTypeId is immutable and ignored). Pending purchases
 * keep their snapshot. Errors: invalid, not_found (unknown or archived offer).
 */
export async function updateOffer(
  db: Db,
  input: { professionalId: string; offerId: string; offer: OfferInput },
  now: Date = new Date(),
): Promise<EngineResult> {
  const parsed = parse(offerInputSchema, input.offer);
  if (!parsed.ok) return parsed;
  const res = await tryAtomic(db, async () => () => [
    db
      .update(ticketOffer)
      .set({ ...offerColumns(parsed.data), updatedAt: now })
      .where(
        and(
          eq(ticketOffer.id, input.offerId),
          eq(ticketOffer.professionalId, input.professionalId),
          isNull(ticketOffer.archivedAt),
        ),
      ),
    G(
      db,
      sql`exists (select 1 from ticket_offer where id = ${input.offerId} and professional_id = ${input.professionalId} and archived_at is null)`,
      "not_found",
    ),
  ]);
  return res.ok ? { ok: true, effects: [] } : failOf(res);
}

/** « Supprimer »: DELETE; an offer already bought (23503) gets archived_at instead. Errors: not_found. */
export async function deleteOffer(
  db: Db,
  input: { professionalId: string; offerId: string },
  now: Date = new Date(),
): Promise<EngineResult<{ outcome: "deleted" | "archived" }>> {
  const where = and(
    eq(ticketOffer.id, input.offerId),
    eq(ticketOffer.professionalId, input.professionalId),
    isNull(ticketOffer.archivedAt),
  );
  const res = await tryAtomic(
    db,
    async () => {
      const [row] = await db.select({ id: ticketOffer.id }).from(ticketOffer).where(where);
      if (!row) throw new PlanError("not_found");
      return () => [db.delete(ticketOffer).where(where)];
    },
    { ctx: "delete" },
  );
  if (res.ok) return { ok: true, effects: [], outcome: "deleted" };
  if (res.code !== "in_use") return failOf(res);
  const archived = await tryAtomic(db, async () => () => [
    db
      .update(ticketOffer)
      .set({ archivedAt: sql`coalesce(archived_at, ${ts(now)})`, updatedAt: now })
      .where(and(eq(ticketOffer.id, input.offerId), eq(ticketOffer.professionalId, input.professionalId))),
    G(
      db,
      sql`exists (select 1 from ticket_offer where id = ${input.offerId} and professional_id = ${input.professionalId})`,
      "not_found",
    ),
  ]);
  return archived.ok ? { ok: true, effects: [], outcome: "archived" } : failOf(archived);
}

/* ─────────────────────── RDV hours, questions, settings ─────────────────────── */

const rulesSchema = z.array(availabilityRuleInputSchema).max(7 * 24);

/**
 * Replaces, in one batch, the global weekly hours (ticketTypeId null) or the
 * hours of one type (which then replace the global ones for that type; an
 * empty list falls back to the global hours). Errors: invalid, not_found.
 */
export async function setAvailabilityRules(
  db: Db,
  input: { professionalId: string; ticketTypeId: string | null; rules: AvailabilityRuleInput[] },
  now: Date = new Date(),
): Promise<EngineResult> {
  const parsed = parse(rulesSchema, input.rules);
  if (!parsed.ok) return parsed;
  const { professionalId, ticketTypeId } = input;
  const res = await tryAtomic(db, async () => {
    if (ticketTypeId !== null) {
      const [type] = await db
        .select({ id: ticketType.id })
        .from(ticketType)
        .where(and(eq(ticketType.id, ticketTypeId), eq(ticketType.professionalId, professionalId)));
      if (!type) throw new PlanError("not_found");
    }
    const rows = parsed.data.map((r) => ({
      id: nanoid(),
      professionalId,
      ticketTypeId,
      dayOfWeek: r.dayOfWeek,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
      createdAt: now,
      updatedAt: now,
    }));
    return () => {
      const scope = ticketTypeId !== null ? eq(availabilityRule.ticketTypeId, ticketTypeId) : isNull(availabilityRule.ticketTypeId);
      const qs: Query[] = [db.delete(availabilityRule).where(and(eq(availabilityRule.professionalId, professionalId), scope))];
      if (ticketTypeId !== null) qs.push(G(db, typeExists(professionalId, ticketTypeId), "not_found"));
      if (rows.length > 0) qs.push(db.insert(availabilityRule).values(rows));
      return qs;
    };
  });
  return res.ok ? { ok: true, effects: [] } : failOf(res);
}

const questionsSchema = z.array(questionInputSchema).max(BOUNDS.questions);

/**
 * Replaces the RDV questions of a type, in one batch: questions sent with a
 * known id are updated in place, the others inserted, the missing ones
 * deleted. Position = list order. Past answers keep question_label (their
 * question_id is SET NULL). Errors: invalid, not_found, stale (a kept question
 * was deleted by another save in between: nothing is written). `opts` is
 * test-only (stages that race).
 */
export async function setTypeQuestions(
  db: Db,
  input: { professionalId: string; ticketTypeId: string; questions: QuestionInput[] },
  now: Date = new Date(),
  opts: { afterPlan?: () => Promise<void> } = {},
): Promise<EngineResult> {
  const parsed = parse(questionsSchema, input.questions);
  if (!parsed.ok) return parsed;
  const { professionalId, ticketTypeId } = input;
  const res = await tryAtomic(db, async () => {
    const [type] = await db
      .select({ id: ticketType.id })
      .from(ticketType)
      .where(and(eq(ticketType.id, ticketTypeId), eq(ticketType.professionalId, professionalId)));
    if (!type) throw new PlanError("not_found");
    const existing = new Set(
      (
        await db
          .select({ id: question.id })
          .from(question)
          .where(and(eq(question.ticketTypeId, ticketTypeId), eq(question.professionalId, professionalId)))
      ).map((q) => q.id),
    );
    const kept: string[] = [];
    const rows = parsed.data.map((q, position) => {
      const keep = q.id !== undefined && existing.has(q.id) && !kept.includes(q.id);
      const id = keep && q.id ? q.id : nanoid();
      if (keep) kept.push(id);
      return {
        keep,
        id,
        values: {
          label: q.label,
          type: q.type,
          options: q.type === "choice" ? q.options : null,
          required: q.required,
          position,
        },
      };
    });
    return () => {
      const qs: Query[] = [
        db
          .delete(question)
          .where(
            and(
              eq(question.ticketTypeId, ticketTypeId),
              eq(question.professionalId, professionalId),
              sql`${question.id} <> all(${textArray(kept)})`,
            ),
          ),
      ];
      for (const r of rows.filter((x) => x.keep)) {
        qs.push(
          db
            .update(question)
            .set({ ...r.values, updatedAt: now })
            .where(and(eq(question.id, r.id), eq(question.ticketTypeId, ticketTypeId))),
        );
      }
      // A kept question deleted since plan() (a second save) updates 0 rows without aborting: the whole save is stale.
      if (kept.length > 0) {
        qs.push(
          G(
            db,
            sql`(select count(*)::int from question where id = any(${textArray(kept)}) and ticket_type_id = ${ticketTypeId} and professional_id = ${professionalId}) = ${kept.length}::int`,
            "stale",
          ),
        );
      }
      const added = rows.filter((x) => !x.keep);
      if (added.length > 0) {
        qs.push(
          db.insert(question).values(
            added.map((r) => ({
              id: r.id,
              professionalId,
              ticketTypeId,
              ...r.values,
              createdAt: now,
              updatedAt: now,
            })),
          ),
        );
      }
      qs.push(G(db, typeExists(professionalId, ticketTypeId), "not_found"));
      return qs;
    };
  }, { afterPlan: opts.afterPlan });
  return res.ok ? { ok: true, effects: [] } : failOf(res);
}

/** The pro's booking settings (horizon, notice, client cancellation deadline). Errors: invalid, not_found. */
export async function updateBookingSettings(
  db: Db,
  input: { professionalId: string; settings: BookingSettings },
  now: Date = new Date(),
): Promise<EngineResult> {
  const parsed = parse(bookingSettingsSchema, input.settings);
  if (!parsed.ok) return parsed;
  const res = await tryAtomic(db, async () => () => [
    db
      .update(professional)
      .set({ ...parsed.data, updatedAt: now })
      .where(eq(professional.id, input.professionalId)),
    G(db, sql`exists (select 1 from professional where id = ${input.professionalId})`, "not_found"),
  ]);
  return res.ok ? { ok: true, effects: [] } : failOf(res);
}

/** True when the pro has any ticket_type, event, customer or time_off row (bootstrap-content guard). */
export async function hasDomainData(db: Db, professionalId: string): Promise<boolean> {
  const res = await db.execute<{ found: boolean }>(sql`select (
    exists (select 1 from ticket_type where professional_id = ${professionalId})
    or exists (select 1 from event where professional_id = ${professionalId})
    or exists (select 1 from customer where professional_id = ${professionalId})
    or exists (select 1 from time_off where professional_id = ${professionalId})
  ) as found`);
  return res.rows[0]?.found === true;
}
