import { test } from "node:test";
import assert from "node:assert/strict";
import { and, asc, eq, gt, sql } from "drizzle-orm";

import { addDays, todayKey } from "@/lib/civil-date";
import { event, eventTicketType, occurrence, question } from "@/lib/db/schema";
import { expand, expandDates, type RecurrenceRule } from "@/lib/recurrence";
import type { RecurrenceRuleInput } from "@/lib/tickets";

import { addDaysMs, createTestPro, dbTest, deleteTestUser } from "../../test/db";
import { createTicketType } from "./catalog";
import {
  createEvent,
  ensureHorizon,
  horizonEnd,
  minGeneratedUntil,
  needsHorizon,
} from "./occurrences";

function must<T extends { ok: boolean }>(res: T): Extract<T, { ok: true }> {
  assert.equal(res.ok, true, JSON.stringify(res));
  return res as Extract<T, { ok: true }>;
}

const DAILY_NEVER = (startDate: string): RecurrenceRuleInput => ({
  startDate,
  startMinute: 600,
  freq: "daily",
  interval: 1,
  weekdays: null,
  monthlyBy: null,
  monthWeek: null,
  endMode: "never",
  untilDate: null,
  occurrenceCount: null,
});

const ONCE = (startDate: string, startMinute: number): RecurrenceRuleInput => ({
  startDate,
  startMinute,
  freq: "once",
  interval: 1,
  weekdays: null,
  monthlyBy: null,
  monthWeek: null,
  endMode: "count",
  untilDate: null,
  occurrenceCount: 1,
});

/** The expander's rule for an input rule (durationMin is an event column). */
function asRule(rule: RecurrenceRuleInput, durationMin = 60): RecurrenceRule {
  return { ...rule, durationMin };
}

async function rowsOf(db: Parameters<typeof createEvent>[0], eventId: string) {
  return db.select().from(occurrence).where(eq(occurrence.eventId, eventId)).orderBy(asc(occurrence.seriesDate));
}

async function eventRow(db: Parameters<typeof createEvent>[0], eventId: string) {
  const [row] = await db.select().from(event).where(eq(event.id, eventId));
  return row;
}

test("horizonEnd is local today + 400; needsHorizon fires under today + 393", () => {
  const now = new Date("2026-10-12T22:30:00.000Z"); // already the 13th in Paris
  assert.equal(horizonEnd(now, "Europe/Paris"), addDays("2026-10-13", 400));
  assert.equal(needsHorizon(addDays("2026-10-13", 392), now, "Europe/Paris"), true);
  assert.equal(needsHorizon(addDays("2026-10-13", 393), now, "Europe/Paris"), false);
  assert.equal(needsHorizon(null, now, "Europe/Paris"), false);
});

dbTest("createEvent materialises exactly the expander's dates, with its links and questions", async ({ db, pro }) => {
  const now = new Date();
  const { ticketTypeId } = must(await createTicketType(db, { professionalId: pro.proId, type: { name: "Collectif" } }));
  const startDate = addDays(todayKey(now, pro.tz), 1);
  const rule: RecurrenceRuleInput = {
    startDate,
    startMinute: 1140,
    freq: "weekly",
    interval: 1,
    weekdays: [1, 3],
    monthlyBy: null,
    monthWeek: null,
    endMode: "never",
    untilDate: null,
    occurrenceCount: null,
  };
  const created = must(
    await createEvent(
      db,
      {
        professionalId: pro.proId,
        event: {
          title: "Altinha débutants",
          capacity: 8,
          durationMin: 90,
          ticketTypeIds: [ticketTypeId, ticketTypeId],
          questions: [{ label: "Niveau ?", type: "choice", options: ["Débutant", "Confirmé"] }],
          rule,
        },
      },
      now,
    ),
  );

  const expected = expand(asRule(rule, 90), pro.tz, startDate, horizonEnd(now, pro.tz));
  const rows = await rowsOf(db, created.eventId);
  assert.equal(created.occurrenceCount, expected.length);
  assert.deepEqual(
    rows.map((r) => [r.seriesDate, r.startsAt.toISOString(), r.endsAt.toISOString(), r.blockStart.toISOString(), r.blockEnd.toISOString()]),
    expected.map((x) => [x.seriesDate, x.startsAt.toISOString(), x.endsAt.toISOString(), x.startsAt.toISOString(), x.endsAt.toISOString()]),
  );
  assert.ok(rows.every((r) => r.capacity === 8 && r.seatsTaken === 0 && r.status === "scheduled" && r.ticketTypeId === null));
  assert.ok(rows.every((r) => r.createdAt.getTime() === now.getTime()));

  const ev = await eventRow(db, created.eventId);
  assert.equal(ev.seriesRootId, created.eventId);
  assert.equal(ev.version, 1);
  assert.ok(ev.lastActionId);
  assert.equal(ev.generatedUntil, horizonEnd(now, pro.tz));
  assert.deepEqual(ev.weekdays, [1, 3]);
  const links = await db.select().from(eventTicketType).where(eq(eventTicketType.eventId, created.eventId));
  assert.deepEqual(
    links.map((l) => [l.ticketTypeId, l.professionalId]),
    [[ticketTypeId, pro.proId]],
  );
  const questions = await db.select().from(question).where(eq(question.eventId, created.eventId));
  assert.deepEqual(
    questions.map((q) => [q.label, q.type, q.options, q.position]),
    [["Niveau ?", "choice", ["Débutant", "Confirmé"], 0]],
  );
});

dbTest("createEvent refuses another pro's ticket type and invalid rules, writing nothing", async ({ db, pro }) => {
  const other = await createTestPro(db);
  try {
    const foreign = must(await createTicketType(db, { professionalId: other.proId, type: { name: "Ailleurs" } }));
    const startDate = addDays(todayKey(new Date(), pro.tz), 2);
    assert.deepEqual(
      await createEvent(db, {
        professionalId: pro.proId,
        event: { title: "Volé", ticketTypeIds: [foreign.ticketTypeId], rule: ONCE(startDate, 600) },
      }),
      { ok: false, code: "invalid" },
    );
    assert.deepEqual(
      await createEvent(db, {
        professionalId: pro.proId,
        event: { title: "Sans jour", rule: { ...DAILY_NEVER(startDate), freq: "weekly" } },
      }),
      { ok: false, code: "invalid", message: "Choisissez au moins un jour." },
    );
    const mine = await db.select().from(event).where(eq(event.professionalId, pro.proId));
    assert.equal(mine.length, 0);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("a count series gets exactly its N séances and is then complete", async ({ db, pro }) => {
  const startDate = addDays(todayKey(new Date(), pro.tz), 1);
  const rule: RecurrenceRuleInput = {
    startDate,
    startMinute: 600,
    freq: "weekly",
    interval: 1,
    weekdays: [1, 4],
    monthlyBy: null,
    monthWeek: null,
    endMode: "count",
    untilDate: null,
    occurrenceCount: 5,
  };
  const created = must(await createEvent(db, { professionalId: pro.proId, event: { title: "Stage", rule } }));
  const rows = await rowsOf(db, created.eventId);
  assert.equal(rows.length, 5);
  const ev = await eventRow(db, created.eventId);
  assert.equal(ev.generatedUntil, rows[4].seriesDate, "generated up to its last date");
  assert.equal(await minGeneratedUntil(db, pro.proId), null, "a complete series no longer needs the horizon");
  assert.deepEqual(await ensureHorizon(db, pro.proId), { ok: true, effects: [], inserted: 0, complete: true });
});

dbTest("Paris DST: 02:30 on 2026-03-29 shifts forward, 02:30 on 2026-10-25 takes the first instant", async ({ db, pro }) => {
  const spring = must(await createEvent(db, { professionalId: pro.proId, event: { title: "Printemps", rule: ONCE("2026-03-29", 150) } }));
  const autumn = must(await createEvent(db, { professionalId: pro.proId, event: { title: "Automne", rule: ONCE("2026-10-25", 150) } }));
  const [s] = await rowsOf(db, spring.eventId);
  const [a] = await rowsOf(db, autumn.eventId);
  assert.equal(s.startsAt.toISOString(), "2026-03-29T01:30:00.000Z");
  assert.equal(s.endsAt.toISOString(), "2026-03-29T02:30:00.000Z");
  assert.equal(a.startsAt.toISOString(), "2026-10-25T00:30:00.000Z");
});

dbTest("MATERIALIZE_MAX_ROWS caps one call; ensureHorizon finishes the job", async ({ db, pro }) => {
  const now = new Date();
  const startDate = addDays(todayKey(now, pro.tz), -200);
  const created = must(await createEvent(db, { professionalId: pro.proId, event: { title: "Quotidien", rule: DAILY_NEVER(startDate) } }, now));
  assert.equal(created.occurrenceCount, 450);
  assert.equal((await eventRow(db, created.eventId)).generatedUntil, addDays(startDate, 449));
  assert.equal(await minGeneratedUntil(db, pro.proId, now), addDays(startDate, 449));

  const more = must(await ensureHorizon(db, pro.proId, now));
  assert.deepEqual([more.inserted, more.complete], [601 - 450, true]);
  const rows = await rowsOf(db, created.eventId);
  assert.equal(rows.length, 601);
  assert.equal(rows[600].seriesDate, horizonEnd(now, pro.tz));
});

dbTest("an event created 10 days ago gets exactly the missing dates; a second call inserts nothing", async ({ db, pro }) => {
  const now = new Date();
  const past = addDaysMs(now, -10);
  const startDate = todayKey(past, pro.tz);
  const rule = DAILY_NEVER(startDate);
  const created = must(await createEvent(db, { professionalId: pro.proId, event: { title: "Ancien", rule } }, past));
  assert.equal(created.occurrenceCount, 401);
  assert.equal(await minGeneratedUntil(db, pro.proId, now), horizonEnd(past, pro.tz));

  const missing = expandDates(asRule(rule), addDays(horizonEnd(past, pro.tz), 1), horizonEnd(now, pro.tz));
  assert.ok(missing.length >= 9 && missing.length <= 11, "about ten days (a DST change may shift local midnight)");
  assert.deepEqual(await ensureHorizon(db, pro.proId, now), { ok: true, effects: [], inserted: missing.length, complete: true });
  const rows = await rowsOf(db, created.eventId);
  assert.deepEqual(
    rows.map((r) => r.seriesDate),
    expandDates(asRule(rule), startDate, horizonEnd(now, pro.tz)),
  );
  assert.equal((await eventRow(db, created.eventId)).generatedUntil, horizonEnd(now, pro.tz));
  assert.deepEqual(await ensureHorizon(db, pro.proId, now), { ok: true, effects: [], inserted: 0, complete: true });
});

dbTest("ensureHorizon re-plans once when the event changes between its read and its batch", async ({ db, pro }) => {
  const now = new Date();
  const past = addDaysMs(now, -10);
  const rule = DAILY_NEVER(todayKey(past, pro.tz));
  const created = must(await createEvent(db, { professionalId: pro.proId, event: { title: "Bougé", rule } }, past));
  const missing = expandDates(asRule(rule), addDays(horizonEnd(past, pro.tz), 1), horizonEnd(now, pro.tz));
  let hooks = 0;
  const res = must(
    await ensureHorizon(db, pro.proId, now, {
      afterPlan: async () => {
        hooks++;
        await db.execute(sql`update event set version = version + 1 where id = ${created.eventId}`);
      },
    }),
  );
  assert.equal(hooks, 1);
  assert.deepEqual([res.inserted, res.complete], [missing.length, true], "the re-plan used the new version");
});

dbTest("a split during ensureHorizon leaves no phantom séance after the new until_date", async ({ db, pro }) => {
  const now = new Date();
  const past = addDaysMs(now, -10);
  const created = must(
    await createEvent(db, { professionalId: pro.proId, event: { title: "Coupé", rule: DAILY_NEVER(todayKey(past, pro.tz)) } }, past),
  );
  const oldEnd = horizonEnd(past, pro.tz);
  const res = must(
    await ensureHorizon(db, pro.proId, now, {
      afterPlan: async () => {
        // what a split does to the old segment: version + 1, end at a date already generated
        await db.execute(sql`
          update event set version = version + 1, end_mode = 'until', until_date = ${addDays(todayKey(now, pro.tz), 5)}::date
          where id = ${created.eventId}`);
      },
    }),
  );
  assert.deepEqual([res.inserted, res.complete], [0, true]);
  const beyond = await db
    .select({ id: occurrence.id })
    .from(occurrence)
    .where(sql`${occurrence.eventId} = ${created.eventId} and ${occurrence.seriesDate} > ${oldEnd}::date`);
  assert.equal(beyond.length, 0, "nothing was generated past the old horizon");
  assert.equal(await minGeneratedUntil(db, pro.proId, now), null, "the segment now ends before its generated_until");
});

dbTest("archived events are skipped by ensureHorizon and minGeneratedUntil", async ({ db, pro }) => {
  const now = new Date();
  const past = addDaysMs(now, -10);
  const created = must(
    await createEvent(db, { professionalId: pro.proId, event: { title: "Archivé", rule: DAILY_NEVER(todayKey(past, pro.tz)) } }, past),
  );
  await db.update(event).set({ archivedAt: now }).where(eq(event.id, created.eventId));
  assert.deepEqual(await ensureHorizon(db, pro.proId, now), { ok: true, effects: [], inserted: 0, complete: true });
  assert.equal(await minGeneratedUntil(db, pro.proId, now), null);
  const late = await db
    .select({ id: occurrence.id })
    .from(occurrence)
    .where(and(eq(occurrence.eventId, created.eventId), gt(occurrence.seriesDate, horizonEnd(past, pro.tz))));
  assert.equal(late.length, 0);
});
