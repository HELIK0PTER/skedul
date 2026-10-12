/**
 * The one write mechanism of the booking domain (spec § 10). Every multi-row
 * write is ONE `db.batch` = one non-interactive READ COMMITTED transaction:
 * lock first, small statements, every guard followed by a raising assert, ids
 * made in JS, rows marked by the action id `aid`, the clock passed in as $now.
 * No server-only: the actions, the seed and the DB tests all use it.
 */
import { nanoid } from "nanoid";
import { sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import type { Actor, EngineErrorCode } from "@/lib/tickets";
import type * as schema from "./schema";
import { mapDbError } from "./map-db-error";

export type Db = NeonHttpDatabase<typeof schema>;
export type Query = BatchItem<"pg">;
/** What `plan()` returns once its reads are done: the batch for one action id. */
export type BuildBatch = (aid: string) => Query[];
/** Shared by every fragment builder of one batch. */
export type BatchCtx = { db: Db; aid: string; now: Date };
export type AtomicOk = { aid: string; results: unknown[] };
export type AssertCode = EngineErrorCode | "already_paid";
export type ActorRef = { actor: Actor; userId: string | null };

/** Thrown by a `plan()` read that already knows the answer (not found, invalid input…). */
export class PlanError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    readonly detail?: string,
  ) {
    super(detail ?? code);
    this.name = "PlanError";
  }
}

export function newActionId(): string {
  return nanoid();
}

/**
 * Runs `plan()` (reads + JS ids), then its batch in one transaction. A 40P01
 * replays the SAME statements once. Every other error is thrown as is.
 */
export async function atomic(
  db: Db,
  plan: () => Promise<BuildBatch>,
  opts: { aid?: string; afterPlan?: () => Promise<void> } = {},
): Promise<AtomicOk> {
  const build = await plan();
  if (opts.afterPlan) await opts.afterPlan();
  const aid = opts.aid ?? newActionId();
  const queries = build(aid);
  if (queries.length === 0) return { aid, results: [] };
  const run = () => db.batch(queries as [Query, ...Query[]]);
  try {
    return { aid, results: await run() };
  } catch (err) {
    if (mapDbError(err, "write").type !== "deadlock") throw err;
    return { aid, results: await run() };
  }
}

export type TryAtomicResult =
  | ({ ok: true } & AtomicOk)
  | { ok: false; code: EngineErrorCode; message?: string }
  | { ok: false; code: "duplicate" };

/**
 * `atomic` + mapping (src/lib/db/map-db-error.ts). PlanError → its code.
 * With `replanOnStale`, a `stale` re-runs `plan()` once: new reads, new ids,
 * new aid (E7 following, E8, ensureHorizon). `afterPlan` (tests only) runs
 * between the FIRST plan and its batch, to stage a deterministic race.
 * Unknown errors (programming errors, other 23505) are rethrown.
 */
export async function tryAtomic(
  db: Db,
  plan: () => Promise<BuildBatch>,
  opts: { ctx?: "write" | "delete"; replanOnStale?: boolean; afterPlan?: () => Promise<void> } = {},
): Promise<TryAtomicResult> {
  const ctx = opts.ctx ?? "write";
  for (let attempt = 0; ; attempt++) {
    try {
      const done = await atomic(db, plan, { afterPlan: attempt === 0 ? opts.afterPlan : undefined });
      return { ok: true, ...done };
    } catch (err) {
      if (err instanceof PlanError) return { ok: false, code: err.code, message: err.detail };
      const mapped = mapDbError(err, ctx);
      if (mapped.type === "duplicate") return { ok: false, code: "duplicate" };
      if (mapped.type !== "code") throw err;
      if (mapped.code === "stale" && opts.replanOnStale && attempt === 0) continue;
      return { ok: false, code: mapped.code };
    }
  }
}

/* ───────────────────────── Parameter helpers ───────────────────────── */

/** A Date as a timestamptz parameter (`$n::timestamptz`). */
export function ts(d: Date): SQL {
  return sql`${d.toISOString()}::timestamptz`;
}

/** Strings as ONE text[] parameter. A bare JS array would expand to ($1, $2…). */
export function textArray(values: readonly string[]): SQL {
  return sql`${sql.param([...values])}::text[]`;
}

/** Dates as ONE timestamptz[] parameter. */
export function tsArray(values: readonly Date[]): SQL {
  return sql`${sql.param(values.map((d) => d.toISOString()))}::timestamptz[]`;
}

/** YYYY-MM-DD keys as ONE date[] parameter. */
export function dateArray(keys: readonly string[]): SQL {
  return sql`${sql.param([...keys])}::date[]`;
}

/* ───────────────────────── Statements ───────────────────────── */

/** `select skedul_assert(pred, code)`: raises P0001 `skedul:<code>` unless pred IS TRUE. */
export function G(db: Db, pred: SQL, code: AssertCode): Query {
  return db.execute(sql`select skedul_assert((${pred})::boolean, ${code}::text)`);
}

export type LockTable = "professional" | "event" | "occurrence" | "customer" | "booking" | "ticket_purchase";

/**
 * `select id from <table> where id = any($ids) order by id for update`.
 * Global order (spec § 10): professional → event → occurrence → customer →
 * booking → purchase → ticket; ascending id inside a table.
 */
export function lockRows(db: Db, table: LockTable, ids: readonly string[]): Query {
  const sorted = [...new Set(ids)].sort();
  return db.execute(
    sql`select id from ${sql.identifier(table)} where id = any(${textArray(sorted)}) order by id for update`,
  );
}

/** R(o): lazy release of elapsed holds on an occurrence this batch already locked. */
export function R(c: BatchCtx, occurrenceId: string): Query {
  return c.db.execute(sql`
    update booking set status = 'expired', ended_at = ${ts(c.now)}, ended_by = 'system',
      ended_action_id = ${c.aid}, updated_at = ${ts(c.now)}
    where occurrence_id = ${occurrenceId} and status = 'pending' and hold_expires_at < ${ts(c.now)}`);
}

/** rel(o): bookings of o ended by this action, evaluated INSIDE the SEAT statement. */
export function rel(c: BatchCtx, occurrenceId: string): SQL {
  return sql`(select count(*)::int from booking where occurrence_id = ${occurrenceId} and ended_action_id = ${c.aid})`;
}

/**
 * SEAT(o, delta): seats_taken += delta − rel(o). Called ONCE per occurrence and
 * action, after every booking end on o in this batch. An RDV falling to 0 seats
 * is cancelled. occurrence_seats_chk raises `full`. `extraSeat` (pro « +1
 * place », event séances only) raises capacity to fit.
 */
export function SEAT(c: BatchCtx, occurrenceId: string, delta: -1 | 0 | 1, opts: { extraSeat?: boolean } = {}): Query {
  const next = sql`(seats_taken + ${delta}::int - ${rel(c, occurrenceId)})`;
  return c.db.execute(sql`
    update occurrence set
      seats_taken = ${next},
      capacity = ${opts.extraSeat ? sql`greatest(capacity, ${next})` : sql`capacity`},
      capacity_override = ${opts.extraSeat ? sql`(capacity_override or ${next} > capacity)` : sql`capacity_override`},
      status = case when event_id is null and ${next} <= 0 then 'cancelled'::occurrence_status else status end,
      cancelled_at = case when event_id is null and ${next} <= 0 then coalesce(cancelled_at, ${ts(c.now)}) else cancelled_at end,
      updated_at = ${ts(c.now)}
    where id = ${occurrenceId}`);
}

/**
 * RET(aid): ONCE per action, gives back the tickets of every booking ended by
 * this action (→ available, or expired if past expires_at), one `return`
 * movement per ticket, in one statement.
 */
export function RET(c: BatchCtx, by: ActorRef): Query {
  return c.db.execute(sql`
    with u as (
      update ticket t set
        status = case when t.expires_at is not null and t.expires_at <= ${ts(c.now)}
          then 'expired'::ticket_status else 'available'::ticket_status end,
        booking_id = null, status_changed_at = ${ts(c.now)}, updated_at = ${ts(c.now)}
      from booking b
      where t.booking_id = b.id and b.ended_action_id = ${c.aid}
      returning t.id, t.professional_id, t.customer_id, t.ticket_type_id, t.purchase_id, t.status, b.id as booking_id
    )
    insert into ticket_movement (professional_id, customer_id, ticket_id, action_id, kind, from_status,
      to_status, ticket_type_id, booking_id, purchase_id, actor, actor_user_id, created_at)
    select professional_id, customer_id, id, ${c.aid}, 'return', 'booked', status,
      ticket_type_id, booking_id, purchase_id, ${by.actor}::actor, ${by.userId}, ${ts(c.now)}
    from u`);
}

/**
 * Aggregate seat release (E4 step 3, sweepHolds): for every occurrence with
 * bookings ended by this action, seats_taken −= N; an RDV at 0 is cancelled.
 * Never combine with SEAT on the same occurrence in one action.
 */
export function releaseEndedSeats(c: BatchCtx): Query {
  return c.db.execute(sql`
    update occurrence o set
      seats_taken = o.seats_taken - r.n,
      status = case when o.event_id is null and o.seats_taken - r.n <= 0 then 'cancelled'::occurrence_status else o.status end,
      cancelled_at = case when o.event_id is null and o.seats_taken - r.n <= 0 then coalesce(o.cancelled_at, ${ts(c.now)}) else o.cancelled_at end,
      updated_at = ${ts(c.now)}
    from (select occurrence_id, count(*)::int as n from booking where ended_action_id = ${c.aid} group by occurrence_id) r
    where o.id = r.occurrence_id`);
}
