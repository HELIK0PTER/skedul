/**
 * Source guard for the professional's private columns (G4a, Item 1; Global Constraints « Rendering and caching »: client
 * component props never carry `professional.userId`, `stripeAccountId`, `googleCalendarId` or the booking settings
 * row). The public page holds a projection (`PublicPageProfile`, built by `publicPageProfileOfRow` from the columns
 * `readPublicProfile` selects); this guard keeps the projection, its readers and the row's private names out of every
 * `"use client"` file, wherever it lives, so it needs no path and bites with the first component that breaks it.
 * Pure: no database, no env. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { codeView, sourceFilesUnder } from "@/test/source-guards";

/** The modules a client component never imports: the readers and the types of the professional's public row. */
const SERVER_ONLY_SPECIFIERS = [
  "@/lib/public/context",
  "@/lib/public/profile-reads",
  "@/server/public-queries",
  "@/server/public-context",
  "@/server/queries",
  "@/server/client-queries",
  "@/lib/db/schema",
];

/** The names of the projection, its mapper and its readers, and the private columns of the professional row. */
const PRIVATE_NAMES =
  /\b(PublicPageProfile|PublicPro|PublicProfileRow|publicProOfRow|publicPageProfileOfRow|getPublicPageProfile|getPublicProfile|readPublicProfile|PUBLIC_PROFILE_COLUMNS|ownerUserId|stripeAccountId|googleCalendarId)\b/;

/** True when the source starts with the `"use client"` directive (comments may come first). */
function isClientSource(source: string): boolean {
  return /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*["']use client["']/.test(source);
}

/** Why this client source could hold or receive the professional's row; empty when it cannot. */
function profileLeaksOf(source: string): string[] {
  const leaks: string[] = [];
  for (const m of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    if (SERVER_ONLY_SPECIFIERS.includes(m[1])) leaks.push(`imports ${m[1]}`);
  }
  const named = PRIVATE_NAMES.exec(codeView(source));
  if (named) leaks.push(`names ${named[1]}`);
  return leaks;
}

test("the guard can fail: it names an import of the profile modules and a private name of the row", () => {
  assert.deepEqual(profileLeaksOf('"use client";\nimport type { PublicPro } from "@/lib/public/context";'), ["imports @/lib/public/context", "names PublicPro"]);
  assert.deepEqual(profileLeaksOf('"use client";\nimport { db } from "@/lib/db/schema";'), ["imports @/lib/db/schema"]);
  assert.deepEqual(profileLeaksOf('"use client";\nexport function A({ stripeAccountId }: { stripeAccountId: string }) { return null; }'), ["names stripeAccountId"]);
  assert.deepEqual(profileLeaksOf('"use client";\nconst x = props.ownerUserId;'), ["names ownerUserId"]);
});

test("the guard lets a client component through that takes picked strings and prose that names the columns", () => {
  const picked = [
    '"use client";',
    'import { Button } from "@/components/ui/button";',
    "// The page never passes ownerUserId or stripeAccountId.",
    "/* PublicPro */",
    'const note = "googleCalendarId";',
    "export function Leaf({ businessName, brandColor }: { businessName: string; brandColor: string }) { return null; }",
  ].join("\n");
  assert.deepEqual(profileLeaksOf(picked), []);
});

test("isClientSource reads the directive at the top of a file, after comments, and nowhere else", () => {
  assert.equal(isClientSource('"use client";\nimport x from "y";'), true);
  assert.equal(isClientSource("'use client'\nexport const a = 1;"), true);
  assert.equal(isClientSource('// header\n/* more */\n"use client";\nexport const a = 1;'), true);
  assert.equal(isClientSource('import x from "y";\n"use client";'), false);
  assert.equal(isClientSource('export const note = "use client";'), false);
  assert.equal(isClientSource('"use server";\nexport async function a() {}'), false);
});

test("no client component imports the professional's public row, its projection or its readers, or names its private columns (G4a)", () => {
  const clients = sourceFilesUnder("src").filter((path) => isClientSource(readFileSync(path, "utf8")));
  assert.ok(clients.length > 40, `the scan finds the client components (found ${clients.length})`);
  assert.ok(
    clients.some((path) => path.startsWith("src/components/public/")),
    "the public client leaves are among them",
  );
  for (const path of clients) {
    assert.deepEqual(profileLeaksOf(readFileSync(path, "utf8")), [], `${path} holds or receives the professional's row`);
  }
});

test("the page profile is built from the selected columns only, and the page reads it through the wrapper (G4a)", () => {
  const queries = readFileSync("src/server/public-queries.ts", "utf8");
  assert.match(queries, /export const getPublicPageProfile = cache\(/);
  assert.match(queries, /publicPageProfileOfRow\(profile\.pro\)/);
  const queriesTs = readFileSync("src/server/queries.ts", "utf8");
  assert.match(queriesTs, /readPublicProfile\(db, slug, opts\)/, "getPublicProfile is the thin wrapper of the tested read");
  assert.doesNotMatch(queriesTs.slice(queriesTs.indexOf("export async function getPublicProfile")), /\.select\(\{ pro: professional \}\)/, "no whole-row select");
});
