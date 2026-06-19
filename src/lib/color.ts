import type { CSSProperties } from "react";

const FALLBACK = "#6d5cf6";
type RGB = [number, number, number];

export interface BrandTheme {
  primary: string;
  primaryForeground: string;
  primaryMuted: string;
  accent: string;
  accentForeground: string;
  ring: string;
}

/** Named color presets offered to professionals. */
export interface ThemePreset {
  id: string;
  label: string;
  color: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: "violet", label: "Violet", color: "#6d5cf6" },
  { id: "blue", label: "Bleu", color: "#2563eb" },
  { id: "teal", label: "Turquoise", color: "#0d9488" },
  { id: "green", label: "Vert", color: "#16a34a" },
  { id: "amber", label: "Ambre", color: "#d97706" },
  { id: "red", label: "Rouge", color: "#e11d48" },
  { id: "pink", label: "Rose", color: "#db2777" },
  { id: "slate", label: "Ardoise", color: "#475569" },
];

export function presetColor(id: string | null | undefined): string | null {
  return THEME_PRESETS.find((p) => p.id === id)?.color ?? null;
}

function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

export function isHexColor(hex: string | null | undefined): boolean {
  return !!hex && /^#?[0-9a-f]{6}$/i.test(hex.trim());
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

function mix(a: RGB, b: RGB, w: number): RGB {
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
}

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const DARK_FG: RGB = [26, 26, 46]; // #1a1a2e

/** Pick white or near-black foreground for the best contrast on `bg`. */
function readableOn(bg: RGB): string {
  return contrast(1, luminance(bg)) >= contrast(luminance(DARK_FG), luminance(bg))
    ? "#ffffff"
    : "#1a1a2e";
}

/**
 * Derive a cohesive UI theme from a single brand color: the color itself, a
 * readable button foreground, light muted/accent surfaces, and a darkened
 * branded text color that stays readable on the accent surface. Falls back to
 * the default violet when the input is not a valid 6-digit hex.
 */
export function brandTheme(input: string): BrandTheme {
  const rgb = parseHex(input) ?? (parseHex(FALLBACK) as RGB);
  const accent = mix(rgb, WHITE, 0.9); // very light branded surface
  const accentLum = luminance(accent);

  // branded text: darken the brand until it reads on the accent surface
  let accentForeground: RGB = rgb;
  for (let w = 0.3; w <= 0.72; w += 0.07) {
    accentForeground = mix(rgb, BLACK, w);
    if (contrast(luminance(accentForeground), accentLum) >= 4.5) break;
  }

  return {
    primary: toHex(rgb),
    primaryForeground: readableOn(rgb),
    primaryMuted: toHex(mix(rgb, WHITE, 0.88)),
    accent: toHex(accent),
    accentForeground: toHex(accentForeground),
    ring: toHex(rgb),
  };
}

/** Inline-style object overriding the public page's Tailwind theme tokens. */
export function brandThemeVars(input: string): CSSProperties {
  const t = brandTheme(input);
  return {
    ["--color-primary" as string]: t.primary,
    ["--color-primary-foreground" as string]: t.primaryForeground,
    ["--color-primary-muted" as string]: t.primaryMuted,
    ["--color-accent" as string]: t.accent,
    ["--color-accent-foreground" as string]: t.accentForeground,
    ["--color-ring" as string]: t.ring,
  } as CSSProperties;
}
