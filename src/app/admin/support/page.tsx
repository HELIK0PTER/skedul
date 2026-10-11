import type { Metadata } from "next";

import { FilterChips } from "@/components/admin/filter-chips";
import { Pagination } from "@/components/admin/pagination";
import { SupportInboxRow } from "@/components/admin/support-inbox-row";
import { SupportTabs } from "@/components/admin/support-tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";
import { parsePage } from "@/lib/admin-params";
import {
  INBOX_FILTERS,
  INBOX_FILTER_LABELS,
  INBOX_PAGE_SIZE,
  SUPPORT_TYPES,
  TYPE_LABELS,
  parseInboxFilter,
  parseSupportType,
  type InboxFilter,
  type SupportType,
} from "@/lib/support";
import { getSupportInbox } from "@/server/support-queries";

export const metadata: Metadata = { title: "Support" };

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; type?: string; page?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const filter = parseInboxFilter(params.filter);
  const type = parseSupportType(params.type);
  const page = parsePage(params.page);
  const { rows, total } = await getSupportInbox({ filter, type, page });
  const pageCount = Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE));

  // `type: undefined` keeps the current type, `null` clears it
  const hrefFor = (next: { filter?: InboxFilter; type?: SupportType | null; page?: number }) => {
    const sp = new URLSearchParams();
    const f = next.filter ?? filter;
    if (f !== "todo") sp.set("filter", f);
    const t = next.type === undefined ? type : next.type;
    if (t) sp.set("type", t);
    if ((next.page ?? 1) > 1) sp.set("page", String(next.page));
    const qs = sp.toString();
    return qs ? `/admin/support?${qs}` : "/admin/support";
  };

  return (
    <>
      <PageHeader
        title="Support"
        description={`${total.toLocaleString("fr-FR")} demande${total > 1 ? "s" : ""}`}
      />
      <SupportTabs active="inbox" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          label="Statut"
          active={filter}
          options={INBOX_FILTERS.map((f) => ({
            value: f,
            label: INBOX_FILTER_LABELS[f],
            href: hrefFor({ filter: f }),
          }))}
        />
        <FilterChips<SupportType | "all">
          label="Type"
          active={type ?? "all"}
          options={[
            { value: "all", label: "Tous les types", href: hrefFor({ type: null }) },
            ...SUPPORT_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t], href: hrefFor({ type: t }) })),
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <Card className="px-6 py-12 text-center text-sm text-muted-foreground">
          {filter === "todo" ? "Rien à traiter pour l’instant." : "Aucune demande pour ce filtre."}
        </Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {rows.map((row) => (
            <SupportInboxRow key={row.id} row={row} />
          ))}
        </Card>
      )}
      <Pagination page={page} pageCount={pageCount} hrefFor={(p) => hrefFor({ page: p })} />
    </>
  );
}
