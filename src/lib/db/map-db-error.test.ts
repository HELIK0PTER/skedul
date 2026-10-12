import { test } from "node:test";
import assert from "node:assert/strict";

import { mapDbError } from "./map-db-error";

/** A NeonDbError as thrown inside db.batch. */
function pg(code: string, extra: { constraint?: string; message?: string } = {}): Error {
  return Object.assign(new Error(extra.message ?? `pg ${code}`), { code, constraint: extra.constraint });
}

/** The same error as thrown outside a batch (DrizzleQueryError with a cause). */
function wrapped(inner: Error): Error {
  return new Error("Failed query: …\nparams: …", { cause: inner });
}

const both = (inner: Error) => [inner, wrapped(inner)];

test("P0001 skedul:already_paid is a duplicate (success without effect)", () => {
  for (const err of both(pg("P0001", { message: "skedul:already_paid" }))) {
    assert.deepEqual(mapDbError(err, "write"), { type: "duplicate" });
  }
});

test("P0001 skedul:<engine code> maps to that code", () => {
  for (const code of ["changed", "stale", "unavailable", "no_ticket", "too_many_holds", "too_late_or_done", "not_found"] as const) {
    for (const err of both(pg("P0001", { message: `skedul:${code}` }))) {
      assert.deepEqual(mapDbError(err, "write"), { type: "code", code });
    }
  }
});

test("P0001 with an unknown skedul code, or without the prefix, is unknown", () => {
  assert.deepEqual(mapDbError(pg("P0001", { message: "skedul:boom" }), "write"), { type: "unknown" });
  assert.deepEqual(mapDbError(pg("P0001", { message: "custom raise" }), "write"), { type: "unknown" });
});

test("23514 maps named CHECKs: seats → full, retire on a paid ticket → retire_paid, others → invalid", () => {
  for (const err of both(pg("23514", { constraint: "occurrence_seats_chk" }))) {
    assert.deepEqual(mapDbError(err, "write"), { type: "code", code: "full" });
  }
  for (const err of both(pg("23514", { constraint: "ticket_retire_paid_chk" }))) {
    assert.deepEqual(mapDbError(err, "write"), { type: "code", code: "retire_paid" });
  }
  assert.deepEqual(mapDbError(pg("23514", { constraint: "event_capacity_chk" }), "write"), { type: "code", code: "invalid" });
  assert.deepEqual(mapDbError(pg("23514"), "delete"), { type: "code", code: "invalid" });
});

test("23505 booking_active_uq → already_booked; any other unique violation is unknown (rethrown)", () => {
  for (const err of both(pg("23505", { constraint: "booking_active_uq" }))) {
    assert.deepEqual(mapDbError(err, "write"), { type: "code", code: "already_booked" });
  }
  for (const constraint of ["ticket_movement_action_ticket_uq", "ticket_pkey", "customer_pro_email_uq"]) {
    assert.deepEqual(mapDbError(pg("23505", { constraint }), "write"), { type: "unknown" });
  }
});

test("23P01 occurrence_rdv_excl → slot_taken; another exclusion is unknown", () => {
  for (const err of both(pg("23P01", { constraint: "occurrence_rdv_excl" }))) {
    assert.deepEqual(mapDbError(err, "write"), { type: "code", code: "slot_taken" });
  }
  assert.deepEqual(mapDbError(pg("23P01", { constraint: "other_excl" }), "write"), { type: "unknown" });
});

test("23503 → in_use when deleting, stale when writing", () => {
  for (const err of both(pg("23503", { constraint: "ticket_ticket_type_id_ticket_type_id_fk" }))) {
    assert.deepEqual(mapDbError(err, "delete"), { type: "code", code: "in_use" });
    assert.deepEqual(mapDbError(err, "write"), { type: "code", code: "stale" });
  }
});

test("40P01 is a deadlock (atomic replays the batch once)", () => {
  for (const err of both(pg("40P01"))) {
    assert.deepEqual(mapDbError(err, "write"), { type: "deadlock" });
  }
});

test("anything else is unknown", () => {
  assert.deepEqual(mapDbError(pg("22001"), "write"), { type: "unknown" });
  assert.deepEqual(mapDbError(new Error("fetch failed"), "write"), { type: "unknown" });
  assert.deepEqual(mapDbError("not an error", "write"), { type: "unknown" });
});
