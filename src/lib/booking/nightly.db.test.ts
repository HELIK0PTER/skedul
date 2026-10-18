import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { addDaysMs, addMinutes, dbTest } from "../../test/db";
import { dayIn, giveTickets, makeCustomer, makeEvent, makeType, movementsOf, occurrencesOf, ticketsOf } from "../../test/fixtures";
import { ts } from "../db/atomic";
import { event } from "../db/schema";
import { HEALTH_KEYS, readHealth } from "../throttle";
import type { RecurrenceRuleInput } from "../tickets";
import { archiveFinishedEvents, ensureAllHorizons, expireTickets, purgeThrottle, runNightly } from "./nightly";
import { horizonEnd } from "./occurrences";

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
  const now = new Date();
  const report = await runNightly(db, now);
  assert.deepEqual(report.errors, []);
  assert.equal(report.invariantViolations, 0);
  const health = await readHealth(db);
  assert.equal(health[HEALTH_KEYS.invariantViolations]?.value, 0);
});
