import assert from "node:assert/strict";
import test from "node:test";

import { PRO_TIMEZONES, isValidTimeZone, timeZoneLabel } from "./timezones";

test("PRO_TIMEZONES lists the six zones, Zurich in place of Geneva", () => {
  assert.deepEqual(PRO_TIMEZONES, [
    { id: "Europe/Paris", label: "Paris (France)" },
    { id: "Europe/Brussels", label: "Bruxelles (Belgique)" },
    { id: "Europe/Zurich", label: "Genève, Zurich (Suisse)" },
    { id: "Europe/London", label: "Londres (Royaume-Uni)" },
    { id: "America/Montreal", label: "Montréal (Canada)" },
    { id: "America/New_York", label: "New York (États-Unis)" },
  ]);
});

test("every listed zone is accepted by Intl", () => {
  for (const zone of PRO_TIMEZONES) assert.equal(isValidTimeZone(zone.id), true, zone.id);
});

test("isValidTimeZone accepts any IANA zone and refuses Geneva, the empty string and garbage", () => {
  assert.equal(isValidTimeZone("Europe/Zurich"), true);
  assert.equal(isValidTimeZone("Asia/Tokyo"), true);
  assert.equal(isValidTimeZone("Europe/Geneva"), false);
  assert.equal(isValidTimeZone(""), false);
  assert.equal(isValidTimeZone("   "), false);
  assert.equal(isValidTimeZone("Mars/Base"), false);
});

test("isValidTimeZone accepts canonical IANA names only: no offset, abbreviation or wrong letter case", () => {
  for (const ok of ["UTC", "Europe/Paris", "America/Los_Angeles", "America/Argentina/Buenos_Aires", "Etc/GMT+5"]) {
    assert.equal(isValidTimeZone(ok), true, ok);
  }
  // IANA links stay valid even though Intl resolves them to their target zone
  for (const link of ["America/Montreal", "Asia/Kolkata"]) assert.equal(isValidTimeZone(link), true, link);
  for (const bad of ["+01:00", "-05:00", "europe/paris", "Europe/PARIS", "america/montreal", "EST", "GMT", "utc", "Paris"]) {
    assert.equal(isValidTimeZone(bad), false, bad);
  }
});

test("timeZoneLabel returns the list label, else the zone id itself", () => {
  assert.equal(timeZoneLabel("Europe/Zurich"), "Genève, Zurich (Suisse)");
  assert.equal(timeZoneLabel("America/New_York"), "New York (États-Unis)");
  assert.equal(timeZoneLabel("Asia/Tokyo"), "Asia/Tokyo");
});

test("no label carries a dash", () => {
  const dash = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
  for (const zone of PRO_TIMEZONES) assert.equal(dash.test(zone.label), false, zone.label);
});
