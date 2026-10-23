import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

import nextConfig from "../../next.config";

// Next compiles every `source` with its own copy of path-to-regexp: the test matches paths the way the router does.
const requireFromRoot = createRequire(join(process.cwd(), "package.json"));
const { pathToRegexp } = requireFromRoot("next/dist/compiled/path-to-regexp") as { pathToRegexp: (source: string) => RegExp };

type Rule = { source: string };
const matches = (rules: readonly Rule[], path: string): boolean => rules.some((rule) => pathToRegexp(rule.source).test(path));

const FRAMED = [
  "/altinha-paris",
  "/altinha-paris/seance/abc123",
  "/altinha-paris/offre/o1",
  "/altinha-paris/merci",
  "/altinha-paris/espace",
  "/altinha-paris/book/x",
  "/mon-espace",
  "/apiary",
  "/apiary/seance/x",
];
const LEFT_ALONE = [
  "/api/stripe/webhook",
  "/api/mock-checkout",
  "/api/c/token",
  "/api/cron/daily",
  "/api",
  "/_next/static/chunks/a.js",
  "/_next/image",
  "/",
];

test("headers: the public pages refuse framing with both headers, the API and the assets are left to their own", async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    assert.deepEqual(rule.headers, [
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "X-Frame-Options", value: "DENY" },
    ]);
  }
  for (const path of FRAMED) assert.equal(matches(rules, path), true, `${path} must refuse framing`);
  for (const path of LEFT_ALONE) assert.equal(matches(rules, path), false, `${path} must not get the headers twice`);
});

test("headers: /mon-espace has a rule of its own", async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  assert.equal(rules.some((rule) => rule.source === "/mon-espace"), true);
});

test("redirects: the old booking and pack URLs move for good to the public page", async () => {
  const rules = (await nextConfig.redirects?.()) ?? [];
  assert.deepEqual(
    rules.map((rule) => [rule.source, rule.destination, "permanent" in rule ? rule.permanent : null]),
    [
      ["/:slug([a-z0-9-]{1,60})/book/:path*", "/:slug", true],
      ["/:slug([a-z0-9-]{1,60})/pack/:path*", "/:slug", true],
    ],
  );
  for (const path of ["/altinha-paris/book/x", "/altinha-paris/book", "/altinha-paris/pack/y/z"]) {
    assert.equal(matches(rules, path), true, path);
  }
  for (const path of ["/altinha-paris", "/altinha-paris/seance/x", "/altinha-paris/espace", "/altinha-paris/offre/book"]) {
    assert.equal(matches(rules, path), false, path);
  }
});

test("redirects: only a slug-shaped segment is copied into the Location header (no open redirect)", async () => {
  const rules = (await nextConfig.redirects?.()) ?? [];
  // An encoded slash or backslash, a dot or a colon never reaches the destination: such a segment is not a slug, the
  // config leaves it to the page (which encodes it) and to the layout (which answers 404 for an unknown pro).
  for (const path of ["/%2F%2Fevil.com/book/x", "/%5Cevil.com/pack/y", "/evil.com/book/x", "/a:b/book/x", "/" + "a".repeat(61) + "/book/x"]) {
    assert.equal(matches(rules, path), false, path);
  }
});
