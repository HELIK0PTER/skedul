import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";

import { AlertsCard } from "@/components/dashboard/alerts-card";
import { CopyLinkButton } from "@/components/dashboard/copy-link-button";
import { GettingStarted } from "@/components/dashboard/getting-started";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { PageHeader } from "@/components/dashboard/page-header";
import { UpcomingBookings } from "@/components/dashboard/upcoming-bookings";
import { WeekPreview } from "@/components/dashboard/week-preview";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { dashboardAlerts, gettingStartedSteps, kpiTiles } from "@/lib/back-office/dashboard-view";
import { ensureHorizon } from "@/lib/booking/occurrences";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logSafeMessage } from "@/lib/log-safe";
import { getPlanningPage } from "@/server/planning-queries";
import { requireProfessional } from "@/server/pro-context";
import { getDashboardPage } from "@/server/queries";

export const metadata: Metadata = { title: "Vue d'ensemble" };

export default async function DashboardPage() {
  const pro = await requireProfessional();
  const [data, planning] = await Promise.all([getDashboardPage(pro), getPlanningPage(pro, undefined)]);
  // Rendering never writes: when a series is generated less than a few weeks ahead, ensureHorizon runs after the response.
  if (planning.needsHorizon) {
    after(async () => {
      try {
        await ensureHorizon(db, pro.id);
      } catch (err) {
        console.error(`[dashboard] ensureHorizon failed: ${logSafeMessage(err)}`);
      }
    });
  }
  const publicUrl = `${env.APP_URL}/${pro.slug}`;
  const steps = gettingStartedSteps(data.gettingStarted);

  return (
    <>
      <PageHeader title="Bonjour" description="Voici l'activité de votre page de réservation." />

      {steps && <GettingStarted steps={steps} />}

      <div className="mb-6">
        <KpiGrid tiles={kpiTiles(data.kpis)} />
      </div>

      <AlertsCard alerts={dashboardAlerts(data.alerts)} />

      {/* Public link */}
      <Card className="mb-6 bg-accent">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-accent-foreground">Votre page publique</p>
            <p className="truncate text-sm text-zinc-600">{publicUrl}</p>
          </div>
          <div className="flex gap-2">
            <CopyLinkButton url={publicUrl} />
            <Button asChild size="sm">
              <Link href={`/${pro.slug}`} target="_blank" rel="noopener noreferrer">
                Ouvrir
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <WeekPreview
        tz={planning.tz}
        days={planning.days}
        todayKey={planning.todayKey}
        items={planning.items}
        timeOff={planning.timeOff}
        startHour={planning.startHour}
        endHour={planning.endHour}
        weekParam={planning.days[0]}
        nowIso={planning.nowIso}
      />

      <UpcomingBookings bookings={data.upcomingBookings} />
    </>
  );
}
