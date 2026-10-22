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

/**
 * Destination right after sign-in (L1394-1395), or "choose" to show the chooser: an admin chooses (or gets the
 * remembered choice); anyone else goes to the pro back-office when they own a page, else to their client space.
 * Only the sign-up funnel lands on the pro onboarding (L1397).
 */
export function resolveEntry(input: {
  isAdmin: boolean;
  hasProfessional: boolean;
  remembered: EntryChoice | null;
}): "/admin" | "/dashboard" | "/mon-espace" | "choose" {
  if (!input.isAdmin) return input.hasProfessional ? "/dashboard" : "/mon-espace";
  return input.remembered ? entryPath(input.remembered) : "choose";
}
