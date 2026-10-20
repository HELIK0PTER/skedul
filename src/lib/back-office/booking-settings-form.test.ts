import assert from "node:assert/strict";
import test from "node:test";

import { BOOKING_ERROR_KEYS, checkBookingSettings } from "./booking-settings-form";
import { NOTICE_TOO_LONG } from "./notice";

const OK = { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 24 };

test("checkBookingSettings: valid settings give no problem, a notice of exactly the horizon included", () => {
  assert.equal(checkBookingSettings(OK), null);
  assert.equal(checkBookingSettings({ bookingHorizonDays: 3, minNoticeMinutes: 4320, cancelDeadlineHours: 0 }), null);
});

test("checkBookingSettings: bounds give the French message of the field that broke", () => {
  assert.deepEqual(checkBookingSettings({ ...OK, bookingHorizonDays: 400 }), { bookingHorizonDays: "Maximum 365." });
  assert.deepEqual(checkBookingSettings({ ...OK, bookingHorizonDays: 0 }), { bookingHorizonDays: "Minimum 1." });
  assert.deepEqual(checkBookingSettings({ ...OK, cancelDeadlineHours: 721 }), { cancelDeadlineHours: "Maximum 720." });
});

test("checkBookingSettings: an empty field (NaN) and a decimal are refused on their own field", () => {
  assert.deepEqual(checkBookingSettings({ ...OK, bookingHorizonDays: Number.NaN }), { bookingHorizonDays: "Indiquez un nombre." });
  assert.deepEqual(checkBookingSettings({ ...OK, cancelDeadlineHours: Number.NaN }), { cancelDeadlineHours: "Indiquez un nombre." });
  const decimal = checkBookingSettings({ ...OK, bookingHorizonDays: 1.5 });
  assert.deepEqual(Object.keys(decimal ?? {}), ["bookingHorizonDays"]);
});

test("checkBookingSettings: two broken fields are both reported", () => {
  assert.deepEqual(checkBookingSettings({ bookingHorizonDays: 400, minNoticeMinutes: 60, cancelDeadlineHours: 721 }), {
    bookingHorizonDays: "Maximum 365.",
    cancelDeadlineHours: "Maximum 720.",
  });
});

test("checkBookingSettings: a notice longer than the horizon is put on the notice field", () => {
  assert.deepEqual(checkBookingSettings({ bookingHorizonDays: 1, minNoticeMinutes: 10080, cancelDeadlineHours: 24 }), {
    minNoticeMinutes: NOTICE_TOO_LONG,
  });
  // one minute over a one-day horizon
  assert.deepEqual(checkBookingSettings({ bookingHorizonDays: 1, minNoticeMinutes: 1441, cancelDeadlineHours: 24 }), {
    minNoticeMinutes: NOTICE_TOO_LONG,
  });
  // out-of-bounds fields win: the horizon is not trustworthy yet
  assert.deepEqual(checkBookingSettings({ bookingHorizonDays: 0, minNoticeMinutes: 10080, cancelDeadlineHours: 24 }), {
    bookingHorizonDays: "Minimum 1.",
  });
});

test("BOOKING_ERROR_KEYS: editing the horizon also drops the notice message it can resolve", () => {
  assert.deepEqual(BOOKING_ERROR_KEYS.bookingHorizonDays, ["bookingHorizonDays", "minNoticeMinutes"]);
  assert.deepEqual(BOOKING_ERROR_KEYS.minNoticeMinutes, ["minNoticeMinutes"]);
  assert.deepEqual(BOOKING_ERROR_KEYS.cancelDeadlineHours, ["cancelDeadlineHours"]);
});
