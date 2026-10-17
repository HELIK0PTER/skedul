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
          className="rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

/** The accepted ticket types as chips, « Aucun », and the orange alert when none of them is active. */
function AcceptedTypes({ row }: { row: EventListRow }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {row.acceptedTypes.map((t) => (
        <TypeChip key={t.id} name={t.name} color={t.color} archived={t.archived} />
      ))}
      {row.noActiveType && (
        <span className="inline-flex items-center gap-2 text-sm text-warning">
          <StatusMark tone="orange" label={NO_ACTIVE_TICKET} />
          {NO_ACTIVE_TICKET}
        </span>
      )}
      {row.acceptedTypes.length === 0 && !row.noActiveType && (
        <span className="text-sm text-muted-foreground">Aucun</span>
      )}
    </div>
  );
}

function NextOccurrence({ row, tz }: { row: EventListRow; tz: string }) {
  if (!row.nextOccurrence) {
    return <span className="text-sm text-muted-foreground">Aucune séance à venir</span>;
  }
  return <span className="text-sm">{formatWhenShort(row.nextOccurrence.startsAt, tz)}</span>;
}

/** From 640 px: one table; below: one card per event with the same facts. */
function EventRows({ rows, tz, label }: { rows: EventListRow[]; tz: string; label: string }) {
  return (
    <>
      <Card className="hidden overflow-hidden sm:block">
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
                <td className="px-4 py-4">
                  <AcceptedTypes row={row} />
                </td>
                <td className="px-5 py-4">
                  <NextOccurrence row={row} tz={tz} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ul aria-label={label} className="grid gap-3 sm:hidden">
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
                  <dd>
                    <AcceptedTypes row={row} />
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Prochaine séance</dt>
                  <dd className="text-right">
                    <NextOccurrence row={row} tz={tz} />
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
export function EventList({ live, ended, tz }: { live: EventListRow[]; ended: EventListRow[]; tz: string }) {
  return (
    <div className="space-y-8">
      {live.length > 0 ? (
        <EventRows rows={live} tz={tz} label="Événements en cours" />
      ) : (
        <p className="text-sm text-muted-foreground">Aucun événement en cours.</p>
      )}

      {ended.length > 0 && (
        <details>
          <summary className="cursor-pointer rounded-sm text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Terminés ({ended.length})
          </summary>
          <div className="mt-4">
            <EventRows rows={ended} tz={tz} label="Événements terminés" />
          </div>
        </details>
      )}
    </div>
  );
}
