import { describe, expect, it } from "vitest";

import { resolveAvatar } from "./avatar";

describe("resolveAvatar", () => {
  it("rend un SVG pour un avatar généré valide", () => {
    const r = resolveAvatar({
      avatarKind: "generated",
      avatarStyle: "micah",
      avatarSeed: "x",
    });
    expect(r.mode).toBe("svg");
    if (r.mode === "svg") expect(r.svg).toContain("<svg");
  });
  it("retombe sur initiales si le style généré est inconnu", () => {
    expect(
      resolveAvatar({ avatarKind: "generated", avatarStyle: "nope" }).mode,
    ).toBe("initials");
  });
  it("utilise l'image pour un pack ou un upload", () => {
    expect(resolveAvatar({ avatarKind: "pack", avatarUrl: "/a.png" })).toEqual({
      mode: "img",
      src: "/a.png",
    });
    expect(
      resolveAvatar({ avatarKind: "upload", avatarUrl: "https://x/y.png" }).mode,
    ).toBe("img");
  });
  it("retombe sur initiales sans donnée", () => {
    expect(resolveAvatar({}).mode).toBe("initials");
  });
});
