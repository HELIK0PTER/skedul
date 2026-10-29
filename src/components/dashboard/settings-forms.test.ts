/**
 * Wiring guards for the public address, branding and onboarding forms and their actions (P6 A5). The components import
 * Server Actions and src/server/pro.ts imports next/*, which the node:test runner cannot load: what they must keep is
 * pinned on their source. The cores themselves are tested in src/lib/back-office/settings-actions.db.test.ts. Run from
 * the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bodyOf } from "../../test/source-guards";

const source = (path: string): string => readFileSync(path, "utf8");

test("updateSlug and updateBranding are runProAction cores: the pro of the session, a public-page revalidation, no requirePro left", () => {
  const pro = source("src/server/pro.ts");
  assert.match(
    bodyOf(pro, "updateSlug"),
    /return runProAction\("updateSlug", \(ctx, now\) => updateSlugCore\(db, ctx, input, now\), \{ publicPage: true \}\);/,
  );
  assert.match(
    bodyOf(pro, "updateBranding"),
    /return runProAction\(\s*"updateBranding",\s*\(ctx, now\) => updateBrandingCore\(db, ctx, input, now, \{ blobHost: env\.BLOB_ENABLED \? publicBlobHost\(env\.BLOB_READ_WRITE_TOKEN\) : null \}\),\s*\{ publicPage: true \},\s*\);/,
  );
  assert.doesNotMatch(pro, /\brequirePro\b/, "every pro write of this file goes through runProAction");
  assert.doesNotMatch(pro, /revalidatePath\(`\//, "the public pages are revalidated by their route pattern (runProAction)");
});

test("createProfessionalProfile writes through its core (one batch), and the onboarding form shows a refusal", () => {
  const body = bodyOf(source("src/server/pro.ts"), "createProfessionalProfile");
  assert.match(body, /const res = await createProfessionalProfileCore\(db, user\.id, input\);/);
  assert.match(body, /if \(!res\.ok\) return res;/);
  assert.doesNotMatch(body, /db\.(insert|update|delete)\(/, "no statement of its own");
  const form = source("src/components/onboarding-form.tsx");
  assert.match(form, /const res = await createProfessionalProfile\(\{/);
  assert.match(form, /if \(res && !res\.ok\) setError\(res\.error\);/);
});

test("the address and branding forms cannot throw into React and leave the refresh to the action's revalidation", () => {
  const slug = source("src/components/dashboard/slug-editor.tsx");
  assert.match(slug, /const res = await callOrFail\(\(\) => updateSlug\(\{ slug: draft \}\)\);/);
  const brand = source("src/components/dashboard/branding-form.tsx");
  assert.match(brand, /const res = await callOrFail\(\(\) =>\s*updateBranding\(\{/);
  const save = brand.slice(brand.indexOf("function save()"), brand.indexOf("const tabBtn"));
  assert.ok(save.indexOf("if (!res.ok)") !== -1 && save.indexOf("if (!res.ok)") < save.indexOf("setSaved(true)"), "« Enregistré » only once saved");
  assert.match(save, /setError\(res\.error\)/);
  for (const [file, text] of [["slug-editor", slug], ["branding-form", brand]] as const) {
    assert.doesNotMatch(text, /router\.refresh\(\)|useRouter/, `${file}: no router.refresh() after an action`);
  }
  // The upload answer is read without throwing: a body that is not JSON is an upload failure, not an unhandled rejection.
  assert.doesNotMatch(brand, /\(await res\.json\(\)\) as/);
});

// P6 A40: the shared regions, always mounted so a screen reader hears the text when it comes, and no check-mark glyph.
test("the address and branding forms say « saved » through SavedStatus and fail through an always-mounted FormError (P6 A40)", () => {
  const slug = source("src/components/dashboard/slug-editor.tsx");
  const brand = source("src/components/dashboard/branding-form.tsx");
  for (const [file, text] of [["slug-editor", slug], ["branding-form", brand]] as const) {
    assert.doesNotMatch(text, /✓/, `${file}: no check-mark glyph`);
    assert.match(text, /import \{ SavedStatus \} from "@\/components\/dashboard\/saved-status";/, file);
    assert.match(text, /import \{ FormError \} from "@\/components\/dashboard\/form-error";/, file);
    assert.match(text, /<FormError alwaysMounted message=\{error\} \/>/, `${file}: its failure line stays mounted`);
    assert.doesNotMatch(text, /role="(?:status|alert)"/, `${file}: the shared components carry the live regions`);
    assert.equal(text.split("<SavedStatus").length - 1, 1, `${file}: one status region`);
  }
  // The address editor swaps its row for a form: the status sits after that switch, in the one returned tree, so it is
  // the same region in both modes and is never inserted together with its text.
  assert.match(slug, /\)\}\s*<SavedStatus saved=\{saved && !editing\} message="Adresse mise à jour" \/>\s*<\/div>\s*\);\s*\}\s*$/);
  assert.equal(slug.split("\n  return (").length - 1, 1, "one return");
  assert.match(brand, /<SavedStatus saved=\{saved && !dirty\} \/>/);
});
