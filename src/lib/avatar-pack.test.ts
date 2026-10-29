import assert from "node:assert/strict";
import test from "node:test";

import { AVATAR_PACK, isPackAvatarUrl, packSrc } from "./avatar-pack";

test("isPackAvatarUrl: exactly the path of a bundled 3D avatar, nothing else (P6 A5)", () => {
  for (const a of AVATAR_PACK) assert.equal(isPackAvatarUrl(packSrc(a.id)), true, a.id);
  for (const bad of [
    "/avatars/3d/nope.png",
    "/avatars/3d/../3d/ninja.png",
    "/avatars/3d/ninja.png?x=1",
    "https://evil.test/avatars/3d/ninja.png",
    "//evil.test/avatars/3d/ninja.png",
    "avatars/3d/ninja.png",
    "",
  ]) {
    assert.equal(isPackAvatarUrl(bad), false, bad);
  }
});
