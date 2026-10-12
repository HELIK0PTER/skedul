import type { Metadata } from "next";

import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = { title: "Paiements" };

export default function PaymentsPage() {
  return (
    <>
      <PageHeader title="Paiements" />
      <ComingSoon
        title="Bientôt disponible"
        description="Les paiements reviennent avec les achats de tickets."
      />
    </>
  );
}
