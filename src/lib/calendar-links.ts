export interface CalendarLinkInput {
  title: string;
  description: string;
  startAt: Date;
  endAt: Date;
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
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params}`;
}

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Minimal RFC 5545 file for one event. DTSTAMP mirrors DTSTART to stay pure. */
export function buildIcs(input: CalendarLinkInput & { uid: string }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Skedul//Booking//FR",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${compactUtc(input.startAt)}`,
    `DTSTART:${compactUtc(input.startAt)}`,
    `DTEND:${compactUtc(input.endAt)}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    `DESCRIPTION:${escapeIcsText(input.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}
