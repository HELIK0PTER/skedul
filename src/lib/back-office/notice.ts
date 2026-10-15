/**
 * « Au plus tard … avant le début » (spec § 2.13, Q13): the presets a pro picks
 * for the minimum notice, the label of any value, and the horizon check.
 */

/** Q13 presets. */
export const NOTICE_PRESETS: readonly { minutes: number; label: string }[] = [
  { minutes: 0, label: "Jusqu'au début" },
  { minutes: 15, label: "15 min avant" },
  { minutes: 30, label: "30 min avant" },
  { minutes: 60, label: "1 h avant" },
  { minutes: 120, label: "2 h avant" },
  { minutes: 180, label: "3 h avant" },
  { minutes: 360, label: "6 h avant" },
  { minutes: 720, label: "12 h avant" },
  { minutes: 1440, label: "24 h avant" },
  { minutes: 2880, label: "2 jours avant" },
  { minutes: 4320, label: "3 jours avant" },
  { minutes: 10080, label: "7 jours avant" },
];

/** The preset label, else « 45 min avant », « 1 h 30 min avant », « 5 jours avant ». */
export function noticeLabel(minutes: number): string {
  const n = Math.max(0, Math.round(minutes));
  const preset = NOTICE_PRESETS.find((p) => p.minutes === n);
  if (preset) return preset.label;
  if (n < 60) return `${n} min avant`;
  if (n % 1440 === 0) {
    const days = n / 1440;
    return `${days} ${days > 1 ? "jours" : "jour"} avant`;
  }
  const hours = Math.floor(n / 60);
  const rest = n % 60;
  return rest === 0 ? `${hours} h avant` : `${hours} h ${rest} min avant`;
}

/** True when the notice is longer than the horizon: online booking would never open (OUT L106). */
export function noticeExceedsHorizon(minNoticeMinutes: number, bookingHorizonDays: number): boolean {
  return minNoticeMinutes > bookingHorizonDays * 1440;
}

export const NOTICE_TOO_LONG =
  "Le délai minimum dépasse l'horizon de réservation : réduisez-le ou allongez l'horizon.";
