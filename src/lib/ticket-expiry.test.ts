import test from "node:test";
import assert from "node:assert/strict";

import {
  expiryFromLastDay,
  lastValidDay,
  offerCovers,
  ticketExpiry,
  validAt,
  validityOf,
} from "./ticket-expiry";

const TZ = "Europe/Paris";
const iso = (d: Date | null) => (d === null ? null : d.toISOString());

test("ticketExpiry: no validity, no expiry", () => {
  assert.equal(ticketExpiry(new Date("2026-10-12T10:00:00Z"), null, TZ), null);
});

test("ticketExpiry: one month from 31 January ends with February (clamped)", () => {
  // Paid 10:00 Paris on 31 Jan → valid through 28 Feb → expires 1 Mar 00:00 Paris.
  const at = ticketExpiry(new Date("2026-01-31T09:00:00Z"), { count: 1, unit: "month" }, TZ);
  assert.equal(iso(at), "2026-02-28T23:00:00.000Z");
  const leap = ticketExpiry(new Date("2028-01-31T09:00:00Z"), { count: 1, unit: "month" }, TZ);
  assert.equal(iso(leap), "2028-02-29T23:00:00.000Z");
  const year = ticketExpiry(new Date("2026-02-28T09:00:00Z"), { count: 12, unit: "month" }, TZ);
  assert.equal(iso(year), "2027-02-28T23:00:00.000Z");
});

test("ticketExpiry: days count from the LOCAL purchase day, across the autumn change", () => {
  // 21:30Z on 24 Oct = 23:30 Paris → local day 24 Oct, +1 day → valid through 25 Oct.
  const at = ticketExpiry(new Date("2026-10-24T21:30:00Z"), { count: 1, unit: "day" }, TZ);
  assert.equal(iso(at), "2026-10-25T23:00:00.000Z");
  // 22:30Z on 24 Oct is already 25 Oct in Paris.
  const late = ticketExpiry(new Date("2026-10-24T22:30:00Z"), { count: 1, unit: "day" }, TZ);
  assert.equal(iso(late), "2026-10-26T23:00:00.000Z");
  const thirty = ticketExpiry(new Date("2026-10-12T08:00:00Z"), { count: 30, unit: "day" }, TZ);
  assert.equal(iso(thirty), "2026-11-11T23:00:00.000Z");
});

test("validityOf reads an offer or purchase snapshot", () => {
  assert.deepEqual(validityOf({ validityCount: 3, validityUnit: "month" }), { count: 3, unit: "month" });
  assert.equal(validityOf({ validityCount: null, validityUnit: null }), null);
  assert.equal(validityOf({ validityCount: 3, validityUnit: null }), null);
});

test("lastValidDay is the local day before expires_at", () => {
  assert.equal(lastValidDay(new Date("2026-02-28T23:00:00Z"), TZ), "2026-02-28");
  assert.equal(lastValidDay(new Date("2026-10-25T23:00:00Z"), TZ), "2026-10-25");
});

test("expiryFromLastDay is the local midnight after the chosen day", () => {
  assert.equal(expiryFromLastDay("2026-02-28", TZ).toISOString(), "2026-02-28T23:00:00.000Z");
  // 25 Oct starts in summer time: midnight at 22:00Z on the 24th.
  assert.equal(expiryFromLastDay("2026-10-24", TZ).toISOString(), "2026-10-24T22:00:00.000Z");
  assert.equal(lastValidDay(expiryFromLastDay("2026-03-28", TZ), TZ), "2026-03-28");
});

test("validAt: valid when no expiry or when it expires strictly after the start", () => {
  const start = new Date("2026-03-01T09:00:00Z");
  assert.equal(validAt(null, start), true);
  assert.equal(validAt(new Date("2026-03-01T09:00:00.001Z"), start), true);
  assert.equal(validAt(new Date("2026-03-01T09:00:00Z"), start), false);
  assert.equal(validAt(new Date("2026-02-28T23:00:00Z"), start), false);
});

test("offerCovers: a one-month offer bought on 31 Jan covers 28 Feb, not 1 Mar", () => {
  const now = new Date("2026-01-31T09:00:00Z");
  const month = { count: 1, unit: "month" } as const;
  assert.equal(offerCovers(now, month, TZ, new Date("2026-02-28T19:00:00Z")), true);
  assert.equal(offerCovers(now, month, TZ, new Date("2026-02-28T23:30:00Z")), false);
  assert.equal(offerCovers(now, null, TZ, new Date("2030-01-01T00:00:00Z")), true);
});
