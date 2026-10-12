import Link from "next/link";
import {
  CalendarClock,
  Copy,
  Euro,
  Ticket,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { CopyLinkButton } from "@/components/dashboard/copy-link-button";
import { UpcomingBookings } from "@/components/dashboard/upcoming-bookings";
import { WeekPreview } from "@/components/dashboard/week-preview";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { dayKeyInTz } from "@/lib/datetime";
import { env } from "@/lib/env";
import { getCurrentProfessional } from "@/lib/session";
import { getProDashboardData, getProPlanningWeek } from "@/server/queries";
import {
  gridRange,
  paramForWeek,
  weekBounds,
  weekDays,
  weekStartFromParam,
} from "@/lib/planning";

export default async function DashboardPage() {
  const pro = (await getCurrentProfessional())!;
  const tz = pro.timezone;
  const weekStart = weekStartFromParam(undefined, tz, new Date());
  const { start, end } = weekBounds(weekStart);

  const [data, { sessions, timeOff }] = await Promise.all([
    getProDashboardData(pro.id),
    getProPlanningWeek(pro.id, start, end),
  ]);

  const days = weekDays(weekStart);
  const range = gridRange([...sessions, ...timeOff], tz);
  const publicUrl = `${env.APP_URL}/${pro.slug}`;

  const stats = [
    {
      label: "RDV à venir",
      value: String(data.upcomingCount),
      icon: CalendarClock,
      href: "/dashboard/planning",
    },
    {
      label: "Crédits actifs",
      value: String(data.creditsLeft),
      icon: Ticket,
      href: "/dashboard/clients?filter=credits",
    },
    {
      label: "Clients",
      value: String(data.customersCount),
      icon: Users,
      href: "/dashboard/clients",
    },
    {
      label: "Encaissé",
      value: formatMoney(data.revenueCents, pro.currency),
      icon: Euro,
      href: "/dashboard/payments",
    },
  ];

  return (
    <>
      <PageHeader
        title={`Bonjour 👋`}
        description="Voici l'activité de votre page de réservation."
      />

      {/* Public link */}
      <Card className="mb-6 bg-accent">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-accent-foreground">
              Votre page publique
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {publicUrl}
            </p>
          </div>
          <div className="flex gap-2">
            <CopyLinkButton url={publicUrl} />
            <Button asChild size="sm">
              <Link href={`/${pro.slug}`} target="_blank">
                Ouvrir
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <Card className="h-full transition-colors group-hover:border-primary/40">
              <CardContent className="p-5">
                <s.icon className="size-5 text-primary" />
                <p className="mt-3 text-2xl font-bold tracking-tight">
                  {s.value}
                </p>
                <p className="text-sm text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Week-at-a-glance calendar */}
      <div className="mt-6">
        <WeekPreview
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
          weekParam={paramForWeek(weekStart, tz)}
          todayKey={dayKeyInTz(new Date(), tz)}
        />
      </div>

      <UpcomingBookings
        tz={tz}
        currency={pro.currency}
        bookings={data.upcoming.map((b) => ({
          ...b,
          startAt: b.startAt.toISOString(),
          endAt: b.endAt.toISOString(),
          planningHref: `/dashboard/planning?week=${paramForWeek(
            weekStartFromParam(undefined, tz, b.startAt),
            tz,
          )}`,
        }))}
      />

      <p className="mt-6 text-center text-xs text-muted-foreground">
        <Copy className="mr-1 inline size-3" />
        Astuce : partagez votre page publique pour recevoir des réservations.
      </p>
    </>
  );
}
