import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import { AvailabilityEditor } from "@/components/dashboard/availability-editor";
import { getCurrentProfessional } from "@/lib/session";
import { getProAvailability } from "@/server/queries";

export const metadata: Metadata = { title: "Disponibilités" };

export default async function AvailabilityPage() {
  const pro = (await getCurrentProfessional())!;
  const rules = await getProAvailability(pro.id);

  return (
    <>
      <PageHeader
        title="Disponibilités"
        description={`Vos horaires récurrents (fuseau ${pro.timezone}).`}
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
