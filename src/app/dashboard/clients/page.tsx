import type { Metadata } from "next";

import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = { title: "Clients" };

export default function ClientsPage() {
  return (
    <>
      <PageHeader title="Clients" />
      <ComingSoon
        title="Bientôt disponible"
        description="La liste des clients et leurs portefeuilles de tickets reviennent bientôt."
      />
    </>
  );
}
