import type { Metadata } from "next";

import { FilterChips } from "@/components/admin/filter-chips";
import { Pagination } from "@/components/admin/pagination";
import { AdminUserSearch } from "@/components/admin/user-search";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireAdmin } from "@/lib/admin";
import {
  USER_FILTERS,
  USER_FILTER_LABELS,
  parsePage,
  parseUserFilter,
  type UserFilter,
} from "@/lib/admin-params";
import { toAdminUserPage } from "@/lib/admin-users";
import { listUsers } from "@/server/admin-queries";

export const metadata: Metadata = { title: "Utilisateurs" };

/**
 * The accounts of the platform. The search term never travels in the URL (P6 A4): the page reads the filter, the page
 * and the deletion notice only, and AdminUserSearch sends a term through its Server Action.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string;
    page?: string;
    deleted?: string;
  }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const filter = parseUserFilter(params.filter);
  const page = parsePage(params.page);
  const initial = toAdminUserPage(await listUsers({ q: "", filter, page }), page);

  const hrefFor = (next: { filter?: UserFilter; page?: number }) => {
    const sp = new URLSearchParams();
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
        description={`${initial.total.toLocaleString("fr-FR")} compte${initial.total > 1 ? "s" : ""}`}
      />

      {params.deleted === "1" && (
        <p role="status" className="mb-4 rounded-xl bg-success-muted px-4 py-3 text-sm text-green-800">
          Compte supprimé.
        </p>
      )}

      <AdminUserSearch
        key={`${filter}:${page}`}
        filter={filter}
        initial={initial}
        chips={
          <FilterChips
            label="Filtrer par type de compte"
            active={filter}
            options={USER_FILTERS.map((f) => ({
              value: f,
              label: USER_FILTER_LABELS[f],
              href: hrefFor({ filter: f }),
            }))}
          />
        }
        pager={
          <Pagination
            page={page}
            pageCount={initial.pageCount}
            hrefFor={(p) => hrefFor({ page: p })}
          />
        }
      />
    </>
  );
}
