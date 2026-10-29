import { test } from "node:test";
import assert from "node:assert/strict";

import { CHECKOUT_MINUTES, HOLD_MINUTES } from "@/lib/tickets";

import { checkoutExpiry, holdExpiry, seatsShown } from "./holds";

const now = new Date("2026-10-12T10:00:00.000Z");

test("a hold lasts 45 minutes, longer than the 31-minute Checkout session", () => {
  assert.equal(holdExpiry(now).toISOString(), "2026-10-12T10:45:00.000Z");
  assert.equal(checkoutExpiry(now, "buybook").toISOString(), "2026-10-12T10:31:00.000Z");
  assert.ok(HOLD_MINUTES > CHECKOUT_MINUTES, "the seat must outlive the payment page");
  assert.ok(CHECKOUT_MINUTES >= 30, "Stripe refuses an expires_at under 30 minutes");
});

test("a shop checkout lasts 24 hours", () => {
  assert.equal(checkoutExpiry(now, "shop").toISOString(), "2026-10-13T10:00:00.000Z");
});

test("seats shown add back the elapsed holds and never go below 0", () => {
  assert.equal(seatsShown({ capacity: 12, seatsTaken: 12, elapsedHolds: 0 }), 0);
  assert.equal(seatsShown({ capacity: 12, seatsTaken: 12, elapsedHolds: 2 }), 2);
  assert.equal(seatsShown({ capacity: 12, seatsTaken: 5, elapsedHolds: 0 }), 7);
  assert.equal(seatsShown({ capacity: 3, seatsTaken: 5, elapsedHolds: 0 }), 0);
});
