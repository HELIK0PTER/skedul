export interface CalendarLinkInput {
  title: string;
  description: string;
  startAt: Date;
  endAt: Date;
  /** Where the séance takes place; the link or file carries it only when set. */
  location?: string | null;
}

/** 2026-07-03T12:00:00.000Z → 20260703T120000Z (RFC 5545 UTC form). */
function compactUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** "Add to calendar" web link for Google Calendar. */
export function googleCalendarUrl(input: CalendarLinkInput): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    details: input.description,
    dates: `${compactUtc(input.startAt)}/${compactUtc(input.endAt)}`,
  });
  if (input.location) params.set("location", input.location);
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** "Add to calendar" web link for Outlook.com. */
export function outlookCalendarUrl(input: CalendarLinkInput): string {
  const params = new URLSearchParams({
    rru: "addevent",
    subject: input.title,
    body: input.description,
    startdt: input.startAt.toISOString(),
    enddt: input.endAt.toISOString(),
  });
  if (input.location) params.set("location", input.location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params}`;
}

/**
 * RFC 5545 TEXT value. Backslash first, then `;` and `,`. A text can never add a line to the
 * file: every character a lenient parser (Python splitlines, Swift .newlines, ...) takes for a
 * line break (CRLF, CR, LF, NEL U+0085, LS U+2028, PS U+2029) becomes the `\n` escape, and every
 * other control character (C0 except tab, DEL, C1) is dropped.
 */
function escapeIcsText(s: string): string {
  return (
    s
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r\n|[\r\n\u0085\u2028\u2029]/g, "\\n")
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "")
  );
}

/** Size in UTF-8 octets of one code point. */
function utf8Octets(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  return codePoint < 0x10000 ? 3 : 4;
}

/**
 * RFC 5545 section 3.1: a content line holds at most 75 octets; a longer one continues on the next
 * physical line after CRLF + one space (so a continuation holds 74 octets after the space).
 * Counts UTF-8 octets per code point and never cuts a sequence or a surrogate pair.
 */
function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let used = 0;
  let room = 75;
  for (const ch of line) {
    const size = utf8Octets(ch.codePointAt(0) ?? 0);
    if (used + size > room) {
      parts.push(current);
      current = "";
      used = 0;
      room = 74;
    }
    current += ch;
    used += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/**
 * Minimal RFC 5545 file for one event. DTSTAMP mirrors DTSTART to stay pure. Every text,
 * the UID included, is escaped; every line is folded at 75 octets.
 */
export function buildIcs(input: CalendarLinkInput & { uid: string }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Skedul//Booking//FR",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(input.uid)}`,
    `DTSTAMP:${compactUtc(input.startAt)}`,
    `DTSTART:${compactUtc(input.startAt)}`,
    `DTEND:${compactUtc(input.endAt)}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    `DESCRIPTION:${escapeIcsText(input.description)}`,
    ...(input.location ? [`LOCATION:${escapeIcsText(input.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
