import type { CSSProperties } from "react";

const FALLBACK = "#6d5cf6";
type RGB = [number, number, number];

export interface BrandTheme {
  primary: string;
  primaryForeground: string;
  primaryMuted: string;
}

function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function toHex(rgb: RGB): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

/** WCAG relative luminance of an sRGB color. */
function luminance([r, g, b]: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two luminances. */
function contrast(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function mixWhite([r, g, b]: RGB, w: number): RGB {
  return [r + (255 - r) * w, g + (255 - g) * w, b + (255 - b) * w];
}

const DARK_FG: RGB = [26, 26, 46]; // #1a1a2e

/**
 * Derive a usable UI theme from an arbitrary brand color: the color itself,
 * a readable foreground (white or near-black, whichever has more contrast),
 * and a light muted tint for soft surfaces. Falls back to the default violet
 * when the input is not a valid 6-digit hex.
 */
export function brandTheme(input: string): BrandTheme {
  const rgb = parseHex(input) ?? (parseHex(FALLBACK) as RGB);
  const lum = luminance(rgb);
  const whiteContrast = contrast(1, lum);
  const darkContrast = contrast(luminance(DARK_FG), lum);
  const primaryForeground = whiteContrast >= darkContrast ? "#ffffff" : "#1a1a2e";
  return {
    primary: toHex(rgb),
    primaryForeground,
    primaryMuted: toHex(mixWhite(rgb, 0.88)),
  };
}

/** Inline-style object overriding the Tailwind `--color-primary*` tokens. */
export function brandThemeVars(input: string): CSSProperties {
  const t = brandTheme(input);
  return {
    ["--color-primary" as string]: t.primary,
    ["--color-primary-foreground" as string]: t.primaryForeground,
    ["--color-primary-muted" as string]: t.primaryMuted,
  } as CSSProperties;
}
