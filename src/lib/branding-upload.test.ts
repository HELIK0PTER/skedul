import test from "node:test";
import assert from "node:assert/strict";

import {
  BRANDING_MAX_BYTES,
  brandingBlobPath,
  isOwnBrandingUpload,
  publicBlobHost,
  uploadErrorMessage,
} from "./branding-upload";

const HOST = "abc123xyz.public.blob.vercel-storage.com";

test("publicBlobHost: the store id of a read-write token, lower-cased, on the public Blob domain; null for anything else (P6 A5)", () => {
  assert.equal(publicBlobHost("vercel_blob_rw_AbC123xyz_s3cretPart"), HOST);
  for (const token of [undefined, null, "", "vercel_blob_rw__s3cret", "vercel_blob_rw_abc.evil.test_s3cret", "vercel_blob_rw_abc", "other_blob_rw_abc_s3cret"]) {
    assert.equal(publicBlobHost(token), null, String(token));
  }
});

test("brandingBlobPath: one folder per pro, the kind in the file name (what /api/upload writes and the branding action accepts)", () => {
  assert.equal(brandingBlobPath("pro_1-x", "banner", "V1StGXR8_Z5jdHi6B-myT", "webp"), "branding/pro_1-x/banner-V1StGXR8_Z5jdHi6B-myT.webp");
});

test("isOwnBrandingUpload: only a canonical https URL of the project's store, in this pro's folder, of this kind (P6 A5)", () => {
  const rules = (kind: "banner" | "avatar") => ({ blobHost: HOST, professionalId: "pro_1-x", kind });
  const url = (path: string) => `https://${HOST}/${path}`;
  assert.equal(isOwnBrandingUpload(url("branding/pro_1-x/banner-V1StGXR8_Z5jdHi6B-myT.webp"), rules("banner")), true);
  assert.equal(isOwnBrandingUpload(url("branding/pro_1-x/avatar-abc.jpeg"), rules("avatar")), true);
  // An older upload kept the random suffix @vercel/blob added before 1.0: still the pro's own file.
  assert.equal(isOwnBrandingUpload(url("branding/pro_1-x/avatar-abc-Xy12Zq.png"), rules("avatar")), true);
  for (const bad of [
    "https://evil.test/branding/pro_1-x/banner-abc.webp",
    `http://${HOST}/branding/pro_1-x/banner-abc.webp`,
    `https://${HOST}:8443/branding/pro_1-x/banner-abc.webp`,
    `https://user@${HOST}/branding/pro_1-x/banner-abc.webp`,
    `https://${HOST}.evil.test/branding/pro_1-x/banner-abc.webp`,
    url("branding/pro_2/banner-abc.webp"),
    url("branding/pro_1-x/avatar-abc.webp"),
    url("branding/pro_1-x/banner-abc.svg"),
    url("branding/pro_1-x/banner-abc.webp?download=1"),
    url("branding/pro_1-x/banner-abc.webp#x"),
    url("branding/pro_1-x/sub/banner-abc.webp"),
    url("branding/pro_1-x/../pro_1-x/banner-abc.webp"),
    url("branding/pro_1-x/banner-a%2Fb.webp"),
    url("support/pro_1-x/banner-abc.webp"),
    "/avatars/3d/ninja.png",
    "javascript:alert(1)",
    "",
  ]) {
    assert.equal(isOwnBrandingUpload(bad, rules("banner")), false, bad);
  }
  assert.equal(
    isOwnBrandingUpload(url("branding/pro_1-x/banner-abc.webp"), { ...rules("banner"), blobHost: null }),
    false,
    "no store configured: no upload is the pro's",
  );
});

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
