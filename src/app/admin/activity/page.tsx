import type { Metadata } from "next";
import Link from "next/link";

import { FilterChips } from "@/components/admin/filter-chips";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_TYPE_LABELS,
  PURCHASE_STATUS_LABELS,
  parseActivityTab,
  parseBookingStatus,
  parsePurchaseStatus,
  type ActivityTab,
  type BookingStatus,
  type PurchaseStatus,
} from "@/lib/admin-params";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateTimeShort, formatSlot } from "@/lib/datetime";
import { formatMoney } from "@/lib/utils";
import {
  ACTIVITY_LIMIT,
  listRecentBookings,
  listRecentPurchases,
} from "@/server/admin-queries";

export const metadata: Metadata = { title: "Activité" };

const BOOKING_VARIANT: Record<BookingStatus, "success" | "warning" | "neutral"> = {
  pending: "warning",
  confirmed: "success",
  completed: "success",
  cancelled: "neutral",
};
const PURCHASE_VARIANT: Record<PurchaseStatus, "success" | "warning" | "neutral"> = {
  pending: "warning",
  paid: "success",
  refunded: "neutral",
};

const th = "px-4 py-2.5 font-medium";
const td = "px-4 py-3";

function Empty() {
  return (
    <p className="p-10 text-center text-sm text-muted-foreground">
      Aucune opération pour ce filtre.
    </p>
  );
}

function ProLink({ userId, name }: { userId: string; name: string }) {
  return (
    <Link href={`/admin/users/${userId}`} className="font-medium hover:underline">
      {name}
    </Link>
  );
}

async function BookingsTable({ status }: { status: BookingStatus | null }) {
  const rows = await listRecentBookings(status);
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className={th}>Créée le</th>
            <th className={th}>Pro</th>
            <th className={th}>Client</th>
            <th className={th}>Prestation</th>
            <th className={th}>Créneau</th>
            <th className={th}>Paiement</th>
            <th className={`${th} text-right`}>Montant</th>
            <th className={th}>Statut</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/40">
              <td className={`${td} whitespace-nowrap text-muted-foreground`}>
                {formatDateTimeShort(r.createdAt, ADMIN_TZ)}
              </td>
              <td className={td}>
                <ProLink userId={r.proUserId} name={r.businessName} />
              </td>
              <td className={td}>
                {r.customerName}
                <p className="text-xs text-muted-foreground">{r.customerEmail}</p>
              </td>
              <td className={td}>{r.eventTitle}</td>
              <td className={`${td} whitespace-nowrap text-muted-foreground`}>
                {formatSlot(r.startAt, r.endAt, r.timezone)}
              </td>
              <td className={td}>{PAYMENT_TYPE_LABELS[r.paymentType]}</td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                {r.amountCents ? formatMoney(r.amountCents, r.currency) : "—"}
              </td>
              <td className={td}>
                <Badge variant={BOOKING_VARIANT[r.status]}>
                  {BOOKING_STATUS_LABELS[r.status]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function PurchasesTable({ status }: { status: PurchaseStatus | null }) {
  const rows = await listRecentPurchases(status);
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className={th}>Créé le</th>
            <th className={th}>Pro</th>
            <th className={th}>Client</th>
            <th className={th}>Pack</th>
            <th className={th}>Crédits restants</th>
            <th className={`${th} text-right`}>Montant</th>
            <th className={th}>Statut</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/40">
              <td className={`${td} whitespace-nowrap text-muted-foreground`}>
                {formatDateTimeShort(r.createdAt, ADMIN_TZ)}
              </td>
              <td className={td}>
                <ProLink userId={r.proUserId} name={r.businessName} />
              </td>
              <td className={td}>
                {r.customerName}
                <p className="text-xs text-muted-foreground">{r.customerEmail}</p>
              </td>
              <td className={td}>{r.packName}</td>
              <td className={`${td} tabular-nums`}>
                {r.creditsRemaining} / {r.creditsTotal}
              </td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                {formatMoney(r.amountCents, r.currency)}
              </td>
              <td className={td}>
                <Badge variant={PURCHASE_VARIANT[r.status]}>
                  {PURCHASE_STATUS_LABELS[r.status]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const tab = parseActivityTab(params.tab);
  const bookingStatus = tab === "bookings" ? parseBookingStatus(params.status) : null;
  const purchaseStatus = tab === "purchases" ? parsePurchaseStatus(params.status) : null;
  const status: string | null = bookingStatus ?? purchaseStatus;

  const href = (next: { tab?: ActivityTab; status?: string | null }) => {
    const sp = new URLSearchParams();
    const t = next.tab ?? tab;
    if (t !== "bookings") sp.set("tab", t);
    const s = next.status === undefined ? status : next.status;
    if (s) sp.set("status", s);
    const qs = sp.toString();
    return qs ? `/admin/activity?${qs}` : "/admin/activity";
  };

  const statusLabels: Record<string, string> =
    tab === "bookings" ? BOOKING_STATUS_LABELS : PURCHASE_STATUS_LABELS;

  return (
    <>
      <PageHeader
        title="Activité"
        description={`Les ${ACTIVITY_LIMIT} dernières opérations, toutes pages pro confondues.`}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          label="Type d'opération"
          active={tab}
          options={[
            { value: "bookings", label: "Réservations", href: href({ tab: "bookings", status: null }) },
            { value: "purchases", label: "Achats de packs", href: href({ tab: "purchases", status: null }) },
          ]}
        />
        <FilterChips
          label="Statut"
          active={status ?? "all"}
          options={[
            { value: "all", label: "Tous", href: href({ status: null }) },
            ...Object.entries(statusLabels).map(([value, label]) => ({
              value,
              label,
              href: href({ status: value }),
            })),
          ]}
        />
      </div>
      <Card className="overflow-hidden">
        {tab === "bookings" ? (
          <BookingsTable status={bookingStatus} />
        ) : (
          <PurchasesTable status={purchaseStatus} />
        )}
      </Card>
    </>
  );
}
