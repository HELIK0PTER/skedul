import test from "node:test";
import assert from "node:assert/strict";

import { syncSessionWith } from "./calendar-sync";

// A session loader that returns a connected pro with one attendee.
const connectedSession = {
  sessionId: "s1",
  professionalId: "p1",
  userId: "u1",
  googleCalendarId: "cal1",
  googleEventId: null as string | null,
  eventTitle: "Coaching",
  startAt: new Date("2026-07-03T12:00:00Z"),
  endAt: new Date("2026-07-03T13:00:00Z"),
  capacity: 1,
  timezone: "Europe/Paris",
  attendees: [{ name: "Alice", email: "a@x.com" }],
};

function makeDeps(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      enabled: true,
      loadSession: async () => connectedSession,
      getAccessToken: async () => "tok",
      insertEvent: async () => {
        calls.push("insert");
        return "ev1";
      },
      patchEvent: async () => {
        calls.push("patch");
      },
      deleteEvent: async () => {
        calls.push("delete");
      },
      saveEventId: async () => {
        calls.push("save");
      },
      ...over,
    },
  };
}

test("disabled → no network calls", async () => {
  const { calls, deps } = makeDeps({ enabled: false });
  await syncSessionWith("s1", deps);
  assert.deepEqual(calls, []);
});

test("connected pro, no existing event → insert then save id", async () => {
  const { calls, deps } = makeDeps();
  await syncSessionWith("s1", deps);
  assert.deepEqual(calls, ["insert", "save"]);
});

test("existing event → patch (no insert)", async () => {
  const { calls, deps } = makeDeps({
    loadSession: async () => ({ ...connectedSession, googleEventId: "ev1" }),
  });
  await syncSessionWith("s1", deps);
  assert.deepEqual(calls, ["patch"]);
});

test("no active attendees + existing event → delete", async () => {
  const { calls, deps } = makeDeps({
    loadSession: async () => ({
      ...connectedSession,
      googleEventId: "ev1",
      attendees: [],
    }),
  });
  await syncSessionWith("s1", deps);
  assert.deepEqual(calls, ["delete", "save"]);
});

test("pro not connected (no calendar id) → no calls", async () => {
  const { calls, deps } = makeDeps({
    loadSession: async () => ({ ...connectedSession, googleCalendarId: null }),
  });
  await syncSessionWith("s1", deps);
  assert.deepEqual(calls, []);
});
