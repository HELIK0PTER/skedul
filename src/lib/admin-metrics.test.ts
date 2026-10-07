import test from "node:test";
import assert from "node:assert/strict";

import {
  countryName,
  dayLabel,
  fillDailySeries,
  lastDayKeys,
  mergeMoney,
  niceCeil,
  startOfDayKey,
  stripeMode,
  timeAgo,
} from "./admin-metrics";

// Intl output may use (narrow) no-break spaces.
const plain = (s: string) => s.replace(/\s/g, " ");

test("lastDayKeys lists the last N Paris days, oldest first", () => {
  assert.deepEqual(lastDayKeys(3, new Date("2026-10-07T10:00:00Z")), [
    "2026-10-05",
    "2026-10-06",
    "2026-10-07",
  ]);
});

test("lastDayKeys uses the Paris date, not the UTC one", () => {
  // 23:30 UTC on Oct 6 is already 01:30 on Oct 7 in Paris.
  assert.deepEqual(lastDayKeys(1, new Date("2026-10-06T23:30:00Z")), ["2026-10-07"]);
});

test("lastDayKeys does not skip the short spring-forward day", () => {
  // 2026-03-29 has 23 hours in Paris; 00:30 CEST on Mar 30 = 22:30 UTC Mar 29.
  assert.deepEqual(lastDayKeys(3, new Date("2026-03-29T22:30:00Z")), [
    "2026-03-28",
    "2026-03-29",
    "2026-03-30",
  ]);
});

test("startOfDayKey is local midnight in Paris", () => {
  assert.equal(startOfDayKey("2026-10-07").toISOString(), "2026-10-06T22:00:00.000Z");
  assert.equal(startOfDayKey("2026-12-01").toISOString(), "2026-11-30T23:00:00.000Z");
});

test("fillDailySeries fills missing days with 0 and coerces strings", () => {
  assert.deepEqual(
    fillDailySeries([{ day: "2026-10-06", value: "3" }], ["2026-10-05", "2026-10-06"]),
    [
      { day: "2026-10-05", value: 0 },
      { day: "2026-10-06", value: 3 },
    ],
  );
});

test("dayLabel formats a day key in French", () => {
  assert.equal(plain(dayLabel("2026-10-06")), "mar. 6 oct.");
});

test("niceCeil rounds up to 1, 2 or 5 × 10^n", () => {
  assert.equal(niceCeil(0), 1);
  assert.equal(niceCeil(1), 1);
  assert.equal(niceCeil(3), 5);
  assert.equal(niceCeil(7), 10);
  assert.equal(niceCeil(12), 20);
  assert.equal(niceCeil(45), 50);
  assert.equal(niceCeil(100), 100);
  assert.equal(niceCeil(101), 200);
});

test("mergeMoney sums per currency, drops zeros, biggest first", () => {
  assert.deepEqual(
    mergeMoney([
      { currency: "eur", cents: "1000" },
      { currency: "EUR", cents: 500 },
      { currency: "usd", cents: "0" },
      { currency: "usd", cents: "200" },
      { currency: "chf", cents: 0 },
    ]),
    [
      { currency: "eur", cents: 1500 },
      { currency: "usd", cents: 200 },
    ],
  );
});

test("stripeMode reads the key prefix", () => {
  assert.equal(stripeMode(undefined, false), "mock");
  assert.equal(stripeMode("sk_live_x", false), "mock");
  assert.equal(stripeMode("sk_test_x", true), "test");
  assert.equal(stripeMode("sk_live_x", true), "live");
  assert.equal(stripeMode("rk_live_x", true), "live");
});

test("timeAgo speaks French relative time", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const ago = (ms: number) => plain(timeAgo(new Date(now.getTime() - ms), now));
  assert.equal(ago(30_000), "à l'instant");
  assert.equal(ago(5 * 60_000), "il y a 5 minutes");
  assert.equal(ago(3 * 3_600_000), "il y a 3 heures");
  assert.equal(ago(24 * 3_600_000), "hier");
  assert.equal(ago(3 * 24 * 3_600_000), "il y a 3 jours");
  assert.equal(ago(40 * 24 * 3_600_000), "28 août 2026");
});

test("countryName gives the French country name", () => {
  assert.equal(countryName("FR"), "France");
  assert.equal(countryName(null), "Inconnu");
});
