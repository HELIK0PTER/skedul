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
import { posix } from "node:path";
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
  /\b(PublicPageProfile|PublicPage|PublicPageRow|PublicPro|PublicProfileRow|publicProOfRow|publicPageProfileOfRow|getPublicPage|getPublicPageProfile|getPublicProfile|readPublicPage|readPublicProfile|PUBLIC_PROFILE_COLUMNS|ownerUserId|stripeAccountId|googleCalendarId)\b/;

/** True when the source starts with the `"use client"` directive (comments may come first). */
function isClientSource(source: string): boolean {
  return /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*["']use client["']/.test(source);
}

/**
 * The `@/` form of a module specifier written in the file at `path`: an alias stays as it is, a relative specifier is
 * resolved against the file's folder (`../../server/queries` from `src/components/public/a.tsx` is `@/server/queries`),
 * without a `.ts` / `.tsx` extension or an `/index` tail; a package, or a path that leaves `src`, is null (G4b).
 */
function aliasOf(specifier: string, path: string): string | null {
  let target: string;
  if (specifier.startsWith("@/")) target = specifier;
  else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const resolved = posix.normalize(posix.join(posix.dirname(path), specifier));
    if (!resolved.startsWith("src/")) return null;
    target = `@/${resolved.slice("src/".length)}`;
  } else return null;
  return target.replace(/\.(?:tsx?|jsx?)$/, "").replace(/\/index$/, "");
}

/** Every module specifier of a source: static imports and re-exports (`from "x"`), side-effect imports, dynamic `import("x")`. */
function specifiersOf(source: string): string[] {
  return [
    ...[...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]),
    ...[...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
}

/**
 * Why this client source could hold or receive the professional's row; empty when it cannot. `path` (repository
 * relative, forward slashes) resolves its relative specifiers: one rule whatever the spelling of the import (G4b). The
 * server modules a client component may import are its Server Actions (`@/server/public`, `@/server/pro`, ...) and the
 * types of `@/server/support-queries`, so the refused list names the read modules, not the whole folder.
 */
function profileLeaksOf(source: string, path = "src/components/x.tsx"): string[] {
  const leaks: string[] = [];
  for (const specifier of specifiersOf(source)) {
    const alias = aliasOf(specifier, path);
    if (alias !== null && SERVER_ONLY_SPECIFIERS.includes(alias)) {
      leaks.push(alias === specifier ? `imports ${specifier}` : `imports ${specifier} (${alias})`);
    }
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

test("the guard resolves a relative specifier and reads a dynamic import or a re-export, whatever the spelling (G4b)", () => {
  const at = "src/components/public/leaf.tsx";
  assert.deepEqual(profileLeaksOf('"use client";\nimport { x } from "../../server/public-queries";', at), [
    "imports ../../server/public-queries (@/server/public-queries)",
  ]);
  assert.deepEqual(profileLeaksOf('"use client";\nimport type { A } from "../../lib/public/context.ts";', at), [
    "imports ../../lib/public/context.ts (@/lib/public/context)",
  ]);
  assert.deepEqual(profileLeaksOf('"use client";\nimport { r } from "./profile-reads";', "src/lib/public/leaf.tsx"), [
    "imports ./profile-reads (@/lib/public/profile-reads)",
  ]);
  assert.deepEqual(profileLeaksOf('"use client";\nconst m = await import("@/server/queries");', at), ["imports @/server/queries"]);
  assert.deepEqual(profileLeaksOf('"use client";\nconst m = await import( "../../server/client-queries" );', at), [
    "imports ../../server/client-queries (@/server/client-queries)",
  ]);
  assert.deepEqual(profileLeaksOf('"use client";\nexport { db } from "@/lib/db/schema";', at), ["imports @/lib/db/schema"]);
  assert.deepEqual(profileLeaksOf('"use client";\nimport "../../server/public-context";', at), [
    "imports ../../server/public-context (@/server/public-context)",
  ]);
  // A Server Action module, a sibling component and a package stay allowed, however they are spelt.
  assert.deepEqual(
    profileLeaksOf(
      '"use client";\nimport { a } from "../../server/public";\nimport { B } from "./b";\nimport { useState } from "react";\nconst c = await import("../ui/button");',
      at,
    ),
    [],
  );
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
    assert.deepEqual(profileLeaksOf(readFileSync(path, "utf8"), path), [], `${path} holds or receives the professional's row`);
  }
});

test("the page profile is built from the selected columns only, and the page reads it through the wrapper (G4a, G4b)", () => {
  const queries = readFileSync("src/server/public-queries.ts", "utf8");
  assert.match(queries, /export const getPublicPage = cache\(/);
  assert.match(queries, /const found = await readPublicPage\(db, slug\);/, "the tested core");
  assert.match(queries, /found\.suspended \? \{ suspended: true \} : \{ suspended: false, \.\.\.publicPageProfileOfRow\(found\.row\) \}/);
  assert.doesNotMatch(queries, /\b(?:getPublicPageProfile|publicPageExists)\b/, "the two reads it replaced are gone");
  const queriesTs = readFileSync("src/server/queries.ts", "utf8");
  assert.match(queriesTs, /readPublicProfile\(db, slug, opts\)/, "getPublicProfile is the thin wrapper of the tested read");
  assert.doesNotMatch(queriesTs.slice(queriesTs.indexOf("export async function getPublicProfile")), /\.select\(\{ pro: professional \}\)/, "no whole-row select");
});
