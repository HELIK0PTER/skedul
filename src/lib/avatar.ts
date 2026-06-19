import { createAvatar } from "@dicebear/core";
import { funEmoji, lorelei, micah, pixelArt } from "@dicebear/collection";

/** Royalty-free generated avatar styles offered in the gallery. */
export const GENERATED_STYLE_KEYS = [
  "fun-emoji",
  "micah",
  "lorelei",
  "pixel-art",
] as const;

export type GeneratedStyle = (typeof GENERATED_STYLE_KEYS)[number];

// One concrete renderer per style: keeps each createAvatar() call typed against
// that style's own option set (a shared map would union incompatible options).
const RENDERERS: Record<GeneratedStyle, (seed: string) => string> = {
  "fun-emoji": (seed) => createAvatar(funEmoji, { seed, radius: 20 }).toString(),
  micah: (seed) => createAvatar(micah, { seed, radius: 20 }).toString(),
  lorelei: (seed) => createAvatar(lorelei, { seed, radius: 20 }).toString(),
  "pixel-art": (seed) => createAvatar(pixelArt, { seed, radius: 20 }).toString(),
};

export function isGeneratedStyle(s: string | null | undefined): s is GeneratedStyle {
  return !!s && (GENERATED_STYLE_KEYS as readonly string[]).includes(s);
}

export interface AvatarInput {
  avatarKind?: string | null;
  avatarStyle?: string | null;
  avatarSeed?: string | null;
  avatarUrl?: string | null;
}

export type ResolvedAvatar =
  | { mode: "svg"; svg: string }
  | { mode: "img"; src: string }
  | { mode: "initials" };

/**
 * Resolve a professional's stored avatar fields into a renderable form.
 * Generated styles are rasterized to an inline SVG (no runtime network call);
 * pack/upload kinds point at an image URL; anything else falls back to initials.
 */
export function resolveAvatar(a: AvatarInput): ResolvedAvatar {
  if (a.avatarKind === "generated" && isGeneratedStyle(a.avatarStyle)) {
    return { mode: "svg", svg: RENDERERS[a.avatarStyle](a.avatarSeed ?? "") };
  }
  if ((a.avatarKind === "pack" || a.avatarKind === "upload") && a.avatarUrl) {
    return { mode: "img", src: a.avatarUrl };
  }
  return { mode: "initials" };
}
