import test from "node:test";
import assert from "node:assert/strict";

import { classifyTypes, consumptionOrder, customerAlerts, isUsable, type TypeFacts } from "./wallet-rules";

const facts = (ticketTypeId: string, over: Partial<TypeFacts> = {}): TypeFacts => ({
  ticketTypeId,
  archived: false,
  rdvEnabled: false,
  linkedToUpcomingEvent: true,
  ...over,
});

test("classifyTypes: archived wins, then orphan (not RDV and not linked), else ok", () => {
  const classes = classifyTypes([
    facts("linked"),
    facts("rdv", { rdvEnabled: true, linkedToUpcomingEvent: false }),
    facts("orphan", { linkedToUpcomingEvent: false }),
    facts("archived", { archived: true }),
    facts("archived-orphan", { archived: true, linkedToUpcomingEvent: false }),
  ]);
  assert.deepEqual(Object.fromEntries(classes), {
    linked: "ok",
    rdv: "ok",
    orphan: "orphan",
    archived: "archived",
    "archived-orphan": "archived",
  });
});

test("customerAlerts: red for usable tickets of an archived type, orange for an orphan type", () => {
  const classes = classifyTypes([
    facts("ok"),
    facts("arch", { archived: true }),
    facts("orph", { linkedToUpcomingEvent: false }),
  ]);
  assert.deepEqual(customerAlerts([{ ticketTypeId: "ok", usable: 4 }], classes), { red: false, orange: false });
  assert.deepEqual(customerAlerts([{ ticketTypeId: "arch", usable: 1 }], classes), { red: true, orange: false });
  assert.deepEqual(customerAlerts([{ ticketTypeId: "orph", usable: 2 }], classes), { red: false, orange: true });
  assert.deepEqual(
    customerAlerts(
      [
        { ticketTypeId: "arch", usable: 1 },
        { ticketTypeId: "orph", usable: 1 },
      ],
      classes,
    ),
    { red: true, orange: true },
  );
  // no usable ticket left: the alert disappears by itself
  assert.deepEqual(customerAlerts([{ ticketTypeId: "arch", usable: 0 }], classes), { red: false, orange: false });
  assert.deepEqual(customerAlerts([{ ticketTypeId: "unknown", usable: 3 }], classes), { red: false, orange: false });
  assert.deepEqual(customerAlerts([], classes), { red: false, orange: false });
});

test("isUsable: available and not expired at the given instant", () => {
  const at = new Date("2026-10-12T10:00:00Z");
  assert.equal(isUsable({ status: "available", expiresAt: null }, at), true);
  assert.equal(isUsable({ status: "available", expiresAt: new Date("2026-10-12T10:00:01Z") }, at), true);
  assert.equal(isUsable({ status: "available", expiresAt: new Date("2026-10-12T10:00:00Z") }, at), false);
  for (const status of ["booked", "used", "expired", "closed"] as const) {
    assert.equal(isUsable({ status, expiresAt: null }, at), false, status);
  }
});

test("consumptionOrder: soonest expiry first, no expiry last, then oldest, then id", () => {
  const d = (iso: string) => new Date(iso);
  const tickets = [
    { id: "n2", expiresAt: null, createdAt: d("2026-01-02T00:00:00Z") },
    { id: "late", expiresAt: d("2026-12-31T23:00:00Z"), createdAt: d("2026-01-01T00:00:00Z") },
    { id: "b", expiresAt: d("2026-11-30T23:00:00Z"), createdAt: d("2026-02-01T00:00:00Z") },
    { id: "n1", expiresAt: null, createdAt: d("2026-01-01T00:00:00Z") },
    { id: "a", expiresAt: d("2026-11-30T23:00:00Z"), createdAt: d("2026-02-01T00:00:00Z") },
    { id: "old", expiresAt: d("2026-11-30T23:00:00Z"), createdAt: d("2026-01-15T00:00:00Z") },
  ];
  const input = [...tickets];
  assert.deepEqual(
    consumptionOrder(tickets).map((t) => t.id),
    ["old", "a", "b", "late", "n1", "n2"],
  );
  assert.deepEqual(tickets, input, "the input array is not mutated");
});
