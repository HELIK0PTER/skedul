import type { Metadata } from "next";

import { ComingSoon } from "@/components/coming-soon";
import { PageHeader } from "@/components/dashboard/page-header";

export const metadata: Metadata = { title: "Planning" };

export default function PlanningPage() {
  return (
    <>
      <PageHeader
        title="Planning"
        description="Vos séances et rendez-vous de la semaine."
      />
      <ComingSoon
        title="Bientôt disponible"
        description="Le planning revient avec les séances et les rendez-vous."
      />
    </>
  );
}
