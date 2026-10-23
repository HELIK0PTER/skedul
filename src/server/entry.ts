"use server";

import { cookies } from "next/headers";

import { getAdminUser } from "@/lib/admin";
import {
  ENTRY_COOKIE,
  ENTRY_COOKIE_MAX_AGE,
  entryPath,
  parseEntryChoice,
  resolveEntry,
  type EntryChoice,
} from "@/lib/entry";
import { getCurrentProfessional } from "@/lib/session";

export type PostSignIn = { kind: "redirect"; to: string } | { kind: "choose" };

/** Where a signed-in user goes next: admins without a remembered choice must choose, a user without a pro page lands on their client space. */
export async function resolvePostSignIn(): Promise<PostSignIn> {
  const [admin, pro, store] = await Promise.all([getAdminUser(), getCurrentProfessional(), cookies()]);
  const target = resolveEntry({
    isAdmin: admin !== null,
    hasProfessional: pro !== null,
    remembered: parseEntryChoice(store.get(ENTRY_COOKIE)?.value),
  });
  return target === "choose"
    ? { kind: "choose" }
    : { kind: "redirect", to: target };
}

/** Records an admin's choice (optionally remembered on this device) and returns the path. */
export async function chooseEntry(
  choice: EntryChoice,
  remember: boolean,
): Promise<string> {
  const valid = parseEntryChoice(choice);
  if (!valid || !(await getAdminUser())) {
    // Nothing to choose: the caller is not an admin, or an admin sent a choice that is neither "admin" nor "client".
    // Either way they go where resolveEntry sends everyone else: the pro back-office when they own a page, else their client space.
    return (await getCurrentProfessional()) ? "/dashboard" : "/mon-espace";
  }
  if (remember) {
    (await cookies()).set(ENTRY_COOKIE, valid, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ENTRY_COOKIE_MAX_AGE,
      path: "/",
    });
  }
  return entryPath(valid);
}

export async function forgetEntryChoice(): Promise<void> {
  (await cookies()).delete(ENTRY_COOKIE);
}
