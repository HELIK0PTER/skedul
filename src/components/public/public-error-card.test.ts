/**
 * Guards for the error boundaries of the app (G4b, Item 5). Boundaries are client components that the node:test runner
 * cannot render, so what they must keep is pinned on their source: every boundary is French, logs the digest Next gives
 * an error and never the error itself (`rawErrorLogs`, the shared guard of `src/test/source-guards.ts`), and the root
 * ones exist, so a failure in a layout (the `[slug]` layout reads the database) never shows Next's English page. Run from
 * the repository root.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { openingTags, rawErrorLogs, sourceFilesUnder } from "@/test/source-guards";

const source = (path: string): string => readFileSync(path, "utf8");
const CARD = "src/components/public/public-error-card.tsx";
const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

/** Every error boundary of the app: `error.tsx` at any depth and the root `global-error.tsx`. */
const BOUNDARIES = sourceFilesUnder("src/app").filter((path) => /(?:^|\/)(?:global-)?error\.tsx$/.test(path));

test("no error boundary logs the error itself: the digest only, read before the console call (rawErrorLogs)", () => {
  assert.ok(BOUNDARIES.length >= 7,`the scan finds the boundaries (found ${BOUNDARIES.length})`);
  for (const path of BOUNDARIES) {
    assert.deepEqual(rawErrorLogs(source(path)), [], `${path} hands a raw error to the console`);
  }
  assert.deepEqual(rawErrorLogs(source(CARD)), [], "the card logs what it is given: the digest");
});

test("the root boundaries exist: error.tsx under the root layout, global-error.tsx with its own <html lang=\"fr\"> and <body>", () => {
  for (const path of ["src/app/error.tsx", "src/app/global-error.tsx"]) {
    assert.ok(existsSync(path), `${path} exists`);
    assert.match(source(path), /^"use client";/, `${path} is a client component (Next requires it)`);
  }
  const global = source("src/app/global-error.tsx");
  // The tags themselves (openingTags reads code only), so a comment that spells them is not them.
  assert.deepEqual(openingTags(global, "html").map((t) => t.text), ['<html lang="fr">']);
  const body = openingTags(global, "body");
  assert.equal(body.length, 1);
  assert.match(body[0].text, /^<body className="[^"]+">$/);
  assert.match(global, /^import "\.\/globals\.css";\r?$/m, "it replaces the root layout, so it brings the global styles itself");
  assert.match(global, /<title>Une erreur est survenue · Skedul<\/title>/, "no metadata export in a client boundary: React's <title>");
});

test("the public boundaries and the root ones render the one PublicErrorCard, with the digest and a retry", () => {
  const users: Record<string, { scope: string; home: boolean }> = {
    "src/app/error.tsx": { scope: "app", home: true },
    "src/app/global-error.tsx": { scope: "global", home: true },
    "src/app/[slug]/error.tsx": { scope: "public", home: false },
    "src/app/[slug]/espace/error.tsx": { scope: "espace", home: false },
  };
  for (const [path, want] of Object.entries(users)) {
    const text = source(path);
    assert.match(text, /^import \{ PublicErrorCard \} from "@\/components\/public\/public-error-card";\r?$/m, `${path} imports the card`);
    const cards = openingTags(text, "PublicErrorCard");
    assert.equal(cards.length, 1, `${path}: one card`);
    const tag = cards[0].text;
    assert.match(tag, new RegExp(`\\sscope="${want.scope}"`), `${path}: its log tag`);
    assert.match(tag, /\sdigest=\{error\.digest\}/, `${path}: the digest, never the error`);
    assert.match(tag, /\sonRetry=\{\(\) => unstable_retry\(\)\}/, `${path}: « Réessayer » re-renders the segment`);
    if (want.home) assert.match(tag, /\shomeHref="\/"/, `${path}: a way back to the home page`);
    else assert.doesNotMatch(tag, /\shomeHref=/, `${path}: no home link inside a pro's pages`);
    assert.doesNotMatch(tag, /\serror=|\{\s*\.\.\./, `${path}: the error object never reaches the card`);
    assert.doesNotMatch(text, /console\./, `${path}: the card logs, the boundary does not`);
  }
});

test("the card is French, takes the digest and nothing of the error, and logs one digest-only line", () => {
  const card = source(CARD);
  assert.match(card, /^"use client";/);
  for (const text of ["Une erreur est survenue", "Cette page n'a pas pu se charger. Réessayez dans un instant.", "Réessayer", "Retour à l'accueil"]) {
    assert.ok(card.includes(text), `the card says: ${text}`);
  }
  const props = /export function PublicErrorCard\(\{([^}]*)\}: \{([^}]*)\}\)/.exec(card);
  assert.ok(props, "the props are destructured with an inline type");
  assert.deepEqual(props[1].split(",").map((s) => s.trim()).filter(Boolean), ["scope", "digest", "onRetry", "homeHref"]);
  assert.match(card, /console\.error\(`\[\$\{scope\}\] page error`, digest \?\? "no digest"\);/);
  assert.equal(card.split("console.").length - 1, 1, "one console line");
  assert.match(card, /role="alert"/);
  assert.match(card, /<h1 className="[^"]+">Une erreur est survenue<\/h1>/, "the card is alone on its page: its title is the page's");
  assert.match(card, /<Link href=\{homeHref\}>Retour à l&apos;accueil<\/Link>|<Link href=\{homeHref\}>\{HOME_LABEL\}<\/Link>/);
});

test("no dash in a boundary or in the card", () => {
  for (const path of [...BOUNDARIES, CARD]) assert.doesNotMatch(source(path), DASH, path);
});
