import { describe, expect, it } from "vitest";

import { brandTheme } from "./color";

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
});
