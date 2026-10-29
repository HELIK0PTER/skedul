import Link from "next/link";

import { StatusMark } from "@/components/dashboard/status-mark";
import { TypeChip } from "@/components/dashboard/type-chip";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { EventListRow } from "@/lib/back-office/event-reads";
import { formatWhenShort } from "@/lib/back-office/format";
import { MODE_SHORT_LABELS } from "@/lib/back-office/labels";

const NO_ACTIVE_TICKET = "Aucun ticket actif accepté";

/** Colour dot, title link, recurrence and the « Privé » badge of one event. */
function EventTitle({ row }: { row: EventListRow }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        aria-hidden
        className="mt-1.5 size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: row.color }}
      />
      <div className="min-w-0">
        <Link
          href={`/dashboard/events/${row.eventId}`}
          className="rounded-sm font-medium break-words hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.title}
        </Link>
        <p className="text-xs text-muted-foreground">{row.recurrenceLabel}</p>
        {row.isPrivate && (
          <Badge variant="neutral" className="mt-1.5">
            Privé
          </Badge>
        )}
      </div>
    </div>
  );
}

/**
 * The accepted ticket types as chips, « Aucun », and the orange alert when none of them is active.
 * Type names are typed by the pro: the caller sets `overflow-wrap` (inherited by the chips) so a long
 * unbroken name wraps instead of being clipped.
 */
function AcceptedTypes({ row }: { row: EventListRow }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {row.acceptedTypes.map((t) => (
        <TypeChip key={t.id} name={t.name} color={t.color} archived={t.archived} />
      ))}
      {row.noActiveType && (
        <span className="inline-flex items-center gap-2 text-sm text-warning">
          {/* The text beside the mark carries the meaning: the mark is decorative. */}
          <StatusMark tone="orange" decorative />
          {NO_ACTIVE_TICKET}
        </span>
      )}
      {row.acceptedTypes.length === 0 && !row.noActiveType && (
        <span className="text-sm text-muted-foreground">Aucun</span>
      )}
    </div>
  );
}

function NextOccurrence({ row, tz, now }: { row: EventListRow; tz: string; now: Date }) {
  if (!row.nextOccurrence) {
    return <span className="text-sm text-muted-foreground">Aucune séance à venir</span>;
  }
  return <span className="text-sm">{formatWhenShort(row.nextOccurrence.startsAt, tz, now)}</span>;
}

/** From 640 px: one table; below: one card per event with the same facts. */
function EventRows({ rows, tz, now, label }: { rows: EventListRow[]; tz: string; now: Date; label: string }) {
  return (
    <>
      {/* overflow-x-auto (not hidden): between 640 and ~800 px the table is wider than the card and scrolls inside it. */}
      <Card className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <th scope="col" className="px-5 py-3 font-medium">
                Événement
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Mode
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Tickets acceptés
              </th>
              <th scope="col" className="px-5 py-3 font-medium">
                Prochaine séance
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.eventId} className="align-top transition-colors hover:bg-muted/40">
                <td className="px-5 py-4">
                  <EventTitle row={row} />
                </td>
                <td className="px-4 py-4 whitespace-nowrap">{MODE_SHORT_LABELS[row.bookingMode]}</td>
                <td className="px-4 py-4 break-words">
                  <AcceptedTypes row={row} />
                </td>
                <td className="px-5 py-4">
                  <NextOccurrence row={row} tz={tz} now={now} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* grid-cols-1 is minmax(0, 1fr): a plain grid track grows to the longest word and the cards overflow. */}
      <ul aria-label={label} className="grid grid-cols-1 gap-3 sm:hidden">
        {rows.map((row) => (
          <li key={row.eventId}>
            <Card className="p-4">
              <EventTitle row={row} />
              <dl className="mt-4 grid gap-3 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Mode</dt>
                  <dd>{MODE_SHORT_LABELS[row.bookingMode]}</dd>
                </div>
                <div className="grid gap-1.5">
                  <dt className="text-muted-foreground">Tickets acceptés</dt>
                  {/* anywhere (not break-word): the dd is a grid item, only this lets it shrink below a long word. */}
                  <dd className="[overflow-wrap:anywhere]">
                    <AcceptedTypes row={row} />
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Prochaine séance</dt>
                  <dd className="text-right">
                    <NextOccurrence row={row} tz={tz} now={now} />
                  </dd>
                </div>
              </dl>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The events list (spec § 13.1): one row per series, on its current segment.
 * Server component, no state. `ended` (every segment archived) sits in a
 * closed « Terminés » disclosure.
 */
export function EventList({
  live,
  ended,
  tz,
  now,
}: {
  live: EventListRow[];
  ended: EventListRow[];
  tz: string;
  now: Date;
}) {
  return (
    <div className="space-y-8">
      {live.length > 0 ? (
        <EventRows rows={live} tz={tz} now={now} label="Événements en cours" />
      ) : (
        <p className="text-sm text-muted-foreground">Aucun événement en cours.</p>
      )}

      {ended.length > 0 && (
        <details>
          <summary className="cursor-pointer rounded-sm text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Terminés ({ended.length})
          </summary>
          <div className="mt-4">
            <EventRows rows={ended} tz={tz} now={now} label="Événements terminés" />
          </div>
        </details>
      )}
    </div>
  );
}
