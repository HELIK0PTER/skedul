import test from "node:test";
import assert from "node:assert/strict";

import { brandTheme, presetColor, THEME_PRESETS } from "./color";

test("brandTheme: texte blanc sur une marque foncée", () => {
  assert.equal(brandTheme("#6d5cf6").primaryForeground, "#ffffff");
});

test("brandTheme: texte sombre sur une marque claire", () => {
  assert.equal(brandTheme("#facc15").primaryForeground, "#1a1a2e");
  assert.equal(brandTheme("#ffffff").primaryForeground, "#1a1a2e");
});

test("brandTheme: texte blanc sur du noir", () => {
  assert.equal(brandTheme("#000000").primaryForeground, "#ffffff");
});

test("brandTheme: fallback sur le défaut si hex invalide", () => {
  assert.equal(brandTheme("pas-une-couleur").primary, "#6d5cf6");
});

test("brandTheme: muted clair valide, distinct du primary", () => {
  const m = brandTheme("#6d5cf6").primaryMuted;
  assert.ok(/^#[0-9a-f]{6}$/.test(m));
  assert.notEqual(m, "#6d5cf6");
});

test("brandTheme: tokens accent valides (surface claire, texte foncé distinct)", () => {
  const t = brandTheme("#2563eb");
  assert.ok(/^#[0-9a-f]{6}$/.test(t.accent));
  assert.ok(/^#[0-9a-f]{6}$/.test(t.accentForeground));
  assert.notEqual(t.accent, t.accentForeground);
  assert.equal(t.ring, "#2563eb");
});

test("THEME_PRESETS: presets avec couleurs hex valides", () => {
  assert.ok(THEME_PRESETS.length >= 6);
  for (const p of THEME_PRESETS) assert.ok(/^#[0-9a-f]{6}$/.test(p.color));
});

test("presetColor: résout la couleur d'un preset par id", () => {
  assert.equal(presetColor("violet"), "#6d5cf6");
  assert.equal(presetColor("inconnu"), null);
});
