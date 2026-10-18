import type { Metadata } from "next";

import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireAdmin } from "@/lib/admin";

export const metadata: Metadata = { title: "Activité" };

export default async function AdminActivityPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="Activité" />
      <ComingSoon
        title="Bientôt disponible"
        description="Les inscriptions et les achats de tickets s'afficheront ici."
      />
    </>
  );
}
