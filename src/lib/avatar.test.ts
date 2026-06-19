import test from "node:test";
import assert from "node:assert/strict";

import { resolveAvatar } from "./avatar";

test("resolveAvatar: rend un SVG pour un avatar généré valide", () => {
  const r = resolveAvatar({
    avatarKind: "generated",
    avatarStyle: "micah",
    avatarSeed: "x",
  });
  assert.equal(r.mode, "svg");
  if (r.mode === "svg") assert.ok(r.svg.includes("<svg"));
});

test("resolveAvatar: initiales si le style généré est inconnu", () => {
  assert.equal(
    resolveAvatar({ avatarKind: "generated", avatarStyle: "nope" }).mode,
    "initials",
  );
});

test("resolveAvatar: image pour un pack ou un upload", () => {
  assert.deepEqual(resolveAvatar({ avatarKind: "pack", avatarUrl: "/a.png" }), {
    mode: "img",
    src: "/a.png",
  });
  assert.equal(
    resolveAvatar({ avatarKind: "upload", avatarUrl: "https://x/y.png" }).mode,
    "img",
  );
});

test("resolveAvatar: initiales sans donnée", () => {
  assert.equal(resolveAvatar({}).mode, "initials");
});
