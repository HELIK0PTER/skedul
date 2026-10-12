import type { Metadata } from "next";
import { Search } from "lucide-react";

import { FilterChips } from "@/components/admin/filter-chips";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateShort, formatDateTimeShort } from "@/lib/datetime";
import { getCurrentProfessional } from "@/lib/session";
import { getProClients } from "@/server/queries";

export const metadata: Metadata = { title: "Clients" };

type ClientFilter = "all" | "credits" | "upcoming";

const FILTERS: readonly ClientFilter[] = ["all", "credits", "upcoming"];

/** Case- and accent-insensitive, so « helene » finds « Hélène ». */
function fold(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; filter?: string }>;
}) {
  const pro = (await getCurrentProfessional())!;
  const params = await searchParams;
  // A repeated ?q=a&q=b arrives as an array: ignore it rather than crash.
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 100);
  const filter: ClientFilter = FILTERS.find((f) => f === params.filter) ?? "all";

  const clients = await getProClients(pro.id);
  const withCredits = clients.filter((c) => c.creditsRemaining > 0);
  // Soonest first: the order a pro reads their week in.
  const withUpcoming = clients
    .filter((c) => c.nextBookingAt)
    .sort((a, b) => a.nextBookingAt!.getTime() - b.nextBookingAt!.getTime());
  const needle = fold(q);
  const rows = { all: clients, credits: withCredits, upcoming: withUpcoming }[
    filter
  ].filter((c) => !needle || fold(`${c.name} ${c.email}`).includes(needle));

  const hrefFor = (f: ClientFilter) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (f !== "all") sp.set("filter", f);
    const qs = sp.toString();
    return qs ? `/dashboard/clients?${qs}` : "/dashboard/clients";
  };

  return (
    <>
      <PageHeader
        title="Clients"
        description="Les personnes qui ont une réservation confirmée ou un pack payé sur votre page."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form
          action="/dashboard/clients"
          role="search"
          className="flex w-full min-w-0 gap-2 sm:w-auto sm:max-w-sm sm:flex-1"
        >
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <Input
            name="q"
            defaultValue={q}
            placeholder="Nom ou e-mail"
            aria-label="Rechercher un client"
          />
          <Button type="submit" variant="secondary" size="icon" aria-label="Rechercher">
            <Search />
          </Button>
        </form>
        <FilterChips
          label="Filtrer les clients"
          active={filter}
          options={[
            { value: "all", label: `Tous (${clients.length})`, href: hrefFor("all") },
            {
              value: "credits",
              label: `Avec crédits (${withCredits.length})`,
              href: hrefFor("credits"),
            },
            {
              value: "upcoming",
              label: `Avec un RDV à venir (${withUpcoming.length})`,
              href: hrefFor("upcoming"),
            },
          ]}
        />
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {q
              ? `Aucun client ne correspond à « ${q} ».`
              : filter === "credits"
                ? "Aucun client n'a de crédits en cours."
                : filter === "upcoming"
                  ? "Aucun client n'a de rendez-vous à venir."
                  : "Pas encore de client. Ils apparaîtront ici dès leur première réservation confirmée ou leur premier pack payé."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Client</th>
                  <th className="px-4 py-2.5 font-medium">Crédits restants</th>
                  <th className="px-4 py-2.5 font-medium">Réservations</th>
                  <th className="px-4 py-2.5 font-medium">Prochain RDV</th>
                  <th className="px-4 py-2.5 font-medium">Client depuis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((c) => (
                  <tr key={c.id} className="align-top hover:bg-muted/40">
                    <td className="px-4 py-3">
                      {c.name ? (
                        <p className="font-medium">{c.name}</p>
                      ) : (
                        <p className="text-muted-foreground">Sans nom</p>
                      )}
                      {c.email && (
                        <a
                          href={`mailto:${c.email}`}
                          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                        >
                          {c.email}
                        </a>
                      )}
                      {c.phone && (
                        <p className="text-xs text-muted-foreground">{c.phone}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {c.packs.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <ul className="space-y-1">
                          {c.packs.map((p) => (
                            <li
                              key={p.id}
                              className="flex items-center gap-2 whitespace-nowrap"
                            >
                              <Badge className="tabular-nums">
                                {p.creditsRemaining} / {p.creditsTotal}
                              </Badge>
                              <span className="text-muted-foreground">{p.name}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{c.bookings}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {c.nextBookingAt
                        ? formatDateTimeShort(c.nextBookingAt, pro.timezone)
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatDateShort(c.createdAt, pro.timezone)}
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
