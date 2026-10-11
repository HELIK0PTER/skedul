import test from "node:test";
import assert from "node:assert/strict";

import { safeNextPath } from "./safe-next";

test("safeNextPath keeps same-site paths with their query and hash", () => {
  assert.equal(safeNextPath("/aide/demandes/nouvelle"), "/aide/demandes/nouvelle");
  assert.equal(safeNextPath("/aide?q=pack#a-1"), "/aide?q=pack#a-1");
});

test("safeNextPath rejects anything that could leave the site", () => {
  for (const bad of [
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "aide",
    "",
    "/\u0000x",
    undefined,
    null,
    42,
    ["/aide"],
  ]) {
    assert.equal(safeNextPath(bad), null, String(bad));
  }
});
