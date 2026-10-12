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
