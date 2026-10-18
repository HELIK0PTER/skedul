import type { Metadata } from "next";

import { AvailabilityEditor } from "@/components/dashboard/availability-editor";
import { PageHeader } from "@/components/dashboard/page-header";
import { timeZoneLabel } from "@/lib/timezones";
import { requireProfessional } from "@/server/pro-context";
import { getProAvailability } from "@/server/queries";

export const metadata: Metadata = { title: "Disponibilités (RDV libre)" };

export default async function AvailabilityPage() {
  const pro = await requireProfessional();
  const rules = await getProAvailability(pro.id);

  return (
    <>
      <PageHeader
        title="Disponibilités (RDV libre)"
        description={`Vos horaires pour les rendez-vous libres (fuseau ${timeZoneLabel(pro.timezone)}). Un type de ticket peut avoir ses propres horaires.`}
      />
      <AvailabilityEditor
        initial={rules.map((r) => ({
          dayOfWeek: r.dayOfWeek,
          startMinute: r.startMinute,
          endMinute: r.endMinute,
        }))}
      />
    </>
  );
}
