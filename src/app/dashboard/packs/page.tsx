import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

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
      <Link
        href="/dashboard/event-types"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Prestations
      </Link>
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
