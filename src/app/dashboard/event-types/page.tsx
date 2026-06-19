import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import {
  EventTypesManager,
  type EventTypeItem,
} from "@/components/dashboard/event-types-manager";
import { getCurrentProfessional } from "@/lib/session";
import { getProEventTypes } from "@/server/queries";

export const metadata: Metadata = { title: "Prestations" };

export default async function EventTypesPage() {
  const pro = (await getCurrentProfessional())!;
  const rows = await getProEventTypes(pro.id);

  const items: EventTypeItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    durationMinutes: r.durationMinutes,
    priceCents: r.priceCents,
    color: r.color,
    bufferBeforeMinutes: r.bufferBeforeMinutes,
    bufferAfterMinutes: r.bufferAfterMinutes,
    isActive: r.isActive,
  }));

  return (
    <>
      <PageHeader
        title="Prestations"
        description="Les types de rendez-vous que vos clients peuvent réserver."
      />
      <EventTypesManager items={items} />
    </>
  );
}
