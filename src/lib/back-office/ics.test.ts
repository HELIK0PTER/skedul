import assert from "node:assert/strict";
import test from "node:test";

import { buildBookingIcs, loadIcsFacts, type IcsFacts } from "@/lib/back-office/ics";
import type { Db } from "@/lib/db/atomic";

const FACTS: IcsFacts = {
  bookingId: "bk_Abc-123",
  title: "Altinha débutants",
  location: "Gymnase Jean Bouin, Paris",
  startAt: new Date("2026-10-22T17:00:00.000Z"),
  endAt: new Date("2026-10-22T18:30:00.000Z"),
  businessName: "Altinha Paris",
};

test("buildBookingIcs: carries the facts and nothing else, times in UTC", () => {
  assert.equal(
    buildBookingIcs(FACTS),
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Skedul//Booking//FR",
      "BEGIN:VEVENT",
      "UID:bk_Abc-123@skedul.app",
      "DTSTAMP:20261022T170000Z",
      "DTSTART:20261022T170000Z",
      "DTEND:20261022T183000Z",
      "SUMMARY:Altinha débutants",
      "DESCRIPTION:Avec Altinha Paris",
      "LOCATION:Gymnase Jean Bouin\\, Paris",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
});

test("buildBookingIcs: the UID is stable per booking, so a second download updates the same entry", () => {
  assert.equal(buildBookingIcs(FACTS), buildBookingIcs({ ...FACTS }));
  const other = buildBookingIcs({ ...FACTS, bookingId: "bk_other" });
  assert.ok(other.includes("UID:bk_other@skedul.app\r\n"));
  assert.ok(!other.includes("bk_Abc-123"));
});

test("buildBookingIcs: no location, no LOCATION line", () => {
  assert.ok(!buildBookingIcs({ ...FACTS, location: null }).includes("LOCATION"));
});

test("buildBookingIcs: line breaks and a forged VEVENT in the texts inject no line", () => {
  const body = buildBookingIcs({
    ...FACTS,
    title: "Cours\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nATTENDEE:mailto:evil@example.test",
    location: "Salle 1\nBEGIN:VEVENT\rORGANIZER:mailto:evil@example.test",
    businessName: "Altinha\r\nBEGIN:VEVENT",
  });
  const lines = body.split("\r\n");
  assert.equal(lines.length, 14);
  assert.equal(lines.filter((line) => line === "BEGIN:VEVENT").length, 1);
  assert.ok(!lines.some((line) => line.startsWith("ATTENDEE") || line.startsWith("ORGANIZER")));
  assert.ok(!body.replace(/\r\n/g, "").includes("\r"));
  assert.ok(!body.replace(/\r\n/g, "").includes("\n"));
});

/* Every character some parser reads as a line break, then every other control character: written as
   \u escapes on purpose. None may add a physical line or reach the file raw, in any pro-controlled
   text (title, location, business name) or in the id. */
const BREAKS = ["\r", "\n", "\r\n", "\u000B", "\u000C", "\u001C", "\u001D", "\u001E", "\u0085", "\u2028", "\u2029"];
const OTHER_CONTROLS = ["\u0000", "\u0001", "\u0008", "\u001F", "\u007F", "\u0080", "\u009F"];
const FORGED = "ATTENDEE:mailto:evil@example.test";
const physicalLines = (s: string): string[] => s.split(/\r\n|[\n\v\f\r\u001C-\u001E\u0085\u2028\u2029]/);
const hasRawControl = (s: string): boolean => /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/.test(s.replace(/\r\n/g, ""));

test("buildBookingIcs: no line-break class nor control character in a title, a location or a business name adds a line", () => {
  for (const ch of [...BREAKS, ...OTHER_CONTROLS]) {
    const hostile = `x${ch}${FORGED}`;
    for (const facts of [
      { ...FACTS, title: hostile },
      { ...FACTS, location: hostile },
      { ...FACTS, businessName: hostile },
      { ...FACTS, bookingId: `bk${ch}${FORGED}` },
    ]) {
      const body = buildBookingIcs(facts);
      const label = JSON.stringify(ch);
      assert.equal(physicalLines(body).length, 14, label);
      assert.deepEqual(physicalLines(body), body.split("\r\n"), label);
      assert.equal(body.split("\r\n").filter((line) => line === "BEGIN:VEVENT").length, 1, label);
      assert.ok(!body.split("\r\n").some((line) => line.startsWith("ATTENDEE")), label);
      assert.ok(!hasRawControl(body), label);
    }
  }
});

test("buildBookingIcs: a long title is folded to 75 octets and unfolds to the exact text", () => {
  const body = buildBookingIcs({ ...FACTS, title: "é".repeat(120), location: "Salle, 1\n".repeat(30) });
  assert.ok(body.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75));
  assert.ok(body.replace(/\r\n /g, "").split("\r\n").includes(`SUMMARY:${"é".repeat(120)}`));
});

/** A Db that fails on any use: proves a malformed id never reaches a query. */
const untouchableDb = new Proxy(
  {},
  {
    get() {
      throw new Error("the database was queried");
    },
  },
) as unknown as Db;

test("loadIcsFacts: a malformed or oversized id is null without any query", async () => {
  const malformed = [
    "",
    "x".repeat(65),
    "x".repeat(5000),
    "a b",
    " abc",
    "abc\n",
    "a\u0000b",
    "../etc/passwd",
    "a/b",
    "a%00b",
    "a;b",
    "id'--",
    "idé",
    "id\u2028",
  ];
  for (const id of malformed) {
    assert.equal(await loadIcsFacts(untouchableDb, id), null, JSON.stringify(id.slice(0, 20)));
  }
});

test("loadIcsFacts: a well-formed id (nanoid or uuid alphabet, up to 64 chars) does reach the query", async () => {
  for (const id of ["V1StGXR8_Z5jdHi6B-myT", "0b2f6f9e-9a3c-4c52-8a4e-1c2b3d4e5f60", "x".repeat(64)]) {
    await assert.rejects(loadIcsFacts(untouchableDb, id), /the database was queried/, id);
  }
});
