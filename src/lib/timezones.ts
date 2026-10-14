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

/** One path segment of a canonical IANA name: capitalised, e.g. Europe, New_York, Port-au-Prince, GMT+5. */
const IANA_SEGMENT = /^[A-Z][A-Za-z0-9_+-]*$/;

/**
 * True for a canonical IANA name that Intl accepts: "UTC" or Area/Location
 * with capitalised segments. Refused: "" and garbage (Intl throws a
 * RangeError), offsets ("+01:00": PostgreSQL reads a text offset with the
 * POSIX sign inverted in `at time zone`), abbreviations ("EST") and a wrong
 * letter case ("europe/paris"). Intl resolves a link to its target
 * (America/Montreal becomes America/Toronto), so the resolved name is not
 * compared to the input: only a mere case difference is refused.
 */
export function isValidTimeZone(tz: string): boolean {
  if (tz !== "UTC" && !(tz.includes("/") && tz.split("/").every((segment) => IANA_SEGMENT.test(segment)))) {
    return false;
  }
  try {
    const resolved = new Intl.DateTimeFormat("en", { timeZone: tz }).resolvedOptions().timeZone;
    return resolved === tz || resolved.toLowerCase() !== tz.toLowerCase();
  } catch {
    return false;
  }
}

/** The list label, else the zone id itself. */
export function timeZoneLabel(tz: string): string {
  return PRO_TIMEZONES.find((zone) => zone.id === tz)?.label ?? tz;
}
