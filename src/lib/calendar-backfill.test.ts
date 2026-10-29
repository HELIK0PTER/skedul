import test from "node:test";
import assert from "node:assert/strict";

import { BACKFILL_GAP_MS, BACKFILL_MAX, backfillGoogleWith, type BackfillDeps } from "./calendar-backfill";

type Call = { kind: "sync"; id: string } | { kind: "sleep"; ms: number };

/** Deps that record every call in order; `outcomes` maps an id to what its sync answers (default "created"). */
function harness(ids: string[], outcomes: Record<string, string | Error> = {}) {
  const calls: Call[] = [];
  const infos: string[] = [];
  const warns: string[] = [];
  const asked: number[] = [];
  const deps: BackfillDeps = {
    listIds: async (limit) => {
      asked.push(limit);
      return ids.slice(0, limit);
    },
    sync: async (id) => {
      calls.push({ kind: "sync", id });
      const outcome = outcomes[id] ?? "created";
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    sleep: async (ms) => {
      calls.push({ kind: "sleep", ms });
    },
    info: (line) => infos.push(line),
    warn: (line) => warns.push(line),
  };
  return { deps, calls, infos, warns, asked };
}

test("the backfill syncs the listed occurrences in order, one gap between two Google calls and none around them", async () => {
  const { deps, calls, infos } = harness(["a", "b", "c"]);
  const result = await backfillGoogleWith("pro_1", deps);

  assert.deepEqual(calls, [
    { kind: "sync", id: "a" },
    { kind: "sleep", ms: BACKFILL_GAP_MS },
    { kind: "sync", id: "b" },
    { kind: "sleep", ms: BACKFILL_GAP_MS },
    { kind: "sync", id: "c" },
  ]);
  assert.deepEqual(result, { attempted: 3, failed: 0, more: false });
  assert.deepEqual(infos, ["[calendar-sync] backfill for pro pro_1: 3 occurrence(s) processed"]);
});

test("the pace is a real gap and the cap is 200 occurrences per connection", () => {
  assert.ok(BACKFILL_GAP_MS >= 100, "at least 100 ms between two Google calls");
  assert.equal(BACKFILL_MAX, 200);
});

test("nothing to sync: no Google call, no pause, one line", async () => {
  const { deps, calls, infos } = harness([]);
  const result = await backfillGoogleWith("pro_1", deps);

  assert.deepEqual(calls, []);
  assert.deepEqual(result, { attempted: 0, failed: 0, more: false });
  assert.deepEqual(infos, ["[calendar-sync] backfill for pro pro_1: 0 occurrence(s) processed"]);
});

test("past the cap only the first 200 are synced, the rest is reported and left to later syncs", async () => {
  const ids = Array.from({ length: BACKFILL_MAX + 40 }, (_, i) => `occ${i}`);
  const { deps, calls, infos, asked } = harness(ids);
  const result = await backfillGoogleWith("pro_1", deps);

  assert.deepEqual(asked, [BACKFILL_MAX + 1], "one extra id is requested to know whether more remain");
  assert.equal(calls.filter((c) => c.kind === "sync").length, BACKFILL_MAX);
  assert.deepEqual(result, { attempted: BACKFILL_MAX, failed: 0, more: true });
  assert.deepEqual(infos, [
    `[calendar-sync] backfill for pro pro_1: ${BACKFILL_MAX} occurrence(s) processed, more remain (the next changes sync them)`,
  ]);
});

test("exactly 200 is not « more »", async () => {
  const ids = Array.from({ length: BACKFILL_MAX }, (_, i) => `occ${i}`);
  const { deps } = harness(ids);
  assert.deepEqual(await backfillGoogleWith("pro_1", deps), { attempted: BACKFILL_MAX, failed: 0, more: false });
});

test("a sync that fails (reported or thrown) is counted and logged without its address, and the next ones still run", async () => {
  const { deps, calls, infos, warns } = harness(["a", "b", "c"], {
    a: "failed",
    b: new Error("Google answered 403 for jane.doe@example.com"),
  });
  const result = await backfillGoogleWith("pro_1", deps);

  assert.deepEqual(
    calls.filter((c) => c.kind === "sync"),
    [
      { kind: "sync", id: "a" },
      { kind: "sync", id: "b" },
      { kind: "sync", id: "c" },
    ],
  );
  assert.deepEqual(result, { attempted: 3, failed: 2, more: false });
  assert.deepEqual(infos, ["[calendar-sync] backfill for pro pro_1: 3 occurrence(s) processed, 2 failed"]);
  assert.equal(warns.length, 1, "only the thrown one is logged here: syncOccurrence already logs its own failures");
  assert.ok(warns[0].includes("[email]"), "the address is masked");
  assert.ok(![...warns, ...infos].some((line) => line.includes("jane.doe")), "no address reaches the log");
});

test("occurrences that needed no Google call (noop, skipped, disabled) cost no pause", async () => {
  const { deps, calls } = harness(["a", "b", "c", "d"], { a: "noop", b: "skipped", c: "disabled" });
  await backfillGoogleWith("pro_1", deps);

  assert.deepEqual(calls, [
    { kind: "sync", id: "a" },
    { kind: "sync", id: "b" },
    { kind: "sync", id: "c" },
    { kind: "sync", id: "d" },
  ]);
});

test("a failing id read never throws and syncs nothing", async () => {
  const { deps, calls, warns } = harness([]);
  deps.listIds = async () => {
    throw new Error("connection to db failed for jane.doe@example.com");
  };
  const result = await backfillGoogleWith("pro_1", deps);

  assert.deepEqual(calls, []);
  assert.deepEqual(result, { attempted: 0, failed: 0, more: false });
  assert.equal(warns.length, 1);
  assert.ok(warns[0].startsWith("[calendar-sync] backfill for pro pro_1 failed: "));
  assert.ok(!warns[0].includes("jane.doe"));
});
