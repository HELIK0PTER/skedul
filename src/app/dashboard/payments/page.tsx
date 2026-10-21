import type { Metadata } from "next";
import Link from "next/link";
import { Euro } from "lucide-react";

import { FilterChips } from "@/components/admin/filter-chips";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { PaymentsTable } from "@/components/dashboard/payments-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { revenueDisplay } from "@/lib/back-office/dashboard-view";
import { formatCount } from "@/lib/back-office/format";
import {
  PAYMENTS_LIMIT,
  PAYMENTS_PERIODS,
  parsePaymentsPeriod,
  type PaymentsPeriod,
} from "@/lib/back-office/payments-reads";
import { requireProfessional } from "@/server/pro-context";
import { getPaymentsPage } from "@/server/queries";
import { revenueLive } from "@/server/revenue";

export const metadata: Metadata = { title: "Paiements" };

const PAYMENTS_HREF = "/dashboard/payments";

const PERIOD_LABELS: Record<PaymentsPeriod, string> = { tout: "Tout", "30j": "30 derniers jours" };

const PERIOD_OPTIONS = PAYMENTS_PERIODS.map((value) => ({
  value,
  label: PERIOD_LABELS[value],
  href: value === "tout" ? PAYMENTS_HREF : `${PAYMENTS_HREF}?periode=${value}`,
}));

const REFUND_NOTE = "Les tickets clos « Remboursé hors Skedul » ne diminuent pas l'encaissé.";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string | string[] }>;
}) {
  const pro = await requireProfessional();
  const { periode } = await searchParams;
  const period = parsePaymentsPeriod(periode);
  const { rows, totals } = await getPaymentsPage(pro, period);
  const { main, others } = revenueDisplay(totals, pro.currency);
  const live = revenueLive();
  const hasRefundNote = rows.some((row) => row.closedNotes.some((c) => c.reason === "rembourse"));
  // The list stops at PAYMENTS_LIMIT rows while « Encaissé » counts every payment of the period.
  const capped = rows.length >= PAYMENTS_LIMIT;

  return (
    <>
      <PageHeader title="Paiements" description="Les achats de tickets payés par vos clients." />
      <div className="mb-6">
        <FilterChips label="Période" active={period} options={PERIOD_OPTIONS} />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Encaissé</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold tracking-tight wrap-anywhere">{main}</p>
          {others.length > 0 && <p className="mt-1 text-sm text-zinc-600 wrap-anywhere">{others.join(" · ")}</p>}
          <p className="mt-3 text-xs text-zinc-600">
            {live ? "Seuls les paiements réels comptent." : "Paiements de test : ces montants ne sont pas réels."}
          </p>
          {hasRefundNote && <p className="mt-1 text-xs text-zinc-600">{REFUND_NOTE}</p>}
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        period === "tout" ? (
          <EmptyState
            icon={Euro}
            title="Aucun paiement pour le moment"
            description="Les achats de tickets de vos clients apparaîtront ici."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/dashboard/tickets">Voir mes tickets</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Euro}
            title="Aucun paiement sur cette période"
            description="Choisissez « Tout » pour voir l'ensemble de vos paiements."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href={PAYMENTS_HREF}>Voir tous les paiements</Link>
              </Button>
            }
          />
        )
      ) : (
        <>
          <PaymentsTable rows={rows} tz={pro.timezone} now={new Date()} />
          {capped && (
            <p className="mt-3 text-sm text-zinc-600">
              {`Les ${formatCount(PAYMENTS_LIMIT)} paiements les plus récents sont affichés. L'encaissé compte tous les paiements de la période.`}
            </p>
          )}
        </>
      )}
    </>
  );
}
