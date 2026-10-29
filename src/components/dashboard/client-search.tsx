"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { ClientList } from "@/components/dashboard/client-list";
import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { clientsHref, type ClientFilter } from "@/lib/back-office/client-filters";
import type { ClientListRow } from "@/lib/back-office/client-reads";
import { formatCount, plural } from "@/lib/back-office/format";
import { callOrFail } from "@/lib/pro-messages";
import { searchClientsAction } from "@/server/pro-clients";

/**
 * The « Rechercher » form and the client list of /dashboard/clients (Decision 73, FR:UI-13). The typed term lives in
 * component state only: it is sent to searchClientsAction and never put in a URL, so a client's name or e-mail does
 * not reach the address bar, the history or the platform request log. The page renders this component with
 * `key={filter}`, so a filter chip (a link to ?filter=…) starts a fresh search. An empty term shows the rows of the
 * filter again. The empty text, the capped line and the number of clients a search found live in an always-mounted
 * `role="status"` region. Every request takes a number: an answer that is not the latest request's any more (a newer
 * search, an empty submit, « Voir tous les clients ») is dropped, so a slow search cannot replace a list the pro has
 * just reset.
 */
export function ClientSearch({
  filter,
  initialRows,
  total,
  limit,
  children,
}: {
  filter: ClientFilter;
  initialRows: ClientListRow[];
  total: number;
  limit: number;
  children: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef(0);
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<{ q: string; rows: ClientListRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rows = found ? found.rows : initialRows;
  const searched = found ? found.q : "";
  // The read stops at `limit` rows while the search and the counts see every client.
  const capped = rows.length >= limit && (searched !== "" || total > rows.length);
  const emptyText = searched !== "" ? `Aucun client ne correspond à « ${searched} ».` : "Aucun client dans ce filtre.";

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const q = term.trim();
    setError(null);
    if (q === "") {
      // No request can be pending here (submit returned above while one is), so the bump only keeps the counter in
      // step; the reset button (showAll) is what invalidates a request in flight.
      latest.current += 1;
      setFound(null);
      return;
    }
    const request = ++latest.current;
    startTransition(async () => {
      const res = await callOrFail(() => searchClientsAction({ q, filter }));
      if (request !== latest.current) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFound({ q, rows: res.rows });
    });
  }

  /** « Voir tous les clients » inside the unfiltered list: forget the search and give the focus back to the field. */
  function showAll() {
    latest.current += 1;
    setTerm("");
    setFound(null);
    setError(null);
    inputRef.current?.focus();
  }

  return (
    <>
      <div className="mb-5 space-y-3">
        <form role="search" method="post" onSubmit={submit} className="flex max-w-md items-end gap-2">
          <div className="min-w-0 flex-1">
            <FormField label="Rechercher" htmlFor="client-search">
              <Input
                ref={inputRef}
                id="client-search"
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                maxLength={100}
                autoComplete="off"
              />
            </FormField>
          </div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Rechercher
          </Button>
        </form>
        <FormError message={error} />
        {children}
      </div>

      {rows.length > 0 && <ClientList rows={rows} />}
      <div role="status">
        {rows.length === 0 ? (
          <Card className="flex flex-col items-center gap-4 px-6 py-10 text-center">
            <p className="max-w-full text-sm text-zinc-600 wrap-anywhere">{emptyText}</p>
            {filter === "tous" ? (
              <Button type="button" variant="secondary" size="sm" onClick={showAll}>
                Voir tous les clients
              </Button>
            ) : (
              <Button asChild variant="secondary" size="sm">
                <Link href={clientsHref("tous")}>Voir tous les clients</Link>
              </Button>
            )}
          </Card>
        ) : capped ? (
          <p className="mt-3 text-sm text-zinc-600">
            {`Les ${formatCount(limit)} premiers clients sont affichés. Précisez la recherche pour trouver les autres.`}
          </p>
        ) : searched !== "" ? (
          <p className="mt-3 text-sm text-zinc-600">{plural(rows.length, "client trouvé", "clients trouvés")}</p>
        ) : null}
      </div>
    </>
  );
}
