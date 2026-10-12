import type { Metadata } from "next";

import { FilterChips } from "@/components/admin/filter-chips";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card } from "@/components/ui/card";
import { formatDateShort, formatDateTimeShort } from "@/lib/datetime";
import { getCurrentProfessional } from "@/lib/session";
import { formatMoney } from "@/lib/utils";
import { getProPayments } from "@/server/queries";

export const metadata: Metadata = { title: "Paiements" };

type PaymentFilter = "all" | "booking" | "pack";

const FILTERS: readonly PaymentFilter[] = ["all", "booking", "pack"];

const EMPTY: Record<PaymentFilter, string> = {
  all: "Pas encore de paiement. Ils apparaîtront ici dès qu'un client paiera une réservation ou un pack.",
  booking: "Aucune réservation payée pour le moment.",
  pack: "Aucun pack vendu pour le moment.",
};

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const pro = (await getCurrentProfessional())!;
  const params = await searchParams;
  const filter: PaymentFilter = FILTERS.find((f) => f === params.filter) ?? "all";

  const payments = await getProPayments(pro.id);
  const ofKind = (f: PaymentFilter) =>
    f === "all" ? payments : payments.filter((p) => p.kind === f);
  const rows = ofKind(filter);
  const total = rows.reduce((n, p) => n + p.amountCents, 0);
  const hrefFor = (f: PaymentFilter) =>
    f === "all" ? "/dashboard/payments" : `/dashboard/payments?filter=${f}`;

  return (
    <>
      <PageHeader
        title="Paiements"
        description="Les réservations payées et les packs achetés sur votre page."
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          label="Filtrer les paiements"
          active={filter}
          options={[
            { value: "all", label: `Tous (${payments.length})`, href: hrefFor("all") },
            {
              value: "booking",
              label: `Réservations (${ofKind("booking").length})`,
              href: hrefFor("booking"),
            },
            {
              value: "pack",
              label: `Packs (${ofKind("pack").length})`,
              href: hrefFor("pack"),
            },
          ]}
        />
        <p className="text-sm text-muted-foreground">
          Total{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {formatMoney(total, pro.currency)}
          </span>
        </p>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {EMPTY[filter]}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Client</th>
                  <th className="px-4 py-2.5 font-medium">Objet</th>
                  <th className="px-4 py-2.5 text-right font-medium">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((p) => (
                  <tr key={`${p.kind}-${p.id}`} className="align-top hover:bg-muted/40">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatDateShort(p.at, pro.timezone)}
                    </td>
                    <td className="px-4 py-3">
                      {p.customerName ? (
                        <p className="font-medium">{p.customerName}</p>
                      ) : (
                        <p className="text-muted-foreground">Sans nom</p>
                      )}
                      {p.customerEmail && (
                        <a
                          href={`mailto:${p.customerEmail}`}
                          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                        >
                          {p.customerEmail}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p>{p.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.kind === "pack"
                          ? `Pack de ${p.credits} crédit${p.credits > 1 ? "s" : ""}`
                          : `Réservation, RDV le ${formatDateTimeShort(p.startAt, pro.timezone)}`}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">
                      {formatMoney(p.amountCents, pro.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
