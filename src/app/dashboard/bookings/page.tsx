import type { Metadata } from "next";

import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatSlot } from "@/lib/datetime";
import { formatMoney } from "@/lib/utils";
import { getCurrentProfessional } from "@/lib/session";
import { getProBookings } from "@/server/queries";

export const metadata: Metadata = { title: "Réservations" };

const STATUS_LABEL: Record<string, string> = {
  pending: "En attente",
  confirmed: "Confirmé",
  cancelled: "Annulé",
  completed: "Terminé",
};

const PAYMENT_LABEL: Record<string, string> = {
  direct: "Payé",
  credit: "Crédit",
  free: "Offert",
};

export default async function BookingsPage() {
  const pro = (await getCurrentProfessional())!;
  const rows = await getProBookings(pro.id);
  const now = new Date().getTime();
  const upcoming = rows.filter((r) => r.startAt.getTime() >= now);
  const past = rows.filter((r) => r.startAt.getTime() < now);

  return (
    <>
      <PageHeader
        title="Réservations"
        description="Toutes les réservations de vos clients."
      />

      <Section title="À venir" rows={upcoming} tz={pro.timezone} empty="Aucune réservation à venir." />
      <div className="mt-8">
        <Section title="Passées" rows={past} tz={pro.timezone} empty="Aucune réservation passée." />
      </div>
    </>
  );
}

function Section({
  title,
  rows,
  tz,
  empty,
}: {
  title: string;
  rows: Awaited<ReturnType<typeof getProBookings>>;
  tz: string;
  empty: string;
}) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title} · {rows.length}
      </h2>
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {empty}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((b) => (
            <Card key={b.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: b.eventColor }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {b.eventTitle} · {b.customerName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatSlot(b.startAt, b.endAt, tz)} · {b.customerEmail}
                  </p>
                  {b.notes && (
                    <p className="mt-1 truncate text-xs italic text-muted-foreground">
                      “{b.notes}”
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="neutral">
                    {PAYMENT_LABEL[b.paymentType]}
                    {b.paymentType === "direct" && b.amountPaidCents
                      ? ` · ${formatMoney(b.amountPaidCents)}`
                      : ""}
                  </Badge>
                  <Badge
                    variant={
                      b.status === "confirmed"
                        ? "success"
                        : b.status === "completed"
                          ? "default"
                          : b.status === "cancelled"
                            ? "warning"
                            : "neutral"
                    }
                  >
                    {STATUS_LABEL[b.status]}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
