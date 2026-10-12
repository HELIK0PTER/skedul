import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlanningCalendar } from "@/components/dashboard/planning-calendar";
import { getCurrentProfessional } from "@/lib/session";
import { dayKeyInTz } from "@/lib/datetime";
import { getProEventTypes, getProPlanningWeek } from "@/server/queries";
import {
  adjacentWeekParam,
  gridRange,
  paramForWeek,
  weekBounds,
  weekDays,
  weekStartFromParam,
} from "@/lib/planning";

export const metadata: Metadata = { title: "Planning" };

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const pro = (await getCurrentProfessional())!;
  const { week } = await searchParams;
  const tz = pro.timezone;

  const weekStart = weekStartFromParam(week, tz, new Date());
  const { start, end } = weekBounds(weekStart, tz);
  const [{ sessions, timeOff }, eventTypes] = await Promise.all([
    getProPlanningWeek(pro.id, start, end),
    getProEventTypes(pro.id),
  ]);

  const days = weekDays(weekStart, tz);
  const range = gridRange([...sessions, ...timeOff], tz);

  return (
    <>
      <PageHeader
        title="Planning"
        description="Vos séances et rendez-vous de la semaine."
      />
      <PlanningCalendar
        tz={tz}
        days={days.map((d) => d.toISOString())}
        startHour={range.startHour}
        endHour={range.endHour}
        sessions={sessions.map((s) => ({
          id: s.id,
          startAt: s.startAt.toISOString(),
          endAt: s.endAt.toISOString(),
          capacity: s.capacity,
          seatsRemaining: s.seatsRemaining,
          eventTitle: s.eventTitle,
          eventColor: s.eventColor,
          attendees: s.attendees,
        }))}
        timeOff={timeOff.map((t) => ({
          id: t.id,
          startAt: t.startAt.toISOString(),
          endAt: t.endAt.toISOString(),
          reason: t.reason,
        }))}
        eventTypes={eventTypes
          .filter((e) => e.isActive)
          .map((e) => ({ id: e.id, title: e.title }))}
        todayKey={dayKeyInTz(new Date(), tz)}
        nav={{
          prevParam: adjacentWeekParam(weekStart, tz, -1),
          nextParam: adjacentWeekParam(weekStart, tz, 1),
          todayParam: paramForWeek(weekStartFromParam(undefined, tz, new Date()), tz),
        }}
      />
    </>
  );
}
