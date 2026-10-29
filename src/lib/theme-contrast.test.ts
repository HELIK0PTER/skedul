/**
 * Contrast of the theme tokens that the colour of a pro does not change (src/app/globals.css). WCAG AA asks 4.5:1 for
 * small text. The destructive token carries text (errors, « Supprimer ») and the destructive buttons (white on it), on
 * the page, on cards, on muted blocks and on its own 10 % tint. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type RGB = [number, number, number];

const CSS = readFileSync("src/app/globals.css", "utf8");

function token(name: string): RGB {
  const m = new RegExp(`--color-${name}:\\s*#([0-9a-fA-F]{6})`).exec(CSS);
  assert.ok(m, `--color-${name} is a hex colour in globals.css`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` laid over `bg` at `alpha` (Tailwind's `bg-destructive/10`). */
function over(fg: RGB, bg: RGB, alpha: number): RGB {
  return [0, 1, 2].map((i) => bg[i] + (fg[i] - bg[i]) * alpha) as unknown as RGB;
}

const WHITE: RGB = [255, 255, 255];

test("destructive text reads 4.5:1 on the page, a card, a muted block and its own tint (final review COV-9)", () => {
  const d = token("destructive");
  const surfaces: [string, RGB][] = [
    ["card", token("card")],
    ["background", token("background")],
    ["muted", token("muted")],
    ["destructive/10 on a card", over(d, token("card"), 0.1)],
    ["destructive/10 on the background", over(d, token("background"), 0.1)],
  ];
  for (const [name, bg] of surfaces) {
    assert.ok(contrast(d, bg) >= 4.5, `text-destructive on ${name}: ${contrast(d, bg).toFixed(2)}:1`);
  }
});

test("white on a destructive button reads 4.5:1, resting and hovered (final review COV-9)", () => {
  const d = token("destructive");
  assert.ok(contrast(WHITE, d) >= 4.5, `resting: ${contrast(WHITE, d).toFixed(2)}:1`);
  for (const [name, bg] of [["card", token("card")], ["background", token("background")]] as const) {
    const hovered = over(d, bg, 0.9); // hover:bg-destructive/90
    assert.ok(contrast(WHITE, hovered) >= 4.5, `hovered on ${name}: ${contrast(WHITE, hovered).toFixed(2)}:1`);
  }
});
