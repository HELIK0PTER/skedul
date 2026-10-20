import assert from "node:assert/strict";
import test from "node:test";

import { instantAt } from "@/lib/civil-date";
import { classifyTypes } from "@/lib/wallet-rules";

import {
  groupWallet,
  type WalletGroup,
  type WalletTicketRow,
  type WalletTicketView,
  type WalletTypeRow,
} from "./wallet-view";

const PARIS = "Europe/Paris";
const LA = "America/Los_Angeles";
const NOW = new Date("2026-10-14T10:00:00Z"); // Paris 12:00 (CEST), Los Angeles 03:00 (PDT)
const T0 = new Date("2026-09-01T08:00:00Z");
const DASHES = /[\u2013\u2014]/;

const TYPES: WalletTypeRow[] = [
  { id: "coll", name: "Cours collectif", color: "#6366f1", archived: false },
  { id: "priv", name: "Cours particulier", color: "#0ea5e9", archived: false },
  { id: "stage", name: "Stage d'été 2026", color: "#f59e0b", archived: true },
  { id: "plein", name: "Cours en plein air", color: "#22c55e", archived: false },
];

const CLASSES = classifyTypes([
  { ticketTypeId: "coll", archived: false, rdvEnabled: false, linkedToUpcomingEvent: true },
  { ticketTypeId: "priv", archived: false, rdvEnabled: false, linkedToUpcomingEvent: true },
  { ticketTypeId: "stage", archived: true, rdvEnabled: false, linkedToUpcomingEvent: false },
  { ticketTypeId: "plein", archived: false, rdvEnabled: false, linkedToUpcomingEvent: false },
]);

const row = (id: string, over: Partial<WalletTicketRow> = {}): WalletTicketRow => ({
  id,
  ticketTypeId: "coll",
  status: "available",
  expiresAt: null,
  purchaseId: null,
  closedReason: null,
  closedNote: null,
  statusChangedAt: T0,
  createdAt: T0,
  bookingStartsAt: null,
  ...over,
});

function groupOf(groups: WalletGroup[], ticketTypeId: string): WalletGroup {
  const group = groups.find((g) => g.ticketTypeId === ticketTypeId);
  assert.ok(group, `group ${ticketTypeId} expected`);
  return group;
}

const lines = (views: readonly WalletTicketView[]) => views.map((v) => [v.id, v.line]);

/** Every bucket at once, Paris wall clock, NOW = 2026-10-14. */
function bigWallet(): WalletTicketRow[] {
  return [
    row("u1", { purchaseId: "p1", expiresAt: instantAt("2026-12-01", 0, PARIS) }),
    row("u2"),
    row("b1", { status: "booked", bookingStartsAt: new Date("2026-10-20T17:00:00Z") }),
    row("d1", { status: "booked", bookingStartsAt: new Date("2026-10-10T17:00:00Z") }),
    row("e1", { expiresAt: instantAt("2026-10-02", 0, PARIS) }),
    row("e2", { status: "expired", expiresAt: instantAt("2026-10-02", 0, PARIS) }),
    row("p1", { status: "used", statusChangedAt: new Date("2026-10-05T08:00:00Z") }),
    row("c1", {
      status: "closed",
      closedReason: "retire",
      closedNote: "cadeau en double",
      statusChangedAt: new Date("2026-10-06T08:00:00Z"),
    }),
    row("c2", {
      status: "closed",
      closedReason: "rembourse",
      purchaseId: "p2",
      statusChangedAt: new Date("2026-10-07T08:00:00Z"),
    }),
    row("c3", {
      status: "closed",
      closedReason: "autre",
      closedNote: "litige",
      statusChangedAt: new Date("2026-10-08T08:00:00Z"),
    }),
  ];
}

test("groupWallet: one group per type holding tickets, in the types order, with the alert of its class", () => {
  const groups = groupWallet(
    [
      row("t1", { ticketTypeId: "plein" }),
      row("t2", { ticketTypeId: "stage" }),
      row("t3", { ticketTypeId: "coll" }),
      row("t4", { ticketTypeId: "type-not-in-the-list" }),
    ],
    TYPES,
    CLASSES,
    NOW,
    PARIS,
  );
  assert.deepEqual(
    groups.map((g) => [g.ticketTypeId, g.name, g.color, g.archived, g.alert, g.usableCount]),
    [
      ["coll", "Cours collectif", "#6366f1", false, null, 1],
      ["stage", "Stage d'été 2026", "#f59e0b", true, "red", 1],
      ["plein", "Cours en plein air", "#22c55e", false, "orange", 1],
    ],
  );
});

test("groupWallet: the alert needs usable tickets", () => {
  const groups = groupWallet(
    [
      row("s1", { ticketTypeId: "stage", status: "used", statusChangedAt: T0 }),
      row("s2", { ticketTypeId: "stage", expiresAt: instantAt("2026-10-02", 0, PARIS) }),
      row("o1", {
        ticketTypeId: "plein",
        status: "closed",
        closedReason: "autre",
        closedNote: "x",
        statusChangedAt: T0,
      }),
    ],
    TYPES,
    CLASSES,
    NOW,
    PARIS,
  );
  assert.deepEqual(
    groups.map((g) => [g.ticketTypeId, g.alert, g.usableCount]),
    [
      ["stage", null, 0],
      ["plein", null, 0],
    ],
  );
});

test("groupWallet: buckets and exact lines (Paris)", () => {
  const group = groupOf(groupWallet(bigWallet(), TYPES, CLASSES, NOW, PARIS), "coll");
  assert.deepEqual(group.usable, [
    { id: "u1", origin: "Acheté", line: "Disponible · valable jusqu'au 30/11 inclus", tone: "ok", struck: false },
    { id: "u2", origin: "Offert", line: "Disponible · sans limite de validité", tone: "ok", struck: false },
  ]);
  assert.equal(group.usableCount, 2);
  assert.deepEqual(group.booked, [
    { id: "b1", origin: "Offert", line: "Réservé pour le 20/10", tone: "ok", struck: false },
  ]);
  assert.deepEqual(group.expired, [
    { id: "e1", origin: "Offert", line: "Expiré (valable jusqu'au 01/10 inclus)", tone: "red", struck: false },
    { id: "e2", origin: "Offert", line: "Expiré (valable jusqu'au 01/10 inclus)", tone: "red", struck: false },
  ]);
  assert.deepEqual(lines(group.done), [
    ["d1", "Utilisé le 10/10"],
    ["c3", "Clos le 08/10 : Autre (litige)"],
    ["c2", "Clos le 07/10 : Remboursé hors Skedul"],
    ["c1", "Retiré le 06/10 (cadeau en double)"],
    ["p1", "Pointé le 05/10"],
  ]);
  assert.ok(group.done.every((v) => v.tone === "muted" && v.struck));
  assert.deepEqual(
    group.done.map((v) => [v.id, v.origin]),
    [
      ["d1", "Offert"],
      ["c3", "Offert"],
      ["c2", "Acheté"],
      ["c1", "Offert"],
      ["p1", "Offert"],
    ],
  );
  assert.deepEqual(group.expirySummary, ["1 valable jusqu'au 30/11 inclus", "1 sans limite de validité"]);
});

test("groupWallet: an expiry or a séance exactly at now is already over", () => {
  const group = groupOf(
    groupWallet(
      [
        row("x1", { expiresAt: NOW }),
        row("x2", { status: "booked", bookingStartsAt: NOW }),
        row("x3", { status: "booked", bookingStartsAt: new Date(NOW.getTime() + 1) }),
      ],
      TYPES,
      CLASSES,
      NOW,
      PARIS,
    ),
    "coll",
  );
  assert.equal(group.usableCount, 0);
  assert.deepEqual(lines(group.expired), [["x1", "Expiré (valable jusqu'au 14/10 inclus)"]]);
  assert.deepEqual(lines(group.done), [["x2", "Utilisé le 14/10"]]);
  assert.deepEqual(lines(group.booked), [["x3", "Réservé pour le 14/10"]]);
});

test("groupWallet: the last valid day and the dates follow the pro zone (Paris and Los Angeles)", () => {
  const tickets = [
    row("l1", { expiresAt: instantAt("2026-12-01", 0, LA) }), // 2026-12-01T08:00:00Z
    row("l2", { status: "used", statusChangedAt: new Date("2026-10-06T02:30:00Z") }),
  ];
  const paris = groupOf(groupWallet(tickets, TYPES, CLASSES, NOW, PARIS), "coll");
  const la = groupOf(groupWallet(tickets, TYPES, CLASSES, NOW, LA), "coll");
  assert.deepEqual(lines(paris.usable), [["l1", "Disponible · valable jusqu'au 01/12 inclus"]]);
  assert.deepEqual(lines(la.usable), [["l1", "Disponible · valable jusqu'au 30/11 inclus"]]);
  assert.deepEqual(lines(paris.done), [["l2", "Pointé le 06/10"]]);
  assert.deepEqual(lines(la.done), [["l2", "Pointé le 05/10"]]);
  assert.deepEqual(paris.expirySummary, ["1 valable jusqu'au 01/12 inclus"]);
  assert.deepEqual(la.expirySummary, ["1 valable jusqu'au 30/11 inclus"]);
});

test("groupWallet: DST days keep the last valid day (Paris 2026-10-25, Los Angeles 2026-11-01)", () => {
  const paris = groupOf(
    groupWallet([row("s1", { expiresAt: instantAt("2026-10-26", 0, PARIS) })], TYPES, CLASSES, NOW, PARIS),
    "coll",
  );
  assert.deepEqual(lines(paris.usable), [["s1", "Disponible · valable jusqu'au 25/10 inclus"]]);
  const la = groupOf(
    groupWallet([row("s2", { expiresAt: instantAt("2026-11-02", 0, LA) })], TYPES, CLASSES, NOW, LA),
    "coll",
  );
  assert.deepEqual(lines(la.usable), [["s2", "Disponible · valable jusqu'au 01/11 inclus"]]);
});

test("groupWallet: point, convert and closeAny follow the consumption order; closePaid and retire split by origin", () => {
  const e1 = instantAt("2026-11-01", 0, PARIS);
  const e2 = instantAt("2026-12-01", 0, PARIS);
  const group = groupOf(
    groupWallet(
      [
        row("a", { expiresAt: e2, purchaseId: "p1" }),
        row("b", { expiresAt: e1, createdAt: new Date(T0.getTime() + 1000) }),
        row("c", { expiresAt: e1, purchaseId: "p2" }),
        row("d", { purchaseId: "p3" }),
        row("e", { status: "booked", bookingStartsAt: new Date("2026-10-20T17:00:00Z") }),
        row("f", { status: "used" }),
      ],
      TYPES,
      CLASSES,
      NOW,
      PARIS,
    ),
    "coll",
  );
  assert.deepEqual(group.ids.point, ["c", "b", "a", "d"]);
  assert.deepEqual(group.ids.convert, ["c", "b", "a", "d"]);
  assert.deepEqual(group.ids.closeAny, ["c", "b", "a", "d"]);
  assert.deepEqual(group.ids.closePaid, ["c", "a", "d"]);
  assert.deepEqual(group.ids.retire, ["b"]);
  assert.deepEqual(group.ids.unpoint, ["f"]);
  assert.notStrictEqual(group.ids.point, group.ids.convert);
  assert.notStrictEqual(group.ids.convert, group.ids.closeAny);
});

test("groupWallet: unpoint lists the used tickets, most recent first, then id descending", () => {
  const group = groupOf(
    groupWallet(
      [
        row("u1", { status: "used", statusChangedAt: new Date("2026-10-01T08:00:00Z") }),
        row("u2", { status: "used", statusChangedAt: new Date("2026-10-03T08:00:00Z") }),
        row("u3", { status: "used", statusChangedAt: new Date("2026-10-03T08:00:00Z") }),
        row("k1", { status: "closed", closedReason: "autre", closedNote: "x", statusChangedAt: new Date("2026-10-09T08:00:00Z") }),
      ],
      TYPES,
      CLASSES,
      NOW,
      PARIS,
    ),
    "coll",
  );
  assert.deepEqual(group.ids.unpoint, ["u3", "u2", "u1"]);
  assert.deepEqual(group.ids.point, []);
  assert.deepEqual(group.ids.retire, []);
});

test("groupWallet: expirySummary counts per last valid day, soonest first, no limit last", () => {
  const nov30 = instantAt("2026-12-01", 0, PARIS);
  const oct31 = instantAt("2026-11-01", 0, PARIS);
  const group = groupOf(
    groupWallet(
      [
        row("x1", { expiresAt: nov30 }),
        row("x2", { expiresAt: nov30 }),
        row("y1", { expiresAt: oct31 }),
        row("z1"),
        row("z2"),
        row("w1", { expiresAt: instantAt("2026-10-02", 0, PARIS) }),
        row("w2", { status: "used" }),
      ],
      TYPES,
      CLASSES,
      NOW,
      PARIS,
    ),
    "coll",
  );
  assert.equal(group.usableCount, 5);
  assert.deepEqual(group.expirySummary, [
    "1 valable jusqu'au 31/10 inclus",
    "2 valables jusqu'au 30/11 inclus",
    "2 sans limite de validité",
  ]);
});

test("groupWallet: the expiry summary names the year like the ticket lines when the last day is not in this year", () => {
  const nextYear = instantAt("2027-04-15", 0, PARIS); // last valid day 2027-04-14
  const tickets = [
    row("y1", { expiresAt: instantAt("2026-12-01", 0, PARIS) }),
    row("y2", { expiresAt: nextYear }),
    row("y3", { expiresAt: nextYear }),
  ];
  const group = groupOf(groupWallet(tickets, TYPES, CLASSES, NOW, PARIS), "coll");
  assert.deepEqual(group.expirySummary, ["1 valable jusqu'au 30/11 inclus", "2 valables jusqu'au 14/04/2027 inclus"]);
  assert.deepEqual(
    group.usable.map((v) => v.line),
    [
      "Disponible · valable jusqu'au 30/11 inclus",
      "Disponible · valable jusqu'au 14/04/2027 inclus",
      "Disponible · valable jusqu'au 14/04/2027 inclus",
    ],
  );
  // The year is read at now in the pro zone: 23:30 on 31/12/2026 in Paris, then 00:30 on 01/01/2027.
  const january = [row("z1", { expiresAt: instantAt("2027-01-11", 0, PARIS) })]; // last valid day 2027-01-10
  const before = groupOf(groupWallet(january, TYPES, CLASSES, new Date("2026-12-31T22:30:00Z"), PARIS), "coll");
  const after = groupOf(groupWallet(january, TYPES, CLASSES, new Date("2026-12-31T23:30:00Z"), PARIS), "coll");
  assert.deepEqual(before.expirySummary, ["1 valable jusqu'au 10/01/2027 inclus"]);
  assert.deepEqual(after.expirySummary, ["1 valable jusqu'au 10/01 inclus"]);
});

test("groupWallet: no tickets, no group; no line contains a dash", () => {
  assert.deepEqual(groupWallet([], TYPES, CLASSES, NOW, PARIS), []);
  for (const tz of [PARIS, LA]) {
    const group = groupOf(groupWallet(bigWallet(), TYPES, CLASSES, NOW, tz), "coll");
    const all = [...group.usable, ...group.booked, ...group.expired, ...group.done].map((v) => v.line);
    for (const text of [...all, ...group.expirySummary]) assert.ok(!DASHES.test(text), text);
  }
});
