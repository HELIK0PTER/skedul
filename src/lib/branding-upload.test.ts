import test from "node:test";
import assert from "node:assert/strict";

import { BRANDING_MAX_BYTES, uploadErrorMessage } from "./branding-upload";

test("branding limits stay under Vercel's 4.5 MB request-body cap", () => {
  // the multipart envelope adds a few hundred bytes on top of the file
  for (const max of Object.values(BRANDING_MAX_BYTES)) {
    assert.ok(max + 64_000 < 4_500_000, String(max));
  }
});

test("uploadErrorMessage prefers the route's own message", () => {
  assert.equal(uploadErrorMessage(415, { error: "Format non supporté (jpeg, png, webp)" }), "Format non supporté (jpeg, png, webp)");
});

test("uploadErrorMessage explains a 413 that has no JSON body (Vercel's own cap)", () => {
  assert.equal(uploadErrorMessage(413, null), "Image trop lourde.");
  assert.equal(uploadErrorMessage(413, { error: 42 }), "Image trop lourde.");
});

test("uploadErrorMessage falls back to a generic message", () => {
  assert.equal(uploadErrorMessage(500, null), "L’envoi de l’image a échoué. Réessayez.");
  assert.equal(uploadErrorMessage(502, "Bad Gateway"), "L’envoi de l’image a échoué. Réessayez.");
});
