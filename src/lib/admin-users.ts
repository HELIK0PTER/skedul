import { z } from "zod";

import { USER_FILTERS, USER_SEARCH_MAX, USERS_PAGE_SIZE, type UserRole } from "@/lib/admin-params";
import { ADMIN_TZ } from "@/lib/analytics";
import { formatDateShort } from "@/lib/datetime";
import { isSuspended } from "@/lib/suspension";

/**
 * The input of the admin user search (P6 A4): the term, the filter of the page and the page of the results. Strict,
 * so nothing else (an id, a role) can ride along; the admin is the session's, never the input's.
 */
export const userSearchSchema = z.strictObject({
  q: z.string().trim().max(USER_SEARCH_MAX),
  filter: z.enum(USER_FILTERS),
  page: z.number().int().min(1).max(10_000),
});

/** « Suspendu », « Suspendu jusqu'au 1er nov. 2026 » (Paris), or null for an active account. */
export function suspensionLabel(u: { banned: boolean | null; banExpires: Date | null }, now: Date = new Date()): string | null {
  if (!isSuspended(u, now)) return null;
  return u.banExpires ? `Suspendu jusqu'au ${formatDateShort(u.banExpires, ADMIN_TZ)}` : "Suspendu";
}

/** One row of the /admin/users table as the browser receives it: labels only, no date and no ban field. */
export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  slug: string | null;
  createdLabel: string;
  lastLoginLabel: string;
  /** null while the account is active. */
  status: string | null;
};

export type AdminUserPage = { rows: AdminUserRow[]; total: number; page: number; pageCount: number };

type ListedUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  lastLoginAt: Date | null;
  banned: boolean | null;
  banExpires: Date | null;
  slug: string | null;
};

/** The page `page` of a listUsers answer, ready for the table of /admin/users. */
export function toAdminUserPage(res: { rows: ListedUser[]; total: number }, page: number, now: Date = new Date()): AdminUserPage {
  return {
    rows: res.rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      slug: u.slug,
      createdLabel: formatDateShort(u.createdAt, ADMIN_TZ),
      lastLoginLabel: u.lastLoginAt ? formatDateShort(u.lastLoginAt, ADMIN_TZ) : "Jamais",
      status: suspensionLabel(u, now),
    })),
    total: res.total,
    page,
    pageCount: Math.max(1, Math.ceil(res.total / USERS_PAGE_SIZE)),
  };
}
