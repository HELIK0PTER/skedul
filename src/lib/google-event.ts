export interface GoogleEventBody {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

export interface SessionEventInput {
  eventTitle: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  timezone: string;
  attendees: { name: string; email: string }[];
}

const FOOTER = "Géré par Skedul — ne pas modifier ici.";

/** Builds the Google Calendar event body for a class session (pure). */
export function buildSessionEvent(input: SessionEventInput): GoogleEventBody {
  const oneToOne = input.capacity === 1;
  const summary =
    oneToOne && input.attendees[0]
      ? `${input.eventTitle} · ${input.attendees[0].name}`
      : input.eventTitle;

  const lines: string[] = [];
  if (!oneToOne) {
    lines.push(`Places : ${input.attendees.length}/${input.capacity}`);
  }
  for (const a of input.attendees) {
    lines.push(`• ${a.name} (${a.email})`);
  }
  lines.push("", FOOTER);

  return {
    summary,
    description: lines.join("\n"),
    start: {
      dateTime: input.startAt.toISOString(),
      timeZone: input.timezone,
    },
    end: {
      dateTime: input.endAt.toISOString(),
      timeZone: input.timezone,
    },
  };
}
