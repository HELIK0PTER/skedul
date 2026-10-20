import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";

import { FilterChips } from "@/components/admin/filter-chips";
import { ClientList } from "@/components/dashboard/client-list";
import { EmptyState } from "@/components/dashboard/empty-state";
import { FormField } from "@/components/dashboard/form-field";
import { NewClientButton } from "@/components/dashboard/new-client-button";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  searchParams: Promise<{ filter?: string | string[]; q?: string | string[] }>;
}) {
  const ctx = await requireProContext();
  const params = await searchParams;
  const filter = parseClientFilter(params.filter);
  // A repeated ?q=a&q=b arrives as an array: ignore it rather than crash.
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 100);
  const { rows, counts } = await getClientsPage(ctx.professionalId, { q, filter });

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

  const emptyText = q !== "" ? `Aucun client ne correspond à « ${q} ».` : "Aucun client dans ce filtre.";
  // The read stops at CLIENT_LIST_LIMIT rows while the search and the counts see every client.
  const capped = rows.length >= CLIENT_LIST_LIMIT && (q !== "" || counts[filter] > rows.length);

  return (
    <>
      <PageHeader title="Clients" description={DESCRIPTION} action={<NewClientButton />} />

      <div className="mb-5 space-y-3">
        <form action="/dashboard/clients" role="search" className="flex max-w-md items-end gap-2">
          {filter !== "tous" && <input type="hidden" name="filter" value={filter} />}
          <div className="min-w-0 flex-1">
            <FormField label="Rechercher" htmlFor="client-search">
              <Input
                key={q}
                id="client-search"
                name="q"
                type="search"
                defaultValue={q}
                maxLength={100}
                autoComplete="off"
              />
            </FormField>
          </div>
          <Button type="submit" variant="secondary">
            Rechercher
          </Button>
        </form>
        <FilterChips
          label="Filtrer"
          active={filter}
          scrollable
          options={CLIENT_FILTERS.map((f) => ({
            value: f,
            label: `${CLIENT_FILTER_LABELS[f]} (${formatCount(counts[f])})`,
            href: clientsHref(f, q),
          }))}
        />
      </div>

      {rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 px-6 py-10 text-center">
          <p role="status" className="max-w-full text-sm text-zinc-600 wrap-anywhere">
            {emptyText}
          </p>
          <Button asChild variant="secondary" size="sm">
            <Link href={clientsHref("tous", "")}>Voir tous les clients</Link>
          </Button>
        </Card>
      ) : (
        <>
          <ClientList rows={rows} />
          {capped && (
            <p className="mt-3 text-sm text-zinc-600">
              {`Les ${formatCount(CLIENT_LIST_LIMIT)} premiers clients sont affichés. Précisez la recherche pour trouver les autres.`}
            </p>
          )}
        </>
      )}
    </>
  );
}
