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
import { WeekPreview } from "@/components/dashboard/week-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { dayKeyInTz, formatSlot } from "@/lib/datetime";
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
    },
    {
      label: "Crédits actifs",
      value: String(data.creditsLeft),
      icon: Ticket,
    },
    { label: "Clients", value: String(data.customersCount), icon: Users },
    {
      label: "Encaissé",
      value: formatMoney(data.revenueCents, pro.currency),
      icon: Euro,
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
          <Card key={s.label}>
            <CardContent className="p-5">
              <s.icon className="size-5 text-primary" />
              <p className="mt-3 text-2xl font-bold tracking-tight">
                {s.value}
              </p>
              <p className="text-sm text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
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

      {/* Upcoming bookings */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Prochaines réservations</CardTitle>
        </CardHeader>
        <CardContent>
          {data.upcoming.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Aucune réservation à venir pour le moment.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.upcoming.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: b.eventColor }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {b.eventTitle} · {b.customerName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatSlot(b.startAt, b.endAt, pro.timezone)}
                    </p>
                  </div>
                  <Badge
                    variant={b.paymentType === "credit" ? "default" : "neutral"}
                  >
                    {b.paymentType === "credit"
                      ? "Crédit"
                      : b.paymentType === "free"
                        ? "Offert"
                        : "Payé"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        <Copy className="mr-1 inline size-3" />
        Astuce : partagez votre page publique pour recevoir des réservations.
      </p>
    </>
  );
}
