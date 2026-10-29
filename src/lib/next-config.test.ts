import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

import nextConfig from "../../next.config";
import { isReservedSegment, RESERVED_SEGMENTS } from "./analytics";
import { SLUG_PARAM_RE } from "./public/context";

// Next compiles every `source` with its own copy of path-to-regexp and these options (buildCustomRoute in
// node_modules/next/dist/lib/build-custom-route.js): no trailing slash, and NOT case sensitive. The test matches paths
// the way the router does.
const ROUTER_OPTIONS = { strict: true, sensitive: false, delimiter: "/" } as const;
type Options = typeof ROUTER_OPTIONS;
type Matched = false | { params: Record<string, string | string[]> };
const requireFromRoot = createRequire(join(process.cwd(), "package.json"));
const { pathToRegexp, match } = requireFromRoot("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (source: string, keys: unknown[], options: Options) => RegExp;
  match: (source: string, options: Options) => (path: string) => Matched;
};

type Rule = { source: string };
const matches = (rules: readonly Rule[], path: string): boolean =>
  rules.some((rule) => pathToRegexp(rule.source, [], ROUTER_OPTIONS).test(path));

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

/** The top-level URL segments of the app: every folder of src/app but `[slug]`, a route group opened (its folders are top-level URLs). */
function topLevelRoutes(): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync("src/app", { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("[")) continue;
    if (!entry.name.startsWith("(")) {
      routes.push(entry.name);
      continue;
    }
    for (const inner of readdirSync(join("src/app", entry.name), { withFileTypes: true })) {
      if (inner.isDirectory()) routes.push(inner.name);
    }
  }
  return routes.sort();
}

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

test("redirects: the old booking and pack URLs move for good to the public page of their slug", async () => {
  const rules = (await nextConfig.redirects?.()) ?? [];
  assert.equal(rules.length, 2);
  const shapes = rules.map((rule) => /^\/:slug\((.+)\)\/(book|pack)\/:path\*$/.exec(rule.source));
  assert.deepEqual(shapes.map((m) => m?.[2]), ["book", "pack"]);
  assert.equal(shapes[0]?.[1], shapes[1]?.[1], "one slug pattern for both");
  assert.ok(shapes[0]?.[1].endsWith("[a-z0-9-]{1,60}"), "the pattern ends with the alphabet and length of SLUG_PARAM_RE");
  assert.equal(SLUG_PARAM_RE.source, "^[a-z0-9-]{1,60}$");
  for (const rule of rules) {
    assert.equal(rule.destination, "/:slug");
    assert.equal("permanent" in rule ? rule.permanent : null, true, "308");
  }
  for (const path of ["/altinha-paris/book/x", "/altinha-paris/book", "/altinha-paris/pack", "/altinha-paris/pack/y/z"]) {
    const hits = rules.map((rule) => match(rule.source, ROUTER_OPTIONS)(path)).filter((m) => m !== false);
    assert.equal(hits.length, 1, `${path}: one rule`);
    assert.equal(hits[0] && hits[0].params.slug, "altinha-paris", `${path} goes to /altinha-paris`);
  }
  for (const path of ["/altinha-paris", "/altinha-paris/seance/x", "/altinha-paris/espace", "/altinha-paris/offre/book"]) {
    assert.equal(matches(rules, path), false, path);
  }
});

test("redirects: an app route is never taken for a slug, whatever its case: /api/book/x stays a 404 of /api, not a 308 to /api (G4b)", async () => {
  const rules = (await nextConfig.redirects?.()) ?? [];
  const routes = topLevelRoutes();
  assert.ok(routes.length >= 12, `the scan finds the app routes (found ${routes.join(", ")})`);
  for (const segment of routes) {
    assert.equal(isReservedSegment(segment), true, `${segment} is an app route: add it to RESERVED_SEGMENTS (src/lib/analytics.ts)`);
  }
  for (const segment of RESERVED_SEGMENTS) {
    assert.match(segment, /^[a-z0-9_-]+$/, `${segment}: no character the source pattern would read as syntax`);
  }
  for (const path of ["/api/book/x", "/dashboard/pack/x", "/mon-espace/book/x", "/aide/book/x"]) {
    assert.equal(matches(rules, path), false, path);
  }
  for (const segment of new Set([...routes, ...RESERVED_SEGMENTS])) {
    for (const spelled of [segment, segment.toUpperCase()]) {
      for (const rest of ["book", "book/x", "pack", "pack/y/z"]) {
        assert.equal(matches(rules, `/${spelled}/${rest}`), false, `/${spelled}/${rest} is not redirected`);
      }
    }
  }
});

test("redirects: a slug that only starts like an app route is still a slug (the lookahead stops at the end of the segment)", async () => {
  const rules = (await nextConfig.redirects?.()) ?? [];
  for (const path of ["/apiary/book/x", "/aide-paris/pack", "/admins/book", "/sign-in-studio/pack/y", "/demo1/book/x"]) {
    assert.equal(matches(rules, path), true, path);
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
