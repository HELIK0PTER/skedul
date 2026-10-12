import { test } from "node:test";
import assert from "node:assert/strict";

import { safeMockRedirect } from "./mock-redirect";

const APP = "https://myskedul.com";

test("keeps a same-origin success URL", () => {
  const ok = "https://myskedul.com/altinha-paris/merci?type=pack&ref=abc";
  assert.equal(safeMockRedirect(ok, APP), ok);
});

test("resolves a same-origin path", () => {
  assert.equal(safeMockRedirect("/altinha-paris/merci", APP), "https://myskedul.com/altinha-paris/merci");
});

test("refuses other origins, protocol-relative and script URLs", () => {
  assert.equal(safeMockRedirect("https://evil.example/x", APP), APP);
  assert.equal(safeMockRedirect("//evil.example/x", APP), APP);
  assert.equal(safeMockRedirect("javascript:alert(1)", APP), APP);
  assert.equal(safeMockRedirect(null, APP), APP);
});
