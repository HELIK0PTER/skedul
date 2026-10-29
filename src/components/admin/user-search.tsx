"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";

import { RoleBadge, StatusBadge } from "@/components/admin/badges";
import { FormError } from "@/components/dashboard/form-error";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { USER_SEARCH_MAX, type UserFilter } from "@/lib/admin-params";
import type { AdminUserPage, AdminUserRow } from "@/lib/admin-users";
import { plural } from "@/lib/back-office/format";
import { callOrFail } from "@/lib/pro-messages";
import { searchUsersAction } from "@/server/admin";

/**
 * The search field and the table of /admin/users (P6 A4, the pro's client search of Decision 73 as model). The typed
 * term lives in component state only: it is sent to searchUsersAction and never put in a URL, so a user's name or
 * e-mail does not reach the address bar, the history or the platform request log. The page renders this component
 * with a key of its filter and page, so a filter chip or a page link (links without a term) starts afresh. The pages
 * of a search are read through the action too. An empty term shows the page's own rows again. Every request takes a
 * number: an answer that is not the latest request's any more is dropped, so a slow search cannot replace a newer one.
 */
export function AdminUserSearch({
  filter,
  initial,
  chips,
  pager,
}: {
  filter: UserFilter;
  initial: AdminUserPage;
  /** The filter chips (links), shown beside the field. */
  chips: React.ReactNode;
  /** The pager of the unsearched list (links); a search has its own. */
  pager: React.ReactNode;
}) {
  const latest = useRef(0);
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<(AdminUserPage & { q: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rows = found ? found.rows : initial.rows;
  const emptyText = found ? `Aucun utilisateur ne correspond à « ${found.q} ».` : "Aucun utilisateur ne correspond.";

  function run(q: string, page: number) {
    const request = ++latest.current;
    setError(null);
    startTransition(async () => {
      const res = await callOrFail(() => searchUsersAction({ q, filter, page }));
      if (request !== latest.current) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFound({ q, ...res.page });
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const q = term.trim();
    setError(null);
    if (q === "") {
      latest.current += 1;
      setFound(null);
      return;
    }
    run(q, 1);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form role="search" method="post" onSubmit={submit} className="flex min-w-0 flex-1 gap-2 sm:max-w-sm">
          <Input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Nom, e-mail ou activité"
            aria-label="Rechercher un utilisateur"
            maxLength={USER_SEARCH_MAX}
            autoComplete="off"
          />
          <Button type="submit" variant="secondary" size="icon" aria-label="Rechercher" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Search />}
          </Button>
        </form>
        {chips}
      </div>
      <div className="mb-4 empty:hidden">
        <FormError message={error} />
      </div>

      {rows.length > 0 && (
        <Card className="overflow-hidden">
          <UserTable rows={rows} />
        </Card>
      )}
      <div role="status">
        {rows.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            <p className="wrap-anywhere">{emptyText}</p>
          </Card>
        ) : found ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {plural(found.total, "utilisateur trouvé", "utilisateurs trouvés")}
          </p>
        ) : null}
      </div>

      {found === null ? (
        pager
      ) : found.pageCount > 1 ? (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
          {found.page > 1 ? (
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => run(found.q, found.page - 1)}>
              <ChevronLeft />
              Précédent
            </Button>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Page {found.page} sur {found.pageCount}
          </span>
          {found.page < found.pageCount ? (
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => run(found.q, found.page + 1)}>
              Suivant
              <ChevronRight />
            </Button>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}

function UserTable({ rows }: { rows: AdminUserRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-medium">Utilisateur</th>
            <th className="px-4 py-2.5 font-medium">Rôle</th>
            <th className="px-4 py-2.5 font-medium">Page pro</th>
            <th className="px-4 py-2.5 font-medium">Inscription</th>
            <th className="px-4 py-2.5 font-medium">Dernière connexion</th>
            <th className="px-4 py-2.5 font-medium">Statut</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((u) => (
            <tr key={u.id} className="hover:bg-muted/40">
              <td className="px-4 py-3">
                <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                  {u.name}
                </Link>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </td>
              <td className="px-4 py-3">
                <RoleBadge role={u.role} />
              </td>
              <td className="px-4 py-3">
                {u.slug ? (
                  <Link
                    href={`/${u.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    /{u.slug}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Aucune page</span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{u.createdLabel}</td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{u.lastLoginLabel}</td>
              <td className="px-4 py-3">
                <StatusBadge label={u.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
