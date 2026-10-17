import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { EventCreateForm } from "@/components/dashboard/event-editor";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { defaultEventStart, parseClickedCell } from "@/lib/back-office/event-defaults";
import { todayKey } from "@/lib/civil-date";
import { getActiveTypeOptions } from "@/server/catalog-queries";
import { requireProfessional } from "@/server/pro-context";

export const metadata: Metadata = { title: "Nouvel événement" };

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[]; minute?: string | string[] }>;
}) {
  const pro = await requireProfessional();
  const sp = await searchParams;
  const now = new Date();
  const initialStart = defaultEventStart({
    now,
    tz: pro.timezone,
    clicked: parseClickedCell(sp),
  });
  const typeOptions = (await getActiveTypeOptions(pro.id)).filter((t) => !t.rdvFree);

  return (
    <>
      <PageHeader
        title="Nouvel événement"
        description="Un cours ponctuel ou récurrent. Vous pourrez tout modifier ensuite."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/events">
              <ArrowLeft />
              Tous les événements
            </Link>
          </Button>
        }
      />
      <EventCreateForm
        tz={pro.timezone}
        nowIso={now.toISOString()}
        todayKey={todayKey(now, pro.timezone)}
        initialStart={initialStart}
        typeOptions={typeOptions}
        proWindow={{
          bookingHorizonDays: pro.bookingHorizonDays,
          minNoticeMinutes: pro.minNoticeMinutes,
          cancelDeadlineHours: pro.cancelDeadlineHours,
        }}
      />
    </>
  );
}
