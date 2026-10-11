"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { del, list } from "@vercel/blob";
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { professional, session, user } from "@/lib/db/schema";
import { getAdminUser, type AdminUser } from "@/lib/admin";
import {
  BAN_DURATIONS,
  deletionConfirmed,
  parseBanDuration,
  type UserRole,
} from "@/lib/admin-params";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { isSuspended } from "@/lib/suspension";
import { deleteSupportFiles } from "@/server/support-core";

export type AdminActionResult = { ok: true } | { ok: false; error: string };

type Target = {
  id: string;
  email: string;
  role: UserRole;
  proId: string | null;
  isPro: boolean;
  suspended: boolean;
};

/** The caller must be an active admin acting on someone else who exists. */
async function authorize(
  userId: string,
): Promise<{ admin: AdminUser; target: Target } | { error: string }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Accès refusé." };
  if (userId === admin.id) {
    return { error: "Vous ne pouvez pas agir sur votre propre compte." };
  }
  const [row] = await db
    .select({
      id: user.id,
      email: user.email,
      role: user.role,
      banned: user.banned,
      banExpires: user.banExpires,
      proId: professional.id,
    })
    .from(user)
    .leftJoin(professional, eq(professional.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) return { error: "Utilisateur introuvable." };
  return {
    admin,
    target: {
      id: row.id,
      email: row.email,
      role: row.role,
      proId: row.proId,
      isPro: row.proId !== null,
      suspended: isSuspended(row),
    },
  };
}

function refresh(userId: string) {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
}

function failure(err: unknown): AdminActionResult {
  console.error("[admin] action failed", err);
  return {
    ok: false,
    error: err instanceof Error ? err.message : "Action impossible.",
  };
}

export async function suspendUser(input: {
  userId: string;
  reason: string;
  duration: string;
}): Promise<AdminActionResult> {
  const check = await authorize(input.userId);
  if ("error" in check) return { ok: false, error: check.error };
  const { target } = check;
  if (target.role === "admin") {
    return { ok: false, error: "Retirez d'abord le rôle admin." };
  }
  const duration = parseBanDuration(input.duration);
  if (!duration) return { ok: false, error: "Durée invalide." };
  const seconds = BAN_DURATIONS[duration];
  try {
    // Open-ended ban: Better Auth leaves banExpires untouched when no
    // banExpiresIn is sent, so clear the lapsed expiry of an earlier timed ban
    // first. Done before banning so that a failure here fails closed: the ban
    // is never recorded with a stale expiry that would read as already lifted.
    if (seconds === null) {
      await db.update(user).set({ banExpires: null }).where(eq(user.id, target.id));
    }
    await auth.api.banUser({
      headers: await headers(),
      body: {
        userId: target.id,
        banReason: input.reason.trim().slice(0, 500) || "Aucun motif précisé",
        ...(seconds ? { banExpiresIn: seconds } : {}),
      },
    });
  } catch (err) {
    return failure(err);
  }
  refresh(target.id);
  return { ok: true };
}

export async function reactivateUser(userId: string): Promise<AdminActionResult> {
  const check = await authorize(userId);
  if ("error" in check) return { ok: false, error: check.error };
  if (check.target.role === "admin") {
    return { ok: false, error: "Action impossible sur un admin." };
  }
  if (!check.target.suspended) {
    return { ok: false, error: "Ce compte n'est pas suspendu." };
  }
  try {
    await auth.api.unbanUser({ headers: await headers(), body: { userId } });
  } catch (err) {
    return failure(err);
  }
  refresh(userId);
  return { ok: true };
}

export async function signOutEverywhere(userId: string): Promise<AdminActionResult> {
  const check = await authorize(userId);
  if ("error" in check) return { ok: false, error: check.error };
  if (check.target.role === "admin") {
    return { ok: false, error: "Action impossible sur un admin." };
  }
  try {
    await auth.api.revokeUserSessions({ headers: await headers(), body: { userId } });
  } catch (err) {
    return failure(err);
  }
  refresh(userId);
  return { ok: true };
}

/** "Se connecter en tant que": opens a 1-hour session as the pro, then /dashboard. */
export async function startImpersonation(userId: string): Promise<AdminActionResult> {
  const check = await authorize(userId);
  if ("error" in check) return { ok: false, error: check.error };
  const { target } = check;
  if (target.role === "admin") {
    return { ok: false, error: "Impossible d'ouvrir le compte d'un admin." };
  }
  if (!target.isPro) {
    return { ok: false, error: "Seuls les comptes pro peuvent être ouverts." };
  }
  if (target.suspended) return { ok: false, error: "Ce compte est suspendu." };
  try {
    await auth.api.impersonateUser({ headers: await headers(), body: { userId } });
  } catch (err) {
    return failure(err);
  }
  redirect("/dashboard");
}

export async function setAdminRole(input: {
  userId: string;
  admin: boolean;
}): Promise<AdminActionResult> {
  const check = await authorize(input.userId);
  if ("error" in check) return { ok: false, error: check.error };
  const { target } = check;
  if (input.admin) {
    if (target.role === "admin") return { ok: false, error: "Ce compte est déjà admin." };
    if (target.suspended) return { ok: false, error: "Réactivez d'abord ce compte." };
  } else if (target.role !== "admin") {
    return { ok: false, error: "Ce compte n'est pas admin." };
  }
  // role is our user_role enum: write it directly (the plugin's setRole would
  // only re-check the admin permission verified above).
  const role: UserRole = input.admin ? "admin" : target.isPro ? "pro" : "client";
  await db.update(user).set({ role }).where(eq(user.id, target.id));
  if (!input.admin) {
    // A demoted admin must not keep impersonating pros until the sessions expire.
    await db.delete(session).where(eq(session.impersonatedBy, target.id));
  }
  refresh(target.id);
  return { ok: true };
}

/**
 * Permanently deletes an account. One DELETE on "user" cascades to its
 * sessions, accounts and pro page with all its data (services, sessions,
 * availability, packs, clients, bookings, purchases); its client records with
 * other pros are kept but detached (customer.user_id → NULL). Support requests
 * cascade too; their images (Blob support/<userId>/) are removed best effort.
 * Admins must be demoted first, and the account's email must be retyped.
 */
export async function deleteUser(input: {
  userId: string;
  confirmEmail: string;
}): Promise<AdminActionResult> {
  const check = await authorize(input.userId);
  if ("error" in check) return { ok: false, error: check.error };
  const { admin, target } = check;
  if (target.role === "admin") {
    return { ok: false, error: "Retirez d'abord le rôle admin." };
  }
  if (!deletionConfirmed(input.confirmEmail, target.email)) {
    return { ok: false, error: "L'email saisi ne correspond pas à ce compte." };
  }
  try {
    await db.delete(user).where(eq(user.id, target.id));
  } catch (err) {
    return failure(err);
  }
  console.info(`[admin] user ${target.id} deleted by admin ${admin.id}`);
  if (target.proId) await deleteBrandingImages(target.proId);
  await deleteSupportFiles(target.id);
  revalidatePath("/admin");
  revalidatePath("/admin/users");
  redirect("/admin/users?deleted=1");
}

/** Best effort: the account is already gone, so a Blob failure is only logged. */
async function deleteBrandingImages(professionalId: string) {
  if (!env.BLOB_ENABLED) return;
  try {
    const prefix = `branding/${professionalId}/`;
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor });
      if (page.blobs.length) await del(page.blobs.map((b) => b.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (err) {
    console.error(`[admin] could not delete branding images of ${professionalId}`, err);
  }
}

/**
 * Ends an impersonation. Runs in the impersonated (pro) session, so there is
 * no admin check here: Better Auth verifies the signed admin_session cookie.
 */
export async function stopImpersonation(): Promise<void> {
  const current = await getSession();
  if (!current?.session.impersonatedBy) redirect("/dashboard");
  const impersonatedId = current.user.id;
  try {
    await auth.api.stopImpersonating({ headers: await headers() });
  } catch (err) {
    // Admin session gone (expired or signed out elsewhere): sign out cleanly.
    console.error("[admin] could not stop impersonation", err);
    await auth.api.signOut({ headers: await headers() });
    redirect("/sign-in");
  }
  redirect(`/admin/users/${impersonatedId}`);
}
