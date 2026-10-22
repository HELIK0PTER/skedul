/**
 * Rules for a pro's public address (/<slug>). Pure, shared by the settings
 * editor and the server action; global uniqueness is checked by the caller.
 */
import { isReservedSegment } from "./analytics";
import { slugify } from "./utils";

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 60;

export type SlugCheck = { ok: true; slug: string } | { ok: false; error: string };

/** Final form of a requested address, or why it cannot be used. */
export function checkSlug(input: string): SlugCheck {
  // slugify truncates after trimming, so a cut can still end on a hyphen
  const slug = slugify(input).slice(0, SLUG_MAX_LENGTH).replace(/-+$/, "");
  if (slug.length < SLUG_MIN_LENGTH) {
    return { ok: false, error: `Au moins ${SLUG_MIN_LENGTH} caractères.` };
  }
  if (isReservedSegment(slug)) {
    return { ok: false, error: "Cette adresse est réservée par Skedul." };
  }
  return { ok: true, slug };
}

/** « root-2 », « root-3 »…: the name is shortened so the numbered address still fits SLUG_MAX_LENGTH, without a hyphen left dangling by the cut. */
function numberedSlug(root: string, n: number): string {
  const suffix = `-${n}`;
  return `${root.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
}

/**
 * The address given to a new pro: the slugified name when it is free, else « name-2 », « name-3 »… (always within
 * SLUG_MAX_LENGTH, so every address stays one the public actions accept, SLUG_PARAM_RE). An app route counts as
 * taken without asking `isTaken`, so a pro page never shadows it. Global uniqueness is `isTaken`'s to answer.
 */
export async function uniqueSlugWith(base: string, isTaken: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base) || "pro";
  let candidate = root;
  let n = 1;
  while (true) {
    if (!isReservedSegment(candidate) && !(await isTaken(candidate))) return candidate;
    candidate = numberedSlug(root, ++n);
  }
}

/** Live clean-up while typing: same alphabet, but a trailing hyphen is kept. */
export function typingSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, SLUG_MAX_LENGTH);
}
