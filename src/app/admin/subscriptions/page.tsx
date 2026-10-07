import type { Metadata } from "next";
import { CreditCard } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";

export const metadata: Metadata = { title: "Abonnements" };

export default async function AdminSubscriptionsPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="Abonnements" description="Les plans payants des pros." />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary-muted text-accent-foreground">
            <CreditCard className="size-6" aria-hidden />
          </span>
          <h2 className="text-base font-semibold">
            La facturation des pros n&apos;est pas encore en place
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Skedul est gratuit pour les pros aujourd&apos;hui. Quand les plans
            payants arriveront, cette page affichera les plans, les abonnés
            actifs, le revenu mensuel récurrent (MRR) et les résiliations.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
