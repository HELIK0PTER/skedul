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
    "id ",
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
