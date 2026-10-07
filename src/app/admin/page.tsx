import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import { requireAdmin } from "@/lib/admin";

export const metadata: Metadata = { title: "Vue d'ensemble" };

export default async function AdminOverviewPage() {
  await requireAdmin();
  return (
    <PageHeader
      title="Vue d'ensemble"
      description="L'activité de Skedul, toutes pages pro confondues."
    />
  );
}
