/**
 * Marketing copy guard (P6 C10): the landing, its header and footer, the root metadata and the guided tour (/demo)
 * speak the tickets vocabulary only (tickets, offres, carnets, séances, événements, rendez-vous). No « pack »,
 * « crédit » or « prestation » in them, comments and identifiers included, so that a v1 word cannot come back
 * through a shot, a caption, a deep link or a sample constant.
 *
 * Left out on purpose:
 * - test files: they quote the v1 ids and words they forbid (demo-script.test.ts lists the old step ids);
 * - the avatar « pack » kind (src/lib/avatar.ts, the branding form): a picture style of the 3D gallery, not the v1
 *   product. A quoted "pack" literal is stripped before the match, should a scanned file ever show that avatar;
 * - the v1 redirect routes (src/app/[slug]/pack, src/app/[slug]/book) and next.config.ts: they exist to send the
 *   old links to the new pages, outside the marketing pages.
 *
 * Run from the repository root: the paths are relative to process.cwd().
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/** The marketing pages and their chrome. A directory stands for everything under it. */
const SCOPE = [
  "src/app/page.tsx",
  "src/app/layout.tsx",
  "src/components/site-header.tsx",
  "src/components/site-footer.tsx",
  "src/components/landing",
  "src/components/demo",
  "src/app/demo",
];

/** The v1 words: a word start (no letter before), any case, accented or not, plural and verb forms included. */
const V1_WORD = /(?<![a-z])(?:packs?(?![a-z])|cr[eé]dit|prestation)/giu;

/** The avatar kind literal, the one « pack » the scope may hold. */
const AVATAR_KIND = /(["'`])pack\1/g;

/** The v1 words of `line`, the avatar kind literal left out. */
function v1Words(line: string): string[] {
  return line.replace(AVATAR_KIND, "").match(V1_WORD) ?? [];
}

/** Every .ts, .tsx and .css file under `path` (a file or a directory), test files left out. */
function collect(path: string, out: string[]): void {
  const full = join(process.cwd(), path);
  if (!existsSync(full)) return;
  if (statSync(full).isDirectory()) {
    for (const name of readdirSync(full).sort()) collect(`${path}/${name}`, out);
    return;
  }
  if (/\.(tsx?|css)$/.test(path) && !/\.test\.tsx?$/.test(path)) out.push(path);
}

function scannedFiles(): string[] {
  const files: string[] = [];
  for (const path of SCOPE) collect(path, files);
  return files;
}

test("v1Words finds pack, crédit and prestation in any form, and nothing inside another word", () => {
  assert.deepEqual(v1Words("Packs prépayés"), ["Packs"]);
  assert.deepEqual(v1Words("un pack de 10 heures"), ["pack"]);
  assert.deepEqual(v1Words('step="buy-pack"'), ["pack"]);
  assert.deepEqual(v1Words("const DEMO_PACK = 1;"), ["PACK"]);
  assert.deepEqual(v1Words("1 crédit restant, 2 crédits, vos credits"), ["crédit", "crédit", "credit"]);
  assert.deepEqual(v1Words("Crédité sur votre compte"), ["Crédit"]);
  assert.deepEqual(v1Words("creditsRemaining"), ["credit"]);
  assert.deepEqual(v1Words("Vos prestations"), ["prestation"]);
  for (const clean of ["package.json", "packages", "unpack", "Impacts", "accréditation", "un carnet de tickets"]) {
    assert.deepEqual(v1Words(clean), [], clean);
  }
});

test("v1Words leaves the avatar kind literal alone, and only that literal", () => {
  assert.deepEqual(v1Words('avatarKind === "pack"'), []);
  assert.deepEqual(v1Words("kind: 'pack'"), []);
  assert.deepEqual(v1Words('kind: "pack", label: "Pack 3D"'), ["Pack"]);
});

test("the scan covers the landing, its chrome, the metadata and the tour, and leaves the tests and the redirects out", () => {
  for (const path of SCOPE) assert.ok(existsSync(join(process.cwd(), path)), `${path} does not exist: fix the scope`);
  const scanned = new Set(scannedFiles());
  for (const file of [
    "src/app/page.tsx",
    "src/app/layout.tsx",
    "src/components/site-header.tsx",
    "src/components/site-footer.tsx",
    "src/components/landing/hero-deck.tsx",
    "src/components/landing/landing.module.css",
    "src/components/demo/demo-data.ts",
    "src/components/demo/demo-script.ts",
    "src/components/demo/screens/pro-tickets.tsx",
    "src/app/demo/page.tsx",
  ]) {
    assert.ok(scanned.has(file), `${file} is not scanned`);
  }
  for (const file of scanned) {
    assert.ok(!/\.test\.tsx?$/.test(file), `${file} is a test file`);
    assert.ok(!file.startsWith("src/app/[slug]/"), `${file} is redirect code`);
  }
});

test("no pack, crédit or prestation in the marketing pages, the metadata or the tour (comments included)", () => {
  const hits: string[] = [];
  for (const file of scannedFiles()) {
    readFileSync(join(process.cwd(), file), "utf8")
      .split(/\r?\n/)
      .forEach((line, index) => {
        const words = v1Words(line);
        if (words.length > 0) hits.push(`${file}:${index + 1} ${words.join(", ")}`);
      });
  }
  assert.deepEqual(hits, [], `v1 words found:\n${hits.join("\n")}`);
});
