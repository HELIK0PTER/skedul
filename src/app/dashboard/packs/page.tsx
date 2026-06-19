import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import {
  PacksManager,
  type PackItem,
} from "@/components/dashboard/packs-manager";
import { getCurrentProfessional } from "@/lib/session";
import { getProEventTypes, getProPacks } from "@/server/queries";

export const metadata: Metadata = { title: "Packs" };

export default async function PacksPage() {
  const pro = (await getCurrentProfessional())!;
  const [packs, eventTypes] = await Promise.all([
    getProPacks(pro.id),
    getProEventTypes(pro.id),
  ]);

  const items: PackItem[] = packs.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    credits: p.credits,
    priceCents: p.priceCents,
    eventTypeId: p.eventTypeId,
    eventTitle: p.eventTitle,
    isActive: p.isActive,
    sold: Number(p.sold),
  }));

  return (
    <>
      <PageHeader
        title="Packs prépayés"
        description="Vendez des lots de crédits que vos clients utilisent pour réserver."
      />
      <PacksManager
        items={items}
        eventTypes={eventTypes.map((e) => ({ id: e.id, title: e.title }))}
      />
    </>
  );
}
