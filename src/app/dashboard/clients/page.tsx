import type { Metadata } from "next";
import { Users } from "lucide-react";

import { FilterChips } from "@/components/admin/filter-chips";
import { ClientSearch } from "@/components/dashboard/client-search";
import { EmptyState } from "@/components/dashboard/empty-state";
import { NewClientButton } from "@/components/dashboard/new-client-button";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  CLIENT_FILTERS,
  CLIENT_FILTER_LABELS,
  clientsHref,
  parseClientFilter,
} from "@/lib/back-office/client-filters";
import { CLIENT_LIST_LIMIT } from "@/lib/back-office/client-reads";
import { formatCount } from "@/lib/back-office/format";
import { getClientsPage } from "@/server/client-queries";
import { requireProContext } from "@/server/pro-context";

export const metadata: Metadata = { title: "Clients" };

const DESCRIPTION = "Les personnes qui réservent chez vous et leurs tickets.";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string | string[] }>;
}) {
  const ctx = await requireProContext();
  const params = await searchParams;
  const filter = parseClientFilter(params.filter);
  // The search term never travels in the URL (Decision 73): the page lists the filter, ClientSearch searches it.
  const { rows, counts } = await getClientsPage(ctx.professionalId, { q: "", filter });

  if (counts.tous === 0) {
    return (
      <>
        <PageHeader title="Clients" description={DESCRIPTION} />
        <EmptyState
          icon={Users}
          title="Vos clients apparaîtront ici"
          description="Ils sont créés à leur première réservation ou à leur premier achat. Vous pouvez aussi en ajouter un."
          action={<NewClientButton />}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Clients" description={DESCRIPTION} action={<NewClientButton />} />
      <ClientSearch key={filter} filter={filter} initialRows={rows} total={counts[filter]} limit={CLIENT_LIST_LIMIT}>
        <FilterChips
          label="Filtrer"
          active={filter}
          scrollable
          options={CLIENT_FILTERS.map((f) => ({
            value: f,
            label: `${CLIENT_FILTER_LABELS[f]} (${formatCount(counts[f])})`,
            href: clientsHref(f),
          }))}
        />
      </ClientSearch>
    </>
  );
}
