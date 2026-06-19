import { describe, expect, it } from "vitest";

import { brandTheme, presetColor, THEME_PRESETS } from "./color";

describe("brandTheme", () => {
  it("met un texte blanc sur une marque foncée", () => {
    expect(brandTheme("#6d5cf6").primaryForeground).toBe("#ffffff");
  });
  it("met un texte sombre sur une marque claire", () => {
    expect(brandTheme("#facc15").primaryForeground).toBe("#1a1a2e");
    expect(brandTheme("#ffffff").primaryForeground).toBe("#1a1a2e");
  });
  it("met un texte blanc sur du noir", () => {
    expect(brandTheme("#000000").primaryForeground).toBe("#ffffff");
  });
  it("retombe sur la couleur par défaut si hex invalide", () => {
    expect(brandTheme("pas-une-couleur").primary).toBe("#6d5cf6");
  });
  it("produit un muted clair et valide, distinct du primary", () => {
    const m = brandTheme("#6d5cf6").primaryMuted;
    expect(/^#[0-9a-f]{6}$/.test(m)).toBe(true);
    expect(m).not.toBe("#6d5cf6");
  });
  it("produit des tokens accent valides (surface claire, texte foncé distinct)", () => {
    const t = brandTheme("#2563eb");
    expect(/^#[0-9a-f]{6}$/.test(t.accent)).toBe(true);
    expect(/^#[0-9a-f]{6}$/.test(t.accentForeground)).toBe(true);
    expect(t.accent).not.toBe(t.accentForeground);
    expect(t.ring).toBe("#2563eb");
  });
});

describe("THEME_PRESETS", () => {
  it("expose des presets avec des couleurs hex valides", () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const p of THEME_PRESETS) {
      expect(/^#[0-9a-f]{6}$/.test(p.color)).toBe(true);
    }
  });
  it("résout la couleur d'un preset par id", () => {
    expect(presetColor("violet")).toBe("#6d5cf6");
    expect(presetColor("inconnu")).toBe(null);
  });
});
