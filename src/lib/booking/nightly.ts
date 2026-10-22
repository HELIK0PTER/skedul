/**
 * E12 (spec § 11): the nightly job's steps. /api/cron/daily (P4) calls
 * runNightly. Correctness never depends on it: R(o) releases holds before
 * every claim and usability never waits for `expire`.
 */
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { todayKey } from "@/lib/civil-date";
import { textArray, ts, type Db } from "@/lib/db/atomic";
import { event, professional } from "@/lib/db/schema";
import { lastSeriesDate } from "@/lib/recurrence";
import { HEALTH_KEYS, setHealth } from "@/lib/throttle";
import { THROTTLE_PURGE_DAYS } from "@/lib/tickets";

import { checkInvariants } from "./invariants";
import { ensureHorizon, ruleOf } from "./occurrences";
import { expireStalePurchases, sweepHolds } from "./release";

/** ensureHorizon calls per pro and night (each inserts at most MATERIALIZE_MAX_ROWS rows). */
const HORIZON_CALLS_PER_PRO = 10;

/** Step 4 stops starting pros this long after it began, so a slow step cannot starve steps 5 to 7 of the 300 s of the cron route (OUT:126). */
const HORIZON_DEADLINE_MS = 120_000;

/** Step 3, ONE statement: available tickets with expires_at ≤ now → expired, one `expire` movement each (actor system). */
export async function expireTickets(db: Db, now: Date = new Date()): Promise<{ expired: number }> {
  const aid = nanoid();
  const res = await db.execute(sql`
    with u as (
      update ticket set status = 'expired', status_changed_at = ${ts(now)}, updated_at = ${ts(now)}
      where status = 'available' and expires_at is not null and expires_at <= ${ts(now)}
      returning id, professional_id, customer_id, ticket_type_id, purchase_id
    )
    insert into ticket_movement (professional_id, customer_id, ticket_id, action_id, kind, from_status, to_status,
      ticket_type_id, purchase_id, actor, created_at)
    select professional_id, customer_id, id, ${aid}, 'expire'::movement_kind, 'available'::ticket_status,
      'expired'::ticket_status, ticket_type_id, purchase_id, 'system'::actor, ${ts(now)}
    from u`);
  return { expired: res.rowCount ?? 0 };
}

/**
 * Step 4: ensureHorizon for every pro with a non-archived event, looping while incomplete (≤ HORIZON_CALLS_PER_PRO calls).
 * Each pro runs in its own `try`: a throw or an `ok: false` is reported in `failures` ("pro <id>: <message or code>") and
 * the next pro still runs. Before every pro after the first, once `deadline` (epoch ms, default now + 120 s) has passed,
 * it stops starting pros and says so (OUT:126). `opts.ensure` and `opts.deadline` are test-only.
 */
export async function ensureAllHorizons(
  db: Db,
  now: Date = new Date(),
  opts: { ensure?: typeof ensureHorizon; deadline?: number } = {},
): Promise<{ pros: number; inserted: number; failures: string[] }> {
  const ensure = opts.ensure ?? ensureHorizon;
  const deadline = opts.deadline ?? Date.now() + HORIZON_DEADLINE_MS;
  const pros = await db
    .selectDistinct({ id: event.professionalId })
    .from(event)
    .where(isNull(event.archivedAt))
    .orderBy(asc(event.professionalId));
  let inserted = 0;
  let started = 0;
  const failures: string[] = [];
  for (const { id } of pros) {
    if (started > 0 && Date.now() > deadline) {
      failures.push(`deadline reached after ${started} pro(s)`);
      break;
    }
    started += 1;
    try {
      for (let call = 0; call < HORIZON_CALLS_PER_PRO; call++) {
        const res = await ensure(db, id, now);
        if (!res.ok) {
          failures.push(`pro ${id}: ${res.code}`);
          break;
        }
        inserted += res.inserted;
        if (res.complete) break;
      }
    } catch (err) {
      failures.push(`pro ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { pros: pros.length, inserted, failures };
}

/**
 * Step 5: non-archived events in until/count mode (once included) whose last
 * rule date is before local today and with no future scheduled séance →
 * archived_at = now. `never` events are archived only by « supprimer ».
 * Each event is archived only at the version read with it: the UPDATE's WHERE
 * is re-evaluated on the locked row, so an edit that extended the event while
 * the UPDATE waited (version + 1, future séances its snapshot cannot see)
 * keeps it live. `opts.afterPlan` is test-only: it runs between the read and the UPDATE.
 */
export async function archiveFinishedEvents(
  db: Db,
  now: Date = new Date(),
  opts: { afterPlan?: () => Promise<void> } = {},
): Promise<{ archived: number }> {
  const candidates = await db
    .select({ ev: event, tz: professional.timezone })
    .from(event)
    .innerJoin(professional, eq(professional.id, event.professionalId))
    .where(and(isNull(event.archivedAt), ne(event.endMode, "never")));
  const finished = candidates
    .filter(({ ev, tz }) => {
      const last = lastSeriesDate(ruleOf(ev));
      return last !== null && last < todayKey(now, tz);
    })
    .map(({ ev }) => ev);
  if (finished.length === 0) return { archived: 0 };
  if (opts.afterPlan) await opts.afterPlan();
  const res = await db.execute(sql`
    update event e set archived_at = ${ts(now)}, updated_at = ${ts(now)}
    from unnest(${textArray(finished.map((ev) => ev.id))}, ${sql.param(finished.map((ev) => ev.version))}::int[]) as v(id, version)
    where e.id = v.id and e.version = v.version and e.archived_at is null
      and not exists (select 1 from occurrence o where o.event_id = e.id and o.status = 'scheduled' and o.starts_at > ${ts(now)})`);
  return { archived: res.rowCount ?? 0 };
}

/** Step 6: throttle rows older than THROTTLE_PURGE_DAYS; `health:*` counters are kept. */
export async function purgeThrottle(db: Db, now: Date = new Date()): Promise<{ purged: number }> {
  const res = await db.execute(sql`
    delete from throttle
    where window_start < ${ts(now)} - make_interval(days => ${THROTTLE_PURGE_DAYS}::int) and key not like 'health:%'`);
  return { purged: res.rowCount ?? 0 };
}

export type NightlyReport = {
  expiredBookings: number;
  expiredPurchases: number;
  expiredTickets: number;
  horizon: { pros: number; inserted: number };
  archivedEvents: number;
  purgedThrottle: number;
  invariantViolations: number;
  /** "step: message" for each step that threw (the next steps still run) */
  errors: string[];
};

/** Steps 1 to 7 in order, each isolated; step 7 stores the violation count in `health:invariant_violations`. */
export async function runNightly(
  db: Db,
  now: Date = new Date(),
  /** Test-only: an injected `ensure` or `deadline` for step 4 (ensureAllHorizons), so a failure can be provoked without touching other runs' data. */
  opts: { horizon?: Parameters<typeof ensureAllHorizons>[2] } = {},
): Promise<NightlyReport> {
  const report: NightlyReport = {
    expiredBookings: 0,
    expiredPurchases: 0,
    expiredTickets: 0,
    horizon: { pros: 0, inserted: 0 },
    archivedEvents: 0,
    purgedThrottle: 0,
    invariantViolations: 0,
    errors: [],
  };
  const step = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (err) {
      report.errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  await step("sweepHolds", async () => {
    report.expiredBookings = (await sweepHolds(db, now)).expiredBookings;
  });
  await step("expireStalePurchases", async () => {
    report.expiredPurchases = (await expireStalePurchases(db, now)).expired;
  });
  await step("expireTickets", async () => {
    report.expiredTickets = (await expireTickets(db, now)).expired;
  });
  await step("ensureAllHorizons", async () => {
    const res = await ensureAllHorizons(db, now, opts.horizon);
    report.horizon = { pros: res.pros, inserted: res.inserted };
    // A failing pro and a deadline stop are errors of the night, not silent skips (OUT:126).
    for (const failure of res.failures) report.errors.push(`ensureAllHorizons: ${failure}`);
  });
  await step("archiveFinishedEvents", async () => {
    report.archivedEvents = (await archiveFinishedEvents(db, now)).archived;
  });
  await step("purgeThrottle", async () => {
    report.purgedThrottle = (await purgeThrottle(db, now)).purged;
  });
  await step("checkInvariants", async () => {
    const violations = await checkInvariants(db);
    report.invariantViolations = violations.length;
    for (const v of violations.slice(0, 20)) console.error(`[nightly] ${v.invariant} ${v.rowId}: ${v.detail}`);
    await setHealth(db, HEALTH_KEYS.invariantViolations, violations.length, now);
  });
  return report;
}
