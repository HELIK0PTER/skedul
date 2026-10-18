"use client";

import { useId } from "react";
import Link from "next/link";
import { ArrowUpRight, MapPin } from "lucide-react";

import { BookingStatusBadge } from "@/components/dashboard/booking-status-badge";
import { CoverageBadge } from "@/components/dashboard/coverage-badge";
import { TypeChip } from "@/components/dashboard/type-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatWhen, plural } from "@/lib/back-office/format";
import { MODE_SHORT_LABELS } from "@/lib/back-office/labels";
import type { PlanningAttendeeVM, PlanningItemVM } from "@/lib/back-office/planning-view";

function AttendeeRow({ attendee }: { attendee: PlanningAttendeeVM }) {
  return (
    <li className="rounded-xl border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Link
          href={`/dashboard/clients/${attendee.customerId}`}
          className="min-w-0 rounded font-medium text-foreground underline-offset-4 wrap-anywhere hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {attendee.name}
        </Link>
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={attendee.email}>
          {attendee.email}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <CoverageBadge coverage={attendee.coverage} />
        <BookingStatusBadge status={attendee.status} />
        {attendee.moved && <Badge variant="neutral">Déplacé</Badge>}
      </div>
      {attendee.ticketLabel && (
        <p className="mt-2 text-xs text-muted-foreground wrap-anywhere">{attendee.ticketLabel}</p>
      )}
      {attendee.holdLapsed ? (
        <p className="mt-1 text-xs text-zinc-600">Paiement non finalisé, place libérée</p>
      ) : (
        attendee.holdUntil && <p className="mt-1 text-xs text-warning">{`Paiement en cours jusqu'à ${attendee.holdUntil}`}</p>
      )}
      {attendee.answers.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {attendee.answers.map((a, i) => (
            <li key={`${a.label}-${i}`} className="wrap-anywhere">{`${a.label} : ${a.value}`}</li>
          ))}
        </ul>
      )}
      {attendee.notes && (
        <p className="mt-1 text-xs text-muted-foreground wrap-anywhere">{`Note : ${attendee.notes}`}</p>
      )}
    </li>
  );
}

/**
 * A séance or an RDV of the planning. The caller keeps the occurrence's id and
 * passes the item freshly read from the page data, so seats and attendees are
 * never the ones clicked before an action. `onClose(notice)` closes the dialog
 * and may hand the page a status line (Task 25: an RDV that an action ends
 * leaves the page data, so the dialog cannot show the line itself).
 */
export function OccurrenceDialog({
  item,
  tz,
  onClose,
}: {
  item: PlanningItemVM;
  tz: string;
  nowIso: string;
  onClose: (notice?: string) => void;
}) {
  const summaryId = useId();
  const cancelled = item.status === "cancelled";
  const isSeance = item.kind === "seance";
  const place = item.location
    ? `Lieu : ${item.location}${item.locationOverride !== null ? " (pour cette séance)" : ""}`
    : "Lieu non précisé";

  // `Dialog` calls its onClose with the click event (backdrop, close button): never pass `onClose` itself, it reads a notice.
  return (
    <Dialog open onClose={() => onClose()} title={item.title} describedBy={summaryId}>
      <div id={summaryId} className="grid gap-3">
        <p className="text-sm text-foreground">{formatWhen(new Date(item.startsAt), new Date(item.endsAt), tz)}</p>
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 wrap-anywhere">{place}</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {cancelled && <Badge variant="destructive">Annulée</Badge>}
          {isSeance && item.bookingMode && <Badge variant="outline">{MODE_SHORT_LABELS[item.bookingMode]}</Badge>}
          {item.isPrivate && <Badge variant="neutral">Privé</Badge>}
          {item.acceptedTypes.map((t) => (
            <TypeChip key={t.id} name={t.name} color={t.color} />
          ))}
        </div>
        {isSeance && (
          <p className="text-sm font-medium tabular-nums">
            {`${plural(item.seatsTaken, "inscrit", "inscrits")} sur ${item.capacity} · ${plural(item.seatsShown, "place en ligne", "places en ligne")}`}
          </p>
        )}
      </div>

      {item.attendees.length === 0 ? (
        <p className="mt-4 rounded-xl bg-muted/60 px-3 py-4 text-sm text-muted-foreground">
          Personne n&apos;est inscrit pour le moment.
        </p>
      ) : (
        <ul className="mt-4 grid gap-2" aria-label="Inscrits">
          {item.attendees.map((a) => (
            <AttendeeRow key={a.bookingId} attendee={a} />
          ))}
        </ul>
      )}

      {isSeance && item.eventId && (
        <div className="mt-5 flex justify-end border-t border-border pt-4">
          <Button asChild variant="secondary" size="sm">
            <Link href={`/dashboard/events/${item.eventId}`}>
              Ouvrir l&apos;événement
              <ArrowUpRight />
            </Link>
          </Button>
        </div>
      )}
    </Dialog>
  );
}
