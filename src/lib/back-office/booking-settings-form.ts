/**
 * The checks of the « Réservations » form, run in the browser before the action
 * with the schema and the rule the server uses, so a mistake is named on its own
 * field. Pure and client-safe; the server validates again.
 */
import { NOTICE_TOO_LONG, noticeExceedsHorizon } from "@/lib/back-office/notice";
import { bookingSettingsSchema, type BookingSettings } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";

/**
 * The error keys that editing each field can resolve: the notice message depends on the
 * horizon too, so a new horizon drops it. A field added to BookingSettings must be listed here.
 */
export const BOOKING_ERROR_KEYS: Record<keyof BookingSettings, readonly string[]> = {
  bookingHorizonDays: ["bookingHorizonDays", "minNoticeMinutes"],
  minNoticeMinutes: ["minNoticeMinutes"],
  cancelDeadlineHours: ["cancelDeadlineHours"],
};

/**
 * The message of each field that cannot be saved, keyed by field name (« Maximum 365. »), or
 * null when the settings are fine. A bound is checked first; the notice against the horizon only
 * when the horizon itself is a valid number.
 */
export function checkBookingSettings(values: BookingSettings): Record<string, string> | null {
  const parsed = parseFr(bookingSettingsSchema, values);
  if (!parsed.ok) return parsed.fieldErrors;
  if (noticeExceedsHorizon(parsed.data.minNoticeMinutes, parsed.data.bookingHorizonDays)) {
    return { minNoticeMinutes: NOTICE_TOO_LONG };
  }
  return null;
}
