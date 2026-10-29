import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ClientPurchaseRow } from "@/lib/back-office/client-reads";
import { plural } from "@/lib/back-office/format";
import { formatDateShort } from "@/lib/datetime";
import { PURCHASE_STATUS_LABELS, type PurchaseStatus } from "@/lib/tickets-vocab";
import { formatMoney } from "@/lib/utils";

/** A purchase whose Checkout ended unpaid is « Expiré » (neutral), never « En attente » (warning). */
const STATUS_VARIANT: Record<PurchaseStatus, "success" | "warning" | "neutral"> = {
  paid: "success",
  pending: "warning",
  expired: "neutral",
};

/** « Achats »: the client's purchases, newest first; a « Test » badge marks payments made in test mode. */
export function ClientPurchases({ purchases, tz }: { purchases: ClientPurchaseRow[]; tz: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Achats</CardTitle>
      </CardHeader>
      <CardContent>
        {purchases.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-600">Aucun achat.</p>
        ) : (
          <ul className="divide-y divide-border">
            {purchases.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium wrap-anywhere">{p.label}</p>
                  <p className="text-xs text-zinc-600">
                    {`${formatDateShort(p.paidAt ?? p.createdAt, tz)} · ${plural(p.quantity, "ticket", "tickets")}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-medium">{formatMoney(p.amountCents, p.currency)}</span>
                  <span className="flex gap-1">
                    <Badge variant={STATUS_VARIANT[p.status]}>{PURCHASE_STATUS_LABELS[p.status]}</Badge>
                    {!p.livemode && <Badge variant="outline">Test</Badge>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
