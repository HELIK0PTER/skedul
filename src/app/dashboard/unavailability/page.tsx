import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import {
  UnavailabilityManager,
  type TimeOffEntry,
} from "@/components/dashboard/unavailability-manager";
import { getCurrentProfessional } from "@/lib/session";
import { getProTimeOff } from "@/server/queries";
import { coveredDayKeys } from "@/lib/timeoff";
import { dayKeyInTz, formatDateLong, formatTime } from "@/lib/datetime";

export const metadata: Metadata = { title: "Indisponibilités" };

export default async function UnavailabilityPage() {
  const pro = (await getCurrentProfessional())!;
  const tz = pro.timezone;
  const rows = await getProTimeOff(pro.id);

  const markedDays = [
    ...new Set(rows.flatMap((r) => coveredDayKeys(r.startAt, r.endAt, tz))),
  ];

  const entries: TimeOffEntry[] = rows.map((r) => {
    let label: string;
    if (r.allDay) {
      const last = new Date(r.endAt.getTime() - 1); // exclusive end → inclusive last day
      const startKey = dayKeyInTz(r.startAt, tz);
      const lastKey = dayKeyInTz(last, tz);
      label =
        startKey === lastKey
          ? formatDateLong(r.startAt, tz)
          : `${formatDateLong(r.startAt, tz)} → ${formatDateLong(last, tz)}`;
    } else {
      label = `${formatDateLong(r.startAt, tz)} · ${formatTime(
        r.startAt,
        tz,
      )} – ${formatTime(r.endAt, tz)}`;
    }
    return { id: r.id, label, allDay: r.allDay, reason: r.reason };
  });

  return (
    <>
      <PageHeader
        title="Indisponibilités"
        description={`Bloquez des journées ou des plages horaires (fuseau ${tz}). Ces créneaux n'apparaîtront pas pour vos clients.`}
      />
      <UnavailabilityManager markedDays={markedDays} entries={entries} />
    </>
  );
}
