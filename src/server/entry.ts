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

export type PostSignIn = { kind: "redirect"; to: string } | { kind: "choose" };

/** Where a signed-in user goes next; admins without a remembered choice must choose. */
export async function resolvePostSignIn(): Promise<PostSignIn> {
  const [admin, store] = await Promise.all([getAdminUser(), cookies()]);
  const target = resolveEntry({
    isAdmin: admin !== null,
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
  if (!valid || !(await getAdminUser())) return "/dashboard";
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
