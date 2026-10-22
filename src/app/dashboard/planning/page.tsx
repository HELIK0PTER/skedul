import type { Metadata } from "next";
import { after } from "next/server";

import { PageHeader } from "@/components/dashboard/page-header";
import { PlanningCalendar } from "@/components/dashboard/planning-calendar";
import { ensureHorizon } from "@/lib/booking/occurrences";
import { db } from "@/lib/db";
import { logSafeMessage } from "@/lib/log-safe";
import { requireProfessional } from "@/server/pro-context";
import { getPlanningPage } from "@/server/planning-queries";

export const metadata: Metadata = { title: "Planning" };

/**
 * `?semaine=YYYY-MM-DD` (any day of the week; `?week=` is accepted as an alias)
 * picks the week, `?seance=<occurrenceId>` opens that séance's dialog (an
 * unknown id is ignored by the calendar). Rendering never writes: when a
 * series is generated less than a few weeks ahead, ensureHorizon runs after
 * the response.
 */
export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ semaine?: string; week?: string; seance?: string }>;
}) {
  const sp = await searchParams;
  const pro = await requireProfessional();
  const data = await getPlanningPage({ id: pro.id, timezone: pro.timezone }, sp.semaine ?? sp.week);
  if (data.needsHorizon) {
    after(async () => {
      try {
        await ensureHorizon(db, pro.id);
      } catch (err) {
        console.error(`[planning] ensureHorizon failed: ${logSafeMessage(err)}`);
      }
    });
  }

  return (
    <>
      <PageHeader title="Planning" description="Vos séances, rendez-vous et indisponibilités de la semaine." />
      {data.horizonNotice && <p className="mb-3 text-sm text-zinc-600">{data.horizonNotice}</p>}
      <PlanningCalendar
        tz={data.tz}
        days={data.days}
        todayKey={data.todayKey}
        title={data.title}
        startHour={data.startHour}
        endHour={data.endHour}
        items={data.items}
        timeOff={data.timeOff}
        nav={data.nav}
        openOccurrenceId={sp.seance ?? null}
        nowIso={data.nowIso}
      />
    </>
  );
}
