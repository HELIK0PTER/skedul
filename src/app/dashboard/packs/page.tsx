import type { Metadata } from "next";

import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = { title: "Tickets" };

export default function TicketsComingSoonPage() {
  return (
    <>
      <PageHeader title="Tickets" />
      <ComingSoon
        title="Bientôt disponible"
        description="Les prestations et les packs deviennent des types de ticket et des offres. Cette page revient bientôt."
      />
    </>
  );
}
