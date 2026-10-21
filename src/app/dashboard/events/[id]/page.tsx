import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { EventDeleteCard } from "@/components/dashboard/event-delete-card";
import { EventInfoForm, type EventInfoValue } from "@/components/dashboard/event-editor";
import { EventScheduleSection } from "@/components/dashboard/event-schedule-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusMark } from "@/components/dashboard/status-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { EventSegmentView } from "@/lib/back-office/event-reads";
import { formatWhen, planningHref } from "@/lib/back-office/format";
import { MODE_SHORT_LABELS } from "@/lib/back-office/labels";
import { draftsFromRows } from "@/lib/back-office/question-drafts";
import { formFromRule } from "@/lib/back-office/recurrence-form";
import { seatsShown } from "@/lib/booking/holds";
import { formatDayMonthYear, todayKey } from "@/lib/civil-date";
import { OCCURRENCE_STATUS_LABELS } from "@/lib/tickets-vocab";
import { getEventEditorPage } from "@/server/catalog-queries";
import { requireProfessional } from "@/server/pro-context";

export const metadata: Metadata = { title: "Événement" };

const SEGMENT_ROW =
  "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-border px-3 py-2 text-sm";

/** The other segments of the series: one with séances to come opens on its own page, so it is a link. */
function SegmentList({ segments }: { segments: EventSegmentView[] }) {
  return (
    <ul className="space-y-2">
      {segments.map((segment) => {
        const content = (
          <>
            <span>{segment.recurrenceLabel}</span>
            <span className="flex items-center gap-2 text-xs text-zinc-600">
              {segment.live && <Badge variant="neutral">À venir</Badge>}
              <span>
                {segment.lastDate === null
                  ? `À partir du ${formatDayMonthYear(segment.firstDate)}`
                  : `Du ${formatDayMonthYear(segment.firstDate)} au ${formatDayMonthYear(segment.lastDate)}`}
              </span>
            </span>
          </>
        );
        return (
          <li key={segment.eventId}>
            {segment.live ? (
              <Link
                href={`/dashboard/events/${segment.eventId}`}
                className={`${SEGMENT_ROW} hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
              >
                {content}
              </Link>
            ) : (
              <div className={SEGMENT_ROW}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pro = await requireProfessional();
  const lookup = await getEventEditorPage(pro.id, id);
  if (!lookup) notFound();
  if (lookup.kind === "redirect") redirect(`/dashboard/events/${lookup.eventId}`);

  const { data } = lookup;
  const { event } = data;
  const tz = pro.timezone;
  const now = new Date();

  const previousSegments = data.otherSegments.filter((segment) => segment.firstDate < event.rule.startDate);
  const nextSegments = data.otherSegments.filter((segment) => segment.firstDate > event.rule.startDate);

  const noActiveType =
    event.bookingMode === "tickets" &&
    !event.ticketTypeIds.some((typeId) => data.typeOptions.some((option) => option.id === typeId));

  const initialInfo: EventInfoValue = {
    title: event.title,
    description: event.description ?? "",
    location: event.location ?? "",
    color: event.color,
    bookingMode: event.bookingMode,
    isPrivate: event.isPrivate,
    capacity: event.capacity,
    overrides: event.overrides,
    ticketTypeIds: event.ticketTypeIds,
    questions: draftsFromRows(event.questions),
  };

  const savedSchedule = formFromRule(event.rule, event.durationMin);
  const initialSchedule =
    data.fromDate === null
      ? savedSchedule
      : {
          ...savedSchedule,
          startDate: data.fromDate,
          ...(data.remainingCount === null
            ? {}
            : { endMode: "count" as const, occurrenceCount: data.remainingCount }),
        };
  const scheduleKey = `${event.id}:${data.fromDate ?? "none"}:${event.durationMin}:${JSON.stringify(event.rule)}`;

  return (
    <>
      <PageHeader
        title={event.title}
        description={event.recurrenceLabel}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/events">
              <ArrowLeft />
              Tous les événements
            </Link>
          </Button>
        }
      />

      <div className="-mt-3 mb-6 flex flex-wrap items-center gap-2">
        <Badge variant="neutral">{MODE_SHORT_LABELS[event.bookingMode]}</Badge>
        {event.isPrivate && <Badge variant="outline">Privé</Badge>}
        {noActiveType && (
          <Badge variant="warning">
            <StatusMark tone="orange" decorative />
            Aucun ticket actif accepté
          </Badge>
        )}
        {data.readOnly && <Badge variant="neutral">Terminé</Badge>}
      </div>

      {data.readOnly && (
        <p className="mb-6 max-w-3xl rounded-xl border border-border bg-muted px-4 py-3 text-sm">
          Cet événement est terminé : il ne se modifie plus.
        </p>
      )}

      <div className="max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Informations</CardTitle>
          </CardHeader>
          <CardContent>
            <EventInfoForm
              key={event.id}
              eventId={event.id}
              seenVersion={event.version}
              initial={initialInfo}
              typeOptions={data.typeOptions}
              linkedArchivedTypes={data.linkedArchivedTypes}
              proWindow={data.proWindow}
              futureRegistrants={data.futureRegistrants}
              laterSegments={data.laterSegments}
              readOnly={data.readOnly}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Horaire et récurrence</CardTitle>
          </CardHeader>
          <CardContent>
            <EventScheduleSection
              formKey={scheduleKey}
              eventId={event.id}
              seenVersion={event.version}
              fromDate={data.fromDate}
              tz={tz}
              nowIso={now.toISOString()}
              initial={initialSchedule}
              remainingCount={data.remainingCount}
              readOnly={data.readOnly}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Prochaines séances</CardTitle>
          </CardHeader>
          <CardContent>
            {data.upcoming.length === 0 ? (
              <p className="text-sm text-zinc-600">Aucune séance à venir.</p>
            ) : (
              <ul className="-mx-3 space-y-0.5">
                {data.upcoming.map((occurrence) => (
                  <li key={occurrence.id}>
                    <Link
                      href={planningHref({ occurrenceId: occurrence.id, startsAt: occurrence.startsAt, tz })}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="tabular-nums">{formatWhen(occurrence.startsAt, occurrence.endsAt, tz)}</span>
                      <span className="flex items-center gap-2 text-xs text-zinc-600">
                        {occurrence.status === "cancelled" && (
                          <Badge variant="neutral">{OCCURRENCE_STATUS_LABELS.cancelled}</Badge>
                        )}
                        {/* seatsTaken still counts the pending holds that have lapsed and are not released yet: leave them out, as a visitor's count does. */}
                        <span>{`${occurrence.capacity - seatsShown(occurrence)} / ${occurrence.capacity} places`}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {previousSegments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Segments précédents</CardTitle>
              <CardDescription>
                {"Une série modifiée « à partir du » garde ses séances passées dans un segment précédent."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SegmentList segments={previousSegments} />
            </CardContent>
          </Card>
        )}

        {nextSegments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Segments suivants</CardTitle>
              <CardDescription>
                {
                  "La suite de la série est dans un segment à part, qui a ses propres séances. Les informations et la suppression de cet événement s'y appliquent aussi."
                }
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SegmentList segments={nextSegments} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Supprimer</CardTitle>
          </CardHeader>
          <CardContent>
            <EventDeleteCard
              key={event.id}
              eventId={event.id}
              seenVersion={event.version}
              title={event.title}
              todayKey={todayKey(now, tz)}
              fromDate={data.fromDate}
              initialPreview={data.deletePreview}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
