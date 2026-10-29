import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { addDaysMs, addMinutes, createTestPro, dbTest, deleteTestUser, type TestPro } from "../../test/db";
import { dayIn, giveTickets, makeCustomer, makeEvent, makeType, movementsOf, occurrencesOf, ticketsOf } from "../../test/fixtures";
import { ts, type Db } from "../db/atomic";
import { event } from "../db/schema";
import { HEALTH_KEYS, readHealth } from "../throttle";
import type { RecurrenceRuleInput } from "../tickets";
import { checkInvariants } from "./invariants";
import { archiveFinishedEvents, ensureAllHorizons, expireTickets, purgeThrottle, runNightly } from "./nightly";
import { horizonEnd, type ensureHorizon } from "./occurrences";
import type { sweepHolds } from "./release";

const weekly = (startDate: string, extra: Partial<RecurrenceRuleInput> = {}): RecurrenceRuleInput => ({
  startDate,
  startMinute: 600,
  freq: "weekly",
  interval: 1,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  monthlyBy: null,
  monthWeek: null,
  endMode: "never",
  untilDate: null,
  occurrenceCount: null,
  ...extra,
});

dbTest("E12 expireTickets: available tickets past expires_at become expired with one `expire` movement", async ({ db, pro }) => {
  const typeA = await makeType(db, pro);
  const customerId = await makeCustomer(db, pro);
  const now = new Date();
  const [soon] = await giveTickets(db, pro, customerId, typeA, 1, { expiresAt: addMinutes(now, 1) });
  const [forever] = await giveTickets(db, pro, customerId, typeA, 1);

  const res = await expireTickets(db, addMinutes(now, 2));
  assert.ok(res.expired >= 1);
  const byId = new Map((await ticketsOf(db, customerId)).map((t) => [t.id, t]));
  assert.equal(byId.get(soon)?.status, "expired");
  assert.equal(byId.get(forever)?.status, "available");
  const last = (await movementsOf(db, soon)).at(-1);
  assert.equal(last?.kind, "expire");
  assert.equal(last?.fromStatus, "available");
  assert.equal(last?.toStatus, "expired");

  await expireTickets(db, addMinutes(now, 3));
  assert.equal((await movementsOf(db, soon)).filter((m) => m.kind === "expire").length, 1);
});

dbTest("E12 archiveFinishedEvents: finished once/until series are archived; never and upcoming ones are not", async ({ db, pro }) => {
  const now = new Date();
  const past = addDaysMs(now, -20);
  const typeA = await makeType(db, pro);
  const { eventId: once } = await makeEvent(db, pro, { ticketTypeIds: [typeA], rule: { startDate: dayIn(pro, -18, now) } }, past);
  const { eventId: until } = await makeEvent(
    db,
    pro,
    { ticketTypeIds: [typeA], rule: weekly(dayIn(pro, -18, now), { endMode: "until", untilDate: dayIn(pro, -5, now) }) },
    past,
  );
  const { eventId: endless } = await makeEvent(db, pro, { ticketTypeIds: [typeA], rule: weekly(dayIn(pro, -18, now)) }, past);
  const { eventId: upcoming } = await makeEvent(db, pro, { ticketTypeIds: [typeA] }, now);

  const res = await archiveFinishedEvents(db, now);
  assert.ok(res.archived >= 2);
  const archivedAt = async (id: string) => (await db.select().from(event).where(eq(event.id, id)))[0]?.archivedAt?.getTime() ?? null;
  assert.equal(await archivedAt(once), now.getTime());
  assert.equal(await archivedAt(until), now.getTime());
  assert.equal(await archivedAt(endless), null);
  assert.equal(await archivedAt(upcoming), null);
});

dbTest("E12 archiveFinishedEvents: an event extended between the read and the UPDATE (version + 1) is not archived", async ({ db, pro }) => {
  const now = new Date();
  const past = addDaysMs(now, -20);
  const typeA = await makeType(db, pro);
  const finished = () =>
    makeEvent(
      db,
      pro,
      { ticketTypeIds: [typeA], rule: weekly(dayIn(pro, -18, now), { endMode: "until", untilDate: dayIn(pro, -5, now) }) },
      past,
    );
  const { eventId: extended } = await finished();
  const { eventId: untouched } = await finished();

  // Between the candidates read and the UPDATE, an edit commits on `extended`: version + 1 and a rule that
  // no longer ends. Its new séances would be invisible to the UPDATE's snapshot (it waited on the row
  // lock), which is why none is inserted here: only the version can tell.
  const res = await archiveFinishedEvents(db, now, {
    afterPlan: async () => {
      await db.execute(sql`update event set version = version + 1, end_mode = 'never', until_date = null,
        occurrence_count = null, updated_at = ${ts(now)} where id = ${extended}`);
    },
  });
  assert.ok(res.archived >= 1);
  const archivedAt = async (id: string) => (await db.select().from(event).where(eq(event.id, id)))[0]?.archivedAt?.getTime() ?? null;
  assert.equal(await archivedAt(extended), null, "the extended event stays live");
  assert.equal(await archivedAt(untouched), now.getTime());
});

dbTest("E12 ensureAllHorizons: a series created 10 days ago is brought to today + 400", async ({ db, pro }) => {
  const now = new Date();
  const typeA = await makeType(db, pro);
  const { eventId } = await makeEvent(db, pro, { ticketTypeIds: [typeA], rule: weekly(dayIn(pro, -10, now)) }, addDaysMs(now, -10));
  const res = await ensureAllHorizons(db, now);
  assert.ok(res.pros >= 1);
  assert.ok(res.inserted >= 10);
  const last = (await occurrencesOf(db, eventId)).map((o) => o.seriesDate ?? "").sort().at(-1);
  assert.equal(last, horizonEnd(now, pro.tz));
});

dbTest("E12 purgeThrottle: rows older than 2 days go; recent rows and health counters stay", async ({ db }) => {
  const now = new Date();
  const tag = nanoid(8);
  const keys = { old: `t:test:${tag}:old`, recent: `t:test:${tag}:recent`, health: `health:test-${tag}` };
  await db.execute(sql`
    insert into throttle (key, window_start, hits) values
      (${keys.old}, ${ts(addDaysMs(now, -3))}, 1),
      (${keys.recent}, ${ts(addDaysMs(now, -1))}, 1),
      (${keys.health}, ${ts(addDaysMs(now, -10))}, 7)`);
  try {
    const res = await purgeThrottle(db, now);
    assert.ok(res.purged >= 1);
    const left = await db.execute<{ key: string }>(
      sql`select key from throttle where key in (${keys.old}, ${keys.recent}, ${keys.health}) order by key`,
    );
    assert.deepEqual(
      left.rows.map((r) => r.key),
      [keys.health, keys.recent].sort(),
    );
  } finally {
    await db.execute(sql`delete from throttle where key in (${keys.old}, ${keys.recent}, ${keys.health})`);
  }
});

dbTest("E12 runNightly: every step runs, invariants hold, the count is stored for the health card", async ({ db, pro }) => {
  const typeA = await makeType(db, pro);
  await makeEvent(db, pro, { ticketTypeIds: [typeA] });
  // A populated state, not an empty pro (OUT:126): a customer with usable tickets and one that already expired.
  const customerId = await makeCustomer(db, pro);
  await giveTickets(db, pro, customerId, typeA, 2);
  await giveTickets(db, pro, customerId, typeA, 1, { now: addDaysMs(new Date(), -30), expiresAt: addDaysMs(new Date(), -1) });
  const now = new Date();
  const report = await runNightly(db, now);
  assert.deepEqual(report.errors, []);
  assert.equal(report.invariantViolations, 0);
  assert.ok(report.expiredTickets >= 1, "the expired ticket was swept");
  const health = await readHealth(db);
  assert.equal(health[HEALTH_KEYS.invariantViolations]?.value, 0);
  // I1 to I6 hold on the populated state of THIS pro before the harness cleans it up (OUT:126).
  assert.deepEqual(await checkInvariants(db, { proId: pro.proId }), []);
});

type EnsureFn = typeof ensureHorizon;
const ensureDone: EnsureFn = async () => ({ ok: true, effects: [], inserted: 0, complete: true });

/** The test pro and a second pro, each with a live event, so step 4 sees both. The caller deletes the second one. */
async function twoProsWithEvents(db: Db, pro: TestPro) {
  await makeEvent(db, pro, { ticketTypeIds: [await makeType(db, pro)] });
  const other = await createTestPro(db);
  await makeEvent(db, other, { ticketTypeIds: [await makeType(db, other)] });
  return other;
}

dbTest("E12 ensureAllHorizons: the first pro throwing, or a pro answering not ok, is reported and the next pros still run (OUT:126)", async ({ db, pro }) => {
  const other = await twoProsWithEvents(db, pro);
  try {
    const seen: string[] = [];
    // The first pro of the night throws, whoever it is (the shared branch may hold other runs' pros); our two pros
    // answer not ok when they are not that first one; every other pro is done at once.
    const ensure: EnsureFn = async (_db, proId) => {
      seen.push(proId);
      if (seen.length === 1) throw new Error("boom");
      if (proId === pro.proId || proId === other.proId) return { ok: false, code: "stale" };
      return { ok: true, effects: [], inserted: 0, complete: true };
    };
    const res = await ensureAllHorizons(db, new Date(), { ensure, deadline: Date.now() + 600_000 });
    const [first] = seen;
    assert.equal(seen.length, res.pros, "every pro was started once: a throwing pro never stops the night");
    assert.ok(seen.includes(pro.proId) && seen.includes(other.proId), "both pros were tried, whatever their order");
    assert.equal(res.failures[0], `pro ${first}: boom`, "the first pro is named with its error");
    const notFirst = [pro.proId, other.proId].filter((id) => id !== first);
    assert.ok(notFirst.length >= 1);
    for (const id of notFirst) assert.ok(res.failures.includes(`pro ${id}: stale`), JSON.stringify(res.failures));
    assert.equal(res.inserted, 0);
    assert.ok(res.pros >= 2);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("E12 ensureAllHorizons: a pro that is never complete gets at most 10 calls and its inserted rows are summed", async ({ db, pro }) => {
  await makeEvent(db, pro, { ticketTypeIds: [await makeType(db, pro)] });
  const calls: string[] = [];
  const ensure: EnsureFn = async (_db, proId) => {
    calls.push(proId);
    return proId === pro.proId
      ? { ok: true, effects: [], inserted: 2, complete: false }
      : { ok: true, effects: [], inserted: 0, complete: true };
  };
  const res = await ensureAllHorizons(db, new Date(), { ensure, deadline: Date.now() + 600_000 });
  assert.equal(calls.filter((id) => id === pro.proId).length, 10);
  assert.equal(res.inserted, 20);
  assert.deepEqual(res.failures, []);
});

dbTest("E12 ensureAllHorizons: past the deadline it stops starting pros and says so, the first pro always runs (OUT:126)", async ({ db, pro }) => {
  const other = await twoProsWithEvents(db, pro);
  try {
    const seen: string[] = [];
    const ensure: EnsureFn = async (_db, proId) => {
      seen.push(proId);
      return { ok: true, effects: [], inserted: 0, complete: true };
    };
    const late = await ensureAllHorizons(db, new Date(), { ensure, deadline: 0 });
    assert.equal(seen.length, 1, "exactly one pro was started");
    assert.deepEqual(late.failures, ["deadline reached after 1 pro(s)"]);
    assert.ok(late.pros >= 2);

    seen.length = 0;
    const onTime = await ensureAllHorizons(db, new Date(), { ensure, deadline: Date.now() + 600_000 });
    assert.equal(seen.length, onTime.pros, "every pro was started");
    assert.deepEqual(onTime.failures, []);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("E12 runNightly: a failing horizon reaches report.errors as `ensureAllHorizons: pro ...` and the other steps still run (OUT:126)", async ({ db, pro }) => {
  await makeEvent(db, pro, { ticketTypeIds: [await makeType(db, pro)] });
  const ensure: EnsureFn = async (_db, proId) => {
    if (proId === pro.proId) throw new Error("boom");
    return ensureDone(_db, proId);
  };
  const report = await runNightly(db, new Date(), { horizon: { ensure, deadline: Date.now() + 600_000 } });
  assert.ok(report.errors.includes(`ensureAllHorizons: pro ${pro.proId}: boom`), JSON.stringify(report.errors));
  assert.ok(report.errors.every((e) => e.startsWith("ensureAllHorizons: ")), "no other step failed");
  assert.equal(report.invariantViolations, 0, "step 7 still ran");
  assert.equal(report.horizon.inserted, 0);
  assert.ok(report.horizon.pros >= 1);
});

// P6 A16: the sweep reports its failed occurrences instead of throwing, and hands its Google syncs to the route.
dbTest("E12 runNightly: the sweep's failures reach report.errors as `sweepHolds: ...`, its Google syncs reach report.syncs, the other steps still run", async ({ db }) => {
  const sweep: typeof sweepHolds = async () => ({
    expiredBookings: 2,
    effects: [{ type: "google.sync_occurrence", occurrenceId: "a16-swept" }],
    failures: ["occurrence a16-drifted: boom"],
  });
  const report = await runNightly(db, new Date(), { sweep, horizon: { ensure: ensureDone, deadline: Date.now() + 600_000 } });
  assert.equal(report.expiredBookings, 2);
  assert.deepEqual(report.errors, ["sweepHolds: occurrence a16-drifted: boom"]);
  assert.deepEqual(report.syncs, [{ type: "google.sync_occurrence", occurrenceId: "a16-swept" }]);
  assert.equal(report.invariantViolations, 0, "step 7 still ran");
});