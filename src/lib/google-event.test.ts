import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { buildOccurrenceEvent, googleEventId, type OccurrenceEventInput } from "./google-event";

const DASH = /[\u2014\u2013]/;

const base: OccurrenceEventInput = {
  occurrenceId: "occ_abc123",
  title: "Altinha débutants",
  isRdv: false,
  location: null,
  startAt: new Date("2026-10-12T17:00:00.000Z"),
  endAt: new Date("2026-10-12T18:00:00.000Z"),
  capacity: 12,
  timezone: "Europe/Paris",
  attendees: [
    { name: "Beatriz Almeida", email: "beatriz@example.com" },
    { name: "Rafael Souza", email: "rafael@example.com" },
  ],
};

test("googleEventId is the 64-hex sha256 of the occurrence id, deterministic", () => {
  const id = googleEventId("occ_abc123");
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(id, createHash("sha256").update("occ_abc123").digest("hex"));
  assert.equal(googleEventId("occ_abc123"), id);
  assert.notEqual(googleEventId("occ_abc124"), id);
  // Google event ids use the base32hex alphabet (a-v, 0-9): hex digits fit.
  assert.match(id, /^[a-v0-9]{5,1024}$/);
});

test("the same input builds the same body, id included", () => {
  const first = buildOccurrenceEvent(base);
  const second = buildOccurrenceEvent({ ...base, attendees: [...base.attendees] });
  assert.deepEqual(first, second);
  assert.equal(first.id, googleEventId("occ_abc123"));
  assert.equal(first.status, "confirmed");
});

test("a séance keeps its title and lists the seats and the attendees", () => {
  const ev = buildOccurrenceEvent(base);
  assert.equal(ev.summary, "Altinha débutants");
  assert.match(ev.description, /^Places : 2\/12\n/);
  assert.ok(ev.description.includes("• Beatriz Almeida (beatriz@example.com)"));
  assert.ok(ev.description.includes("• Rafael Souza (rafael@example.com)"));
  assert.ok(ev.description.endsWith("\n\nGéré par Skedul : ne pas modifier ici."));
  assert.deepEqual(ev.start, { dateTime: "2026-10-12T17:00:00.000Z", timeZone: "Europe/Paris" });
  assert.deepEqual(ev.end, { dateTime: "2026-10-12T18:00:00.000Z", timeZone: "Europe/Paris" });
});

test("an RDV appends the client name to the summary and shows no seat count", () => {
  const ev = buildOccurrenceEvent({
    ...base,
    title: "Cours particulier",
    isRdv: true,
    capacity: 1,
    attendees: [{ name: "Beatriz", email: "beatriz@example.com" }],
  });
  assert.equal(ev.summary, "Cours particulier · Beatriz");
  assert.equal(ev.description.includes("Places"), false);
  assert.ok(ev.description.includes("• Beatriz (beatriz@example.com)"));
});

test("a séance of capacity 1 still shows its seat count", () => {
  const ev = buildOccurrenceEvent({
    ...base,
    capacity: 1,
    attendees: [{ name: "Beatriz", email: "beatriz@example.com" }],
  });
  assert.equal(ev.summary, "Altinha débutants");
  assert.match(ev.description, /^Places : 1\/1\n/);
});

test("the location is always in the body: empty when unknown, so a PATCH clears an old place", () => {
  assert.equal(buildOccurrenceEvent(base).location, "");
  assert.equal(buildOccurrenceEvent({ ...base, location: "" }).location, "");
  assert.equal(buildOccurrenceEvent({ ...base, location: "Parc de la Villette" }).location, "Parc de la Villette");
});

test("no text of the body contains an em or en dash", () => {
  const bodies = [
    buildOccurrenceEvent(base),
    buildOccurrenceEvent({ ...base, location: "Parc de la Villette" }),
    buildOccurrenceEvent({ ...base, title: "Cours particulier", isRdv: true, capacity: 1, attendees: [base.attendees[0]] }),
  ];
  for (const body of bodies) {
    assert.equal(DASH.test(body.summary), false);
    assert.equal(DASH.test(body.description), false);
    assert.equal(DASH.test(body.location ?? ""), false);
  }
});
