import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";

import { FilterChips } from "@/components/admin/filter-chips";
import { Pagination } from "@/components/admin/pagination";
import { RoleBadge, SuspensionBadge } from "@/components/admin/user-badges";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireAdmin } from "@/lib/admin";
import {
  USER_FILTERS,
  USER_FILTER_LABELS,
  USERS_PAGE_SIZE,
  parsePage,
  parseUserFilter,
  type UserFilter,
} from "@/lib/admin-params";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateShort } from "@/lib/datetime";
import { listUsers } from "@/server/admin-queries";

export const metadata: Metadata = { title: "Utilisateurs" };

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 100);
  const filter = parseUserFilter(params.filter);
  const page = parsePage(params.page);
  const { rows, total } = await listUsers({ q, filter, page });
  const pageCount = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));

  const hrefFor = (next: { filter?: UserFilter; page?: number }) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    const f = next.filter ?? filter;
    if (f !== "all") sp.set("filter", f);
    if ((next.page ?? 1) > 1) sp.set("page", String(next.page));
    const qs = sp.toString();
    return qs ? `/admin/users?${qs}` : "/admin/users";
  };

  return (
    <>
      <PageHeader
        title="Utilisateurs"
        description={`${total.toLocaleString("fr-FR")} compte${total > 1 ? "s" : ""}`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form
          action="/admin/users"
          role="search"
          className="flex min-w-0 flex-1 gap-2 sm:max-w-sm"
        >
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <Input
            name="q"
            defaultValue={q}
            placeholder="Nom, e-mail ou activité"
            aria-label="Rechercher un utilisateur"
          />
          <Button type="submit" variant="secondary" size="icon" aria-label="Rechercher">
            <Search />
          </Button>
        </form>
        <FilterChips
          label="Filtrer par type de compte"
          active={filter}
          options={USER_FILTERS.map((f) => ({
            value: f,
            label: USER_FILTER_LABELS[f],
            href: hrefFor({ filter: f }),
          }))}
        />
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            Aucun utilisateur ne correspond.
          </p>
        ) : (
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
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="font-medium hover:underline"
                      >
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
                          className="text-primary hover:underline"
                        >
                          /{u.slug}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatDateShort(u.createdAt, ADMIN_TZ)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {u.lastLoginAt ? formatDateShort(u.lastLoginAt, ADMIN_TZ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <SuspensionBadge banned={u.banned} banExpires={u.banExpires} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Pagination
        page={page}
        pageCount={pageCount}
        hrefFor={(p) => hrefFor({ page: p })}
      />
    </>
  );
}
