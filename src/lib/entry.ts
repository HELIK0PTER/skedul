/** Where an admin lands after signing in: the admin area or their own dashboard. */
export type EntryChoice = "admin" | "client";

/** Remembers an admin's choice on this device; survives sign-out on purpose. */
export const ENTRY_COOKIE = "skedul_entry";
export const ENTRY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year, in seconds

export const ENTRY_LABELS: Record<EntryChoice, string> = {
  admin: "Dashboard Admin",
  client: "Dashboard Client",
};

export function parseEntryChoice(
  value: string | null | undefined,
): EntryChoice | null {
  return value === "admin" || value === "client" ? value : null;
}

export function entryPath(choice: EntryChoice): "/admin" | "/dashboard" {
  return choice === "admin" ? "/admin" : "/dashboard";
}

/** Destination right after sign-in, or "choose" to show the chooser. */
export function resolveEntry(input: {
  isAdmin: boolean;
  remembered: EntryChoice | null;
}): "/admin" | "/dashboard" | "choose" {
  if (!input.isAdmin) return "/dashboard";
  return input.remembered ? entryPath(input.remembered) : "choose";
}
