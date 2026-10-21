import assert from "node:assert/strict";
import test from "node:test";

import { historyLines, type LedgerMovementRow } from "./history";

const PARIS = "Europe/Paris";
const LA = "America/Los_Angeles";
const AT = new Date("2026-10-12T12:03:00Z"); // Paris 14:03 (CEST), Los Angeles 05:03 (PDT)
const NOW = new Date("2026-10-20T10:00:00Z"); // the same local year as AT in both zones
const DASHES = /[\u2013\u2014]/;

const NAMES = new Map([
  ["coll", "Cours collectif"],
  ["deb", "Cours débutants"],
  ["priv", "Cours particulier"],
]);

function mv(seq: number, actionId: string, over: Partial<LedgerMovementRow> = {}): LedgerMovementRow {
  return {
    seq,
    actionId,
    kind: "offer",
    ticketTypeId: "coll",
    fromTicketTypeId: null,
    actor: "pro",
    reason: null,
    createdAt: AT,
    closedReason: null,
    occurrence: null,
    ...over,
  };
}

const texts = (rows: readonly LedgerMovementRow[], tz = PARIS, now = NOW) => historyLines(rows, NAMES, tz, now).map((l) => l.text);

test("historyLines: three convert movements of one action make one line (Paris and Los Angeles)", () => {
  const rows = [1, 2, 3].map((seq) => mv(seq, "a1", { kind: "convert", ticketTypeId: "deb", fromTicketTypeId: "coll" }));
  assert.deepEqual(texts(rows), ["12/10 14:03 · Vous · Converti 3 Cours collectif → Cours débutants"]);
  assert.deepEqual(texts(rows, LA), ["12/10 05:03 · Vous · Converti 3 Cours collectif → Cours débutants"]);
  assert.deepEqual(historyLines(rows, NAMES, PARIS, NOW).map((l) => l.key), ["a1:0"]);
});

test("historyLines: a close line carries the motif and the note", () => {
  const rows = [
    mv(1, "c1", { kind: "close", closedReason: "rembourse", reason: "facture 42" }),
    mv(2, "c1", { kind: "close", closedReason: "rembourse", reason: "facture 42" }),
    mv(3, "c2", { kind: "close", closedReason: "compense" }),
    mv(4, "c3", { kind: "close", closedReason: "autre", reason: "litige" }),
  ];
  assert.deepEqual(texts(rows), [
    "12/10 14:03 · Vous · Clos 1 Cours collectif (Autre, litige)",
    "12/10 14:03 · Vous · Clos 1 Cours collectif (Compensé)",
    "12/10 14:03 · Vous · Clos 2 Cours collectif (Remboursé hors Skedul, facture 42)",
  ]);
});

test("historyLines: a retire close reads « Retiré » with its note only", () => {
  const rows = [
    mv(1, "r1", { kind: "close", closedReason: "retire", reason: "envoyé en double" }),
    mv(2, "r1", { kind: "close", closedReason: "retire", reason: "envoyé en double" }),
    mv(3, "r2", { kind: "close", closedReason: "retire" }),
  ];
  assert.deepEqual(texts(rows), [
    "12/10 14:03 · Vous · Retiré 1 Cours collectif",
    "12/10 14:03 · Vous · Retiré 2 Cours collectif (envoyé en double)",
  ]);
});

test("historyLines: a spend or a return ends with the séance (Paris and Los Angeles)", () => {
  const occurrence = { title: "Altinha débutants", startsAt: new Date("2026-10-14T05:00:00Z") }; // Paris 07:00 14/10, Los Angeles 22:00 13/10
  const rows = [
    mv(1, "s1", { kind: "spend", actor: "client", occurrence }),
    mv(2, "s2", { kind: "return", occurrence }),
  ];
  assert.deepEqual(texts(rows), [
    "12/10 14:03 · Vous · Rendu 1 Cours collectif · Altinha débutants du 14/10",
    "12/10 14:03 · Client · Utilisé pour une inscription 1 Cours collectif · Altinha débutants du 14/10",
  ]);
  assert.deepEqual(texts(rows, LA), [
    "12/10 05:03 · Vous · Rendu 1 Cours collectif · Altinha débutants du 13/10",
    "12/10 05:03 · Client · Utilisé pour une inscription 1 Cours collectif · Altinha débutants du 13/10",
  ]);
  for (const text of texts(rows)) assert.ok(text.split(" · ").length <= 4, text);
});

test("historyLines: movements are grouped by action, kind, type, motif and séance, in seq order", () => {
  const rows = [
    mv(5, "g1", { ticketTypeId: "priv", reason: "cadeau" }),
    mv(2, "g1", { reason: "cadeau" }),
    mv(4, "g1", { reason: "cadeau" }),
    mv(3, "g1", { reason: "autre cadeau" }),
    mv(1, "g1", { reason: "cadeau" }),
  ];
  const lines = historyLines(rows, NAMES, PARIS, NOW);
  assert.deepEqual(
    lines.map((l) => l.text),
    [
      "12/10 14:03 · Vous · Offert 3 Cours collectif (cadeau)",
      "12/10 14:03 · Vous · Offert 1 Cours collectif (autre cadeau)",
      "12/10 14:03 · Vous · Offert 1 Cours particulier (cadeau)",
    ],
  );
  assert.deepEqual(
    lines.map((l) => l.key),
    ["g1:0", "g1:1", "g1:2"],
  );
});

test("historyLines: the newest action comes first, the lines of an action follow seq", () => {
  const older = new Date("2026-10-01T08:00:00Z"); // Paris 10:00
  const rows = [
    mv(3, "new", { ticketTypeId: "deb" }),
    mv(2, "old", { ticketTypeId: "coll", createdAt: older }),
    mv(1, "old", { ticketTypeId: "priv", createdAt: older }),
  ];
  assert.deepEqual(texts(rows), [
    "12/10 14:03 · Vous · Offert 1 Cours débutants",
    "01/10 10:00 · Vous · Offert 1 Cours particulier",
    "01/10 10:00 · Vous · Offert 1 Cours collectif",
  ]);
});

test("historyLines: a deleted type reads « type supprimé »", () => {
  const rows = [
    mv(1, "u1", { ticketTypeId: "gone" }),
    mv(2, "u2", { kind: "convert", ticketTypeId: "deb", fromTicketTypeId: "gone" }),
    mv(3, "u3", { kind: "convert", ticketTypeId: "gone", fromTicketTypeId: "coll" }),
  ];
  assert.deepEqual(texts(rows), [
    "12/10 14:03 · Vous · Converti 1 Cours collectif → type supprimé",
    "12/10 14:03 · Vous · Converti 1 type supprimé → Cours débutants",
    "12/10 14:03 · Vous · Offert 1 type supprimé",
  ]);
});

test("historyLines: purchase, pointage, unpoint and expire lines", () => {
  // The fulfillment writes purchase movements with actor "system" (src/lib/booking/fulfillment.ts); the client bought online.
  const purchases = Array.from({ length: 10 }, (_, i) => mv(i + 1, "k1", { kind: "purchase", actor: "system" }));
  const expires = [14, 15, 16, 17].map((seq) => mv(seq, "k5", { kind: "expire", actor: "system" }));
  const rows = [
    ...purchases,
    mv(11, "k2", { kind: "pointage", reason: "en salle" }),
    mv(12, "k3", { kind: "unpoint" }),
    mv(13, "k4", { kind: "unpoint", reason: "ignoré" }),
    ...expires,
  ];
  assert.deepEqual(texts(rows), [
    "12/10 14:03 · Skedul · Expiré 4 Cours collectif",
    "12/10 14:03 · Vous · Pointage annulé 1 Cours collectif",
    "12/10 14:03 · Vous · Pointage annulé 1 Cours collectif",
    "12/10 14:03 · Vous · Pointé 1 Cours collectif (en salle)",
    "12/10 14:03 · Client · Acheté 10 Cours collectif",
  ]);
});

test("historyLines: a purchase reads « Client » whatever the actor column says, the other system movements read « Skedul »", () => {
  const rows = [
    mv(1, "p1", { kind: "purchase", actor: "system" }),
    mv(2, "p2", { kind: "purchase", actor: "client" }),
    mv(3, "e1", { kind: "expire", actor: "system" }),
    mv(4, "o1", { kind: "offer", actor: "system" }),
  ];
  assert.deepEqual(texts(rows), [
    "12/10 14:03 · Skedul · Offert 1 Cours collectif",
    "12/10 14:03 · Skedul · Expiré 1 Cours collectif",
    "12/10 14:03 · Client · Acheté 1 Cours collectif",
    "12/10 14:03 · Client · Acheté 1 Cours collectif",
  ]);
});

test("historyLines: a timestamp across the UTC day boundary reads the day of the zone (Paris and Los Angeles)", () => {
  const rows = [mv(1, "n1", { createdAt: new Date("2026-10-11T22:30:00Z") })]; // Paris 00:30 on 12/10 (CEST), Los Angeles 15:30 on 11/10 (PDT)
  assert.deepEqual(texts(rows), ["12/10 00:30 · Vous · Offert 1 Cours collectif"]);
  assert.deepEqual(texts(rows, LA), ["11/10 15:30 · Vous · Offert 1 Cours collectif"]);
});

test("historyLines: the count uses the fr-FR thousands format", () => {
  const rows = Array.from({ length: 1234 }, (_, i) => mv(i + 1, "big"));
  assert.notEqual((1234).toLocaleString("fr-FR"), "1234");
  assert.deepEqual(texts(rows), [`12/10 14:03 · Vous · Offert ${(1234).toLocaleString("fr-FR")} Cours collectif`]);
});

test("historyLines: dates around the DST changes, and no dash anywhere", () => {
  const paris = [
    mv(1, "d1", { createdAt: new Date("2026-03-29T00:30:00Z") }), // Paris 01:30 (CET)
    mv(2, "d2", { createdAt: new Date("2026-03-29T01:30:00Z") }), // Paris 03:30 (CEST)
  ];
  assert.deepEqual(texts(paris), [
    "29/03 03:30 · Vous · Offert 1 Cours collectif",
    "29/03 01:30 · Vous · Offert 1 Cours collectif",
  ]);
  const la = [
    mv(1, "d1", { createdAt: new Date("2026-03-08T09:30:00Z") }), // Los Angeles 01:30 (PST)
    mv(2, "d2", { createdAt: new Date("2026-03-08T10:30:00Z") }), // Los Angeles 03:30 (PDT)
  ];
  assert.deepEqual(texts(la, LA), [
    "08/03 03:30 · Vous · Offert 1 Cours collectif",
    "08/03 01:30 · Vous · Offert 1 Cours collectif",
  ]);
  const everything = [
    mv(1, "x1", { kind: "convert", ticketTypeId: "deb", fromTicketTypeId: "coll" }),
    mv(2, "x2", { kind: "close", closedReason: "rembourse", reason: "note" }),
    mv(3, "x3", { kind: "close", closedReason: "retire" }),
    mv(4, "x4", { kind: "spend", occurrence: { title: "Roda libre", startsAt: AT } }),
  ];
  for (const tz of [PARIS, LA]) for (const text of texts(everything, tz)) assert.ok(!DASHES.test(text), text);
});

// R6: « 12/10 » says nothing about the year. A line, and the séance it names, write the year when it is not now's.
test("historyLines: the date of a line and of its séance name the year when it is not the current one", () => {
  const lastYear = new Date("2025-10-12T12:03:00Z");
  const seance = { title: "Altinha d\u00e9butants", startsAt: new Date("2025-11-03T18:00:00Z") };
  const rows = [
    mv(1, "old", { kind: "spend", createdAt: lastYear, occurrence: seance }),
    mv(2, "new", { kind: "offer", createdAt: AT }),
  ];
  assert.deepEqual(texts(rows), [
    "12/10 14:03 \u00b7 Vous \u00b7 Offert 1 Cours collectif",
    "12/10/2025 14:03 \u00b7 Vous \u00b7 Utilis\u00e9 pour une inscription 1 Cours collectif \u00b7 Altinha d\u00e9butants du 03/11/2025",
  ]);
  // A séance of this year booked by an action of last year: only the action date names its year.
  const mixed = mv(3, "mixed", {
    kind: "spend",
    createdAt: lastYear,
    occurrence: { title: "Roda libre", startsAt: new Date("2026-03-01T18:00:00Z") },
  });
  assert.deepEqual(texts([mixed]), ["12/10/2025 14:03 \u00b7 Vous \u00b7 Utilis\u00e9 pour une inscription 1 Cours collectif \u00b7 Roda libre du 01/03"]);
});

test("historyLines: the current year is the local one of the given zone", () => {
  const lateDecember = new Date("2025-12-31T12:00:00Z"); // 13:00 in Paris, 04:00 in Los Angeles
  const justAfterNewYear = new Date("2026-01-01T00:10:00Z"); // 2026 in Paris, still 31 December 2025 in Los Angeles
  const rows = [mv(1, "a", { createdAt: lateDecember })];
  assert.deepEqual(texts(rows, PARIS, justAfterNewYear), ["31/12/2025 13:00 \u00b7 Vous \u00b7 Offert 1 Cours collectif"]);
  assert.deepEqual(texts(rows, LA, justAfterNewYear), ["31/12 04:00 \u00b7 Vous \u00b7 Offert 1 Cours collectif"]);
  for (const text of [...texts(rows, PARIS, justAfterNewYear), ...texts(rows, LA, justAfterNewYear)]) assert.doesNotMatch(text, DASHES);
});
