import { createHash } from "node:crypto";

export interface GoogleEventBody {
  id?: string;
  status: "confirmed";
  summary: string;
  description: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

const FOOTER = "Géré par Skedul : ne pas modifier ici.";

/** hex(sha256(occurrenceId)): 64 lowercase hex chars, a valid Google event id (base32hex). */
export function googleEventId(occurrenceId: string): string {
  return createHash("sha256").update(occurrenceId).digest("hex");
}

export interface OccurrenceEventInput {
  occurrenceId: string;
  title: string;
  isRdv: boolean;
  location: string | null;
  startAt: Date;
  endAt: Date;
  capacity: number;
  timezone: string;
  attendees: readonly { name: string; email: string }[];
}

/**
 * Full Google Calendar body of one occurrence (pure): deterministic id, status
 * confirmed (a PATCH revives an event Google keeps as cancelled), summary
 * « {title} · {client} » for an RDV, « Places : n/cap » for a séance, one
 * « • name (email) » line per attendee, the footer, and the location. An unknown
 * location is sent as "": Google PATCH only changes the fields it receives, and an
 * empty string clears a place the event had before (override removed).
 */
export function buildOccurrenceEvent(input: OccurrenceEventInput): GoogleEventBody & { id: string } {
  const client = input.attendees[0];
  const summary = input.isRdv && client ? `${input.title} · ${client.name}` : input.title;

  const lines: string[] = [];
  if (!input.isRdv) lines.push(`Places : ${input.attendees.length}/${input.capacity}`);
  for (const attendee of input.attendees) lines.push(`• ${attendee.name} (${attendee.email})`);
  lines.push("", FOOTER);

  return {
    id: googleEventId(input.occurrenceId),
    status: "confirmed",
    summary,
    description: lines.join("\n"),
    location: input.location ?? "",
    start: { dateTime: input.startAt.toISOString(), timeZone: input.timezone },
    end: { dateTime: input.endAt.toISOString(), timeZone: input.timezone },
  };
}
