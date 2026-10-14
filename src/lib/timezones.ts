/**
 * Time zones a pro can pick (spec § 7). Pure. `Europe/Geneva` is not an IANA
 * zone (Intl throws on it): Europe/Zurich replaces it. The server accepts any
 * zone Intl accepts, so a pro already on another valid zone keeps it.
 */

/** Zones offered in forms. */
export const PRO_TIMEZONES: readonly { id: string; label: string }[] = [
  { id: "Europe/Paris", label: "Paris (France)" },
  { id: "Europe/Brussels", label: "Bruxelles (Belgique)" },
  { id: "Europe/Zurich", label: "Genève, Zurich (Suisse)" },
  { id: "Europe/London", label: "Londres (Royaume-Uni)" },
  { id: "America/Montreal", label: "Montréal (Canada)" },
  { id: "America/New_York", label: "New York (États-Unis)" },
];

/** True when Intl accepts the zone (the constructor throws a RangeError otherwise); false for "". */
export function isValidTimeZone(tz: string): boolean {
  if (tz === "") return false;
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The list label, else the zone id itself. */
export function timeZoneLabel(tz: string): string {
  return PRO_TIMEZONES.find((zone) => zone.id === tz)?.label ?? tz;
}
