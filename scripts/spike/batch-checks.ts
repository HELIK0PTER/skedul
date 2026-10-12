import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

import { pgErrorInfo, skedulCode } from "@/lib/db/pg-error";

import { client, db, setupScratch, type SpikeCheck } from "./db";

async function count(text: string): Promise<number> {
  const rows = (await client.query(text)) as { c: number }[];
  return rows[0].c;
}

async function failureOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  assert.fail("expected the statement to fail");
}

export const s1: SpikeCheck = {
  id: "S1",
  title: "a raising assert rolls back the whole batch",
  async run() {
    await setupScratch();
    const err = await failureOf(
      db.batch([
        db.execute(sql`insert into spike.parent (id) values ('p1')`),
        db.execute(sql`select skedul_assert(false, 'boom')`),
      ]),
    );
    assert.equal(pgErrorInfo(err).code, "P0001");
    assert.equal(skedulCode(err), "boom");
    assert.equal(await count("select count(*)::int as c from spike.parent where id = 'p1'"), 0);

    // Contrast: a guarded UPDATE that matches 0 rows does NOT abort a batch.
    await db.batch([
      db.execute(sql`update spike.parent set n = 1 where id = 'nope'`),
      db.execute(sql`insert into spike.parent (id) values ('p1b')`),
    ]);
    assert.equal(await count("select count(*)::int as c from spike.parent where id = 'p1b'"), 1);
    return "P0001 skedul:boom rolled back the insert; a 0-row UPDATE alone does not abort";
  },
};

export const s4: SpikeCheck = {
  id: "S4",
  title: "parameterised data-modifying CTE in a batch, aid-marked guard",
  async run() {
    await setupScratch();
    await client.query(
      "insert into spike.ticket (id, status) values ('t1','available'), ('t2','available'), ('t3','available')",
    );
    const ids = ["t1", "t2"];
    const act = (aid: string) =>
      db.batch([
        db.execute<{ ticket_id: string }>(sql`
          with u as (
            update spike.ticket set status = ${"booked"}
            where id = any(${sql.param(ids)}::text[]) and status = 'available'
            returning id
          )
          insert into spike.movement (ticket_id, action_id)
          select id, ${aid} from u
          returning ticket_id`),
        db.execute(sql`select skedul_assert(
          (select count(*) from spike.movement where action_id = ${aid}) = ${ids.length}, 'stale')`),
      ]);

    const [moved] = await act("aid-1");
    assert.deepEqual(moved.rows.map((r) => r.ticket_id).sort(), ids);

    // The same action replayed (double submit): its UPDATE matches 0 rows, so
    // its own movement count is 0 and the aid-marked assert raises `stale`.
    const err = await failureOf(act("aid-2"));
    assert.equal(skedulCode(err), "stale");
    assert.equal(await count("select count(*)::int as c from spike.movement"), 2);
    return "sql.param(array) binds one text[] param; RETURNING rows come back; replay raises stale";
  },
};

export const s7: SpikeCheck = {
  id: "S7",
  title: "SQLSTATE and constraint names reach the caller",
  async run() {
    await setupScratch();
    await client.query("insert into spike.parent (id, n, capacity) values ('p7', 1, 1)");
    await client.query("insert into spike.movement (ticket_id, action_id) values ('t1', 'a1')");

    const inBatchCheck = await failureOf(
      db.batch([db.execute(sql`update spike.parent set n = n + 1 where id = 'p7'`)]),
    );
    const a = pgErrorInfo(inBatchCheck);
    assert.equal(a.code, "23514");
    assert.equal(a.constraint, "parent_n_chk");

    const inBatchUnique = await failureOf(
      db.batch([db.execute(sql`insert into spike.movement (ticket_id, action_id) values ('t1', 'a1')`)]),
    );
    const b = pgErrorInfo(inBatchUnique);
    assert.equal(b.code, "23505");
    assert.equal(b.constraint, "movement_action_ticket_uq");

    const outside = await failureOf(db.execute(sql`update spike.parent set n = n + 1 where id = 'p7'`));
    const c = pgErrorInfo(outside);
    assert.equal(c.code, "23514");
    assert.equal(c.constraint, "parent_n_chk");

    const shape = (e: unknown) =>
      `${(e as Error).constructor?.name}${(e as Error).cause ? "+cause" : ""}`;
    return `in batch: ${shape(inBatchCheck)}; outside: ${shape(outside)}`;
  },
};
