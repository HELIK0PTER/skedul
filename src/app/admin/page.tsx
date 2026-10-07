import type { Metadata } from "next";
import { CalendarCheck, Euro, Eye, Store, Users } from "lucide-react";

import { ActivityFeed } from "@/components/admin/activity-feed";
import { AppHealthCard } from "@/components/admin/app-health-card";
import { BarChart } from "@/components/admin/bar-chart";
import { StatCard } from "@/components/admin/stat-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";
import {
  dayLabel,
  fillDailySeries,
  lastDayKeys,
  startOfDayKey,
} from "@/lib/admin-metrics";
import { formatMoney } from "@/lib/utils";
import {
  getAppHealth,
  getDailySignups,
  getDailyTraffic,
  getOverviewStats,
  getRecentActivity,
} from "@/server/admin-queries";

// `absolute`: the layout's title.template does not apply to a page in the
// layout's own segment, so spell the full title out here.
export const metadata: Metadata = {
  title: { absolute: "Vue d'ensemble · Admin · Skedul" },
};

const fmt = (n: number) => n.toLocaleString("fr-FR");

export default async function AdminOverviewPage() {
  await requireAdmin();
  const now = new Date();
  const keys = lastDayKeys(30, now);
  const since = startOfDayKey(keys[0]);

  // Measured alone, before the other queries: run in parallel with them, the
  // `select 1` would queue behind them and overstate the DB latency.
  const health = await getAppHealth(now);
  const [stats, signupRows, trafficRows, activity] = await Promise.all([
    getOverviewStats(now),
    getDailySignups(since),
    getDailyTraffic(since),
    getRecentActivity(10),
  ]);

  const signups = fillDailySeries(signupRows, keys);
  const visitors = fillDailySeries(
    trafficRows.map((r) => ({ day: r.day, value: r.visitors })),
    keys,
  );
  const views = fillDailySeries(
    trafficRows.map((r) => ({ day: r.day, value: r.views })),
    keys,
  );
  const visitors7d = visitors.slice(-7).reduce((sum, d) => sum + d.value, 0);
  const [mainRevenue, ...otherRevenue] = stats.revenue30d;

  return (
    <>
      <PageHeader
        title="Vue d'ensemble"
        description="L'activité de Skedul, toutes pages pro confondues."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          icon={Users}
          label="Utilisateurs"
          value={fmt(stats.users)}
          hint={`+${fmt(stats.newUsers7d)} sur 7 jours`}
        />
        <StatCard
          icon={Store}
          label="Pros"
          value={fmt(stats.pros)}
          hint={`${fmt(stats.activePros30d)} actifs sur 30 jours`}
        />
        <StatCard
          icon={CalendarCheck}
          label="Réservations (30 j)"
          value={fmt(stats.bookings30d)}
        />
        <StatCard
          icon={Euro}
          label="Volume encaissé (30 j)"
          value={
            mainRevenue
              ? formatMoney(mainRevenue.cents, mainRevenue.currency)
              : formatMoney(0)
          }
          hint={
            otherRevenue.length
              ? `+ ${otherRevenue.map((r) => formatMoney(r.cents, r.currency)).join(" · ")}`
              : undefined
          }
        />
        <StatCard icon={Eye} label="Visiteurs (7 j)" value={fmt(visitors7d)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Inscriptions par jour</CardTitle>
            <p className="text-sm text-muted-foreground">30 derniers jours</p>
          </CardHeader>
          <CardContent>
            <BarChart
              unit={{ one: "inscription", other: "inscriptions" }}
              data={signups.map((d) => ({
                key: d.day,
                label: dayLabel(d.day),
                value: d.value,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Visiteurs par jour</CardTitle>
            <p className="text-sm text-muted-foreground">
              30 derniers jours · pages publiques
            </p>
          </CardHeader>
          <CardContent>
            <BarChart
              unit={{ one: "visiteur", other: "visiteurs" }}
              data={visitors.map((d, i) => ({
                key: d.day,
                label: dayLabel(d.day),
                value: d.value,
                detail: `${fmt(views[i].value)} pages vues`,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Activité récente</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityFeed events={activity} now={now} />
          </CardContent>
        </Card>
        <AppHealthCard health={health} />
      </div>
    </>
  );
}
