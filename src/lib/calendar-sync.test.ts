import test from "node:test";
import assert from "node:assert/strict";

import { syncOccurrenceWith, wantsGoogleEvent, type LoadedOccurrence, type SyncDeps } from "./calendar-sync-core";
import { googleEventId, type GoogleEventBody } from "./google-event";

const EVENT_ID = googleEventId("occ1");

/** A scheduled séance of a connected pro with one confirmed attendee and no Google marker. */
const seance: LoadedOccurrence = {
  occurrenceId: "occ1",
  userId: "u1",
  googleCalendarId: "cal1",
  googleEventId: null,
  status: "scheduled",
  isRdv: false,
  title: "Altinha débutants",
  location: "Parc de la Villette",
  startAt: new Date("2026-10-12T17:00:00Z"),
  endAt: new Date("2026-10-12T18:00:00Z"),
  capacity: 12,
  timezone: "Europe/Paris",
  attendees: [{ name: "Beatriz", email: "beatriz@example.com" }],
};

type Log = { calls: string[]; saved: (string | null)[]; bodies: GoogleEventBody[] };

/** Fake deps that record every call, in order; `over` replaces some of them and sees the log. */
function makeDeps(loaded: LoadedOccurrence | null = seance, over: (log: Log) => Partial<SyncDeps> = () => ({})) {
  const log: Log = { calls: [], saved: [], bodies: [] };
  const deps: SyncDeps = {
    enabled: true,
    loadOccurrence: async () => {
      log.calls.push("load");
      return loaded;
    },
    getAccessToken: async () => {
      log.calls.push("token");
      return "tok";
    },
    insertEvent: async (_token, _calendarId, body) => {
      log.calls.push("insert");
      log.bodies.push(body);
      return "created";
    },
    patchEvent: async (_token, _calendarId, eventId, body) => {
      log.calls.push(`patch:${eventId}`);
      log.bodies.push(body);
      return "patched";
    },
    deleteEvent: async (_token, _calendarId, eventId) => {
      log.calls.push(`delete:${eventId}`);
    },
    saveEventId: async (_occurrenceId, eventId) => {
      log.calls.push("save");
      log.saved.push(eventId);
    },
    ...over(log),
  };
  return { ...log, deps };
}

test("wantsGoogleEvent: a scheduled occurrence with at least one confirmed attendee", () => {
  assert.equal(wantsGoogleEvent({ status: "scheduled", attendees: seance.attendees }), true);
  assert.equal(wantsGoogleEvent({ status: "scheduled", attendees: [] }), false);
  assert.equal(wantsGoogleEvent({ status: "cancelled", attendees: seance.attendees }), false);
});

test("disabled: nothing is loaded and nothing is called", async () => {
  const { calls, deps } = makeDeps(seance, () => ({ enabled: false }));
  assert.equal(await syncOccurrenceWith("occ1", deps), "disabled");
  assert.deepEqual(calls, []);
});

test("unknown occurrence, or a pro without calendar: skipped, no token", async () => {
  const missing = makeDeps(null);
  assert.equal(await syncOccurrenceWith("occ1", missing.deps), "skipped");
  assert.deepEqual(missing.calls, ["load"]);

  const noCalendar = makeDeps({ ...seance, googleCalendarId: null });
  assert.equal(await syncOccurrenceWith("occ1", noCalendar.deps), "skipped");
  assert.deepEqual(noCalendar.calls, ["load"]);
});

test("nothing wanted and no marker: noop, the token is never fetched", async () => {
  const empty = makeDeps({ ...seance, attendees: [] });
  assert.equal(await syncOccurrenceWith("occ1", empty.deps), "noop");
  assert.deepEqual(empty.calls, ["load"]);

  const cancelled = makeDeps({ ...seance, status: "cancelled" });
  assert.equal(await syncOccurrenceWith("occ1", cancelled.deps), "noop");
  assert.deepEqual(cancelled.calls, ["load"]);
});

test("nothing wanted but a marker: delete the event then clear the marker", async () => {
  const { calls, saved, deps } = makeDeps({ ...seance, attendees: [], googleEventId: EVENT_ID });
  assert.equal(await syncOccurrenceWith("occ1", deps), "deleted");
  assert.deepEqual(calls, ["load", "token", `delete:${EVENT_ID}`, "save"]);
  assert.deepEqual(saved, [null]);
});

test("a cancelled occurrence with a marker is deleted", async () => {
  const { calls, saved, deps } = makeDeps({ ...seance, status: "cancelled", googleEventId: EVENT_ID });
  assert.equal(await syncOccurrenceWith("occ1", deps), "deleted");
  assert.deepEqual(calls, ["load", "token", `delete:${EVENT_ID}`, "save"]);
  assert.deepEqual(saved, [null]);
});

test("wanted and no marker: insert with the deterministic id, then save it", async () => {
  const { calls, saved, bodies, deps } = makeDeps();
  assert.equal(await syncOccurrenceWith("occ1", deps), "created");
  assert.deepEqual(calls, ["load", "token", "insert", "save"]);
  assert.deepEqual(saved, [EVENT_ID]);
  assert.equal(bodies[0].id, EVENT_ID);
  assert.equal(bodies[0].status, "confirmed");
  assert.equal(bodies[0].summary, "Altinha débutants");
  assert.equal(bodies[0].location, "Parc de la Villette");
});

test("insert answers « exists »: the event is revived by a PATCH of the same body, then saved", async () => {
  const { calls, saved, bodies, deps } = makeDeps(seance, (log) => ({
    insertEvent: async (_token, _calendarId, body) => {
      log.calls.push("insert");
      log.bodies.push(body);
      return "exists";
    },
  }));
  assert.equal(await syncOccurrenceWith("occ1", deps), "created");
  assert.deepEqual(calls, ["load", "token", "insert", `patch:${EVENT_ID}`, "save"]);
  assert.deepEqual(bodies[1], bodies[0]);
  assert.equal(bodies[1].id, EVENT_ID);
  assert.deepEqual(saved, [EVENT_ID]);
});

test("wanted and a marker: patch only, no insert, no save", async () => {
  const { calls, saved, deps } = makeDeps({ ...seance, googleEventId: EVENT_ID });
  assert.equal(await syncOccurrenceWith("occ1", deps), "updated");
  assert.deepEqual(calls, ["load", "token", `patch:${EVENT_ID}`]);
  assert.deepEqual(saved, []);
});

test("a marker whose event is gone (patch « missing »): insert again, then save", async () => {
  const { calls, saved, deps } = makeDeps({ ...seance, googleEventId: "old-marker" }, (log) => ({
    patchEvent: async (_token, _calendarId, eventId) => {
      log.calls.push(`patch:${eventId}`);
      return "missing";
    },
  }));
  assert.equal(await syncOccurrenceWith("occ1", deps), "created");
  assert.deepEqual(calls, ["load", "token", "patch:old-marker", "insert", "save"]);
  assert.deepEqual(saved, [EVENT_ID]);
});

test("an RDV is synced like a séance, with the client in the summary and an empty location", async () => {
  const { bodies, deps } = makeDeps({
    ...seance,
    isRdv: true,
    title: "Cours particulier",
    location: null,
    capacity: 1,
    attendees: [{ name: "Beatriz", email: "beatriz@example.com" }],
  });
  assert.equal(await syncOccurrenceWith("occ1", deps), "created");
  assert.equal(bodies[0].summary, "Cours particulier · Beatriz");
  assert.equal(bodies[0].location, "");
});

test("an error from Google propagates (syncOccurrence logs it, the action never fails)", async () => {
  const { deps } = makeDeps(seance, () => ({
    insertEvent: async () => {
      throw new Error("Google Calendar insert event failed (403): forbidden");
    },
  }));
  await assert.rejects(() => syncOccurrenceWith("occ1", deps), /insert event failed \(403\)/);
});
