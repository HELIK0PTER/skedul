import assert from "node:assert/strict";
import test from "node:test";

import { keyPaths, privateKeyPaths } from "./key-paths";

test("keyPaths lists every key of an object at any depth, sorted, once per array element shape", () => {
  const value = {
    title: "Altinha",
    startsAt: new Date("2026-10-12T17:00:00Z"),
    window: { bookingHorizonDays: 60 },
    offers: [{ offerId: "o1", label: "x" }, { offerId: "o2", label: "y", covers: true }],
    note: null,
  };
  assert.deepEqual(keyPaths(value), [
    "note",
    "offers",
    "offers[].covers",
    "offers[].label",
    "offers[].offerId",
    "startsAt",
    "title",
    "window",
    "window.bookingHorizonDays",
  ]);
  assert.deepEqual(keyPaths(null), []);
  assert.deepEqual(keyPaths("text"), []);
  assert.deepEqual(keyPaths([]), []);
});

test("privateKeyPaths names the private columns of the professional, the customer and the payment, at any depth", () => {
  assert.deepEqual(privateKeyPaths({ title: "Altinha", capacity: 12, window: { bookingHorizonDays: 60 } }), []);
  assert.deepEqual(
    privateKeyPaths({ pro: { userId: "u", stripeAccountId: "a", googleCalendarId: "g" }, rows: [{ customerId: "c", checkoutUrl: "u", email: "e" }], createdAt: new Date(0) }),
    [
      "createdAt",
      "pro.googleCalendarId",
      "pro.stripeAccountId",
      "pro.userId",
      "rows[].checkoutUrl",
      "rows[].customerId",
      "rows[].email",
    ],
  );
  // a key that only contains the name is not the column
  assert.deepEqual(privateKeyPaths({ userIdentity: 1, emailing: 2, mystripe: 3 }), []);
});
