/**
 * Copy guard: no em dash (U+2014) and no en dash (U+2013) in any .ts or .tsx file
 * under src/, tests, fixtures and comments included, except the short ALLOWLIST
 * below, where every entry says why it is left out.
 *
 * History: decision 38 started it on the back-office copy, P4 Task 1 widened it to
 * the public, payment and identity code, P5 Task 1 to the whole of src/ (P3OUT:115,
 * LED:457: components/{ui,auth,support}, lib/* and layout.tsx were not covered).
 *
 * Out of the scan on purpose:
 * - `.css` files hold no copy (comments and `content: ""` only);
 * - `.sql` migrations are applied history, never edited, and hold no copy either.
 *
 * Run from the repository root: the paths are relative to process.cwd().
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

/** The root the scan walks whole. */
const ROOT = "src";

/** Outside src/ but scanned since P4 Task 1 (their strings reach headers and the deploy config). */
const ROOT_FILES = ["vercel.ts", "next.config.ts"];

/**
 * Left out of the scan (a file, or a directory with everything under it). Keep it
 * short: an entry needs a reason, must exist and must still hold a dash, so the
 * entry goes away with the last dash it excuses. Empty since P6 C9: the /demo tour
 * (src/app/demo, src/components/demo), its last entries, was rewritten without a dash.
 */
const ALLOWLIST: readonly { path: string; why: string }[] = [];

/**
 * The P5 « RDV libre » paths: always scanned the moment they exist, never allowlisted.
 * A directory stands for everything under it.
 */
const P5_PATHS = [
  "src/lib/availability.ts",
  "src/lib/availability.test.ts",
  "src/lib/slots.ts",
  "src/lib/slots.db.test.ts",
  "src/lib/public/rdv-view.ts",
  "src/lib/public/rdv-form.ts",
  "src/lib/public/rdv-reads.ts",
  "src/lib/public/rdv-actions.ts",
  "src/lib/public/rdv-actions.db.test.ts",
  "src/app/[slug]/rdv",
  "src/components/public/rdv-booking.tsx",
  "src/components/public/rdv-cards.tsx",
  "src/lib/booking/claims.ts",
  "src/lib/booking/catalog.ts",
  "src/lib/booking/wallet.ts",
  "src/lib/back-office/catalog-actions.ts",
  "src/lib/tickets-vocab.ts",
  "src/lib/public/messages.ts",
];

/** 1-based numbers of the lines holding a dash (LF or CRLF). */
function dashLines(text: string): number[] {
  const lines: number[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (DASH.test(line)) lines.push(index + 1);
  });
  return lines;
}

/** True when `file` is `path` itself or sits under the directory `path`. */
function within(file: string, path: string): boolean {
  return file === path || file.startsWith(`${path}/`);
}

/** The allowlist entry that leaves `file` out, if any. */
function allowedBy(file: string): string | undefined {
  return ALLOWLIST.find((entry) => within(file, entry.path))?.path;
}

/** Every .ts / .tsx file under `path` (a file or a directory), tests included. */
function collect(path: string, out: string[]): void {
  const full = join(process.cwd(), path);
  if (!existsSync(full)) return;
  if (statSync(full).isDirectory()) {
    for (const name of readdirSync(full).sort()) collect(`${path}/${name}`, out);
    return;
  }
  if (/\.tsx?$/.test(path)) out.push(path);
}

/** Every .ts / .tsx file under src/ (the allowlist left out), then the root files. */
function scannedFiles(): string[] {
  const files: string[] = [];
  collect(ROOT, files);
  return [...files.filter((file) => allowedBy(file) === undefined), ...ROOT_FILES];
}

test("dashLines reports the lines holding an em dash or an en dash, LF or CRLF", () => {
  const em = String.fromCharCode(0x2014);
  const en = String.fromCharCode(0x2013);
  assert.deepEqual(dashLines(["a", `b ${em} b`, "c", `d ${en} d`].join("\n")), [2, 4]);
  assert.deepEqual(dashLines(["a", `b ${em}`].join("\r\n")), [2]);
  assert.deepEqual(dashLines("a - b : c"), []);
});

test("within and allowedBy match a file or a whole directory, never a name prefix", () => {
  assert.equal(within("src/app/demo/page.tsx", "src/app/demo"), true);
  assert.equal(within("src/app/demo", "src/app/demo"), true);
  assert.equal(within("src/app/demonstration/page.tsx", "src/app/demo"), false);
  // Nothing is allowlisted any more: the demo tour is scanned like the rest of src/.
  assert.equal(allowedBy("src/components/demo/demo-data.ts"), undefined);
  assert.equal(allowedBy("src/app/demo/page.tsx"), undefined);
  assert.equal(allowedBy("src/components/public/rdv-booking.tsx"), undefined);
});

test("the scan walks the whole of src/, tests and the folders earlier phases left out included", () => {
  const scanned = new Set(scannedFiles());
  for (const file of [
    // P3OUT:115 and LED:457: components/{ui,auth,support}, lib/* and layout.tsx
    "src/components/ui/button.tsx",
    "src/components/ui/dialog.tsx",
    "src/components/auth/auth-form.tsx",
    "src/lib/availability.ts",
    "src/lib/booking/claims.ts",
    "src/lib/booking/catalog.ts",
    "src/lib/db/schema.ts",
    "src/lib/calendar-grid.ts",
    "src/app/layout.tsx",
    // the paths P4 listed by hand (COV-I13)
    "src/lib/tickets-vocab.ts",
    "src/lib/public/messages.ts",
    "src/server/public.ts",
    "src/server/analytics-salt.ts",
    "src/app/api/mock-checkout/route.ts",
    "src/lib/notify-core.ts",
    "vercel.ts",
    "next.config.ts",
    // the /demo tour, allowlisted until P6 C9
    "src/app/demo/page.tsx",
    "src/components/demo/demo-script.ts",
    "src/components/demo/demo-data.ts",
    "src/components/demo/screens/client-page.tsx",
    // tests and helpers are scanned too
    "src/lib/ui-copy.test.ts",
    "src/lib/booking/rdv.db.test.ts",
    "src/test/db.ts",
  ]) {
    assert.ok(scanned.has(file), `${file} is not scanned`);
  }
  const support = [...scanned].filter((file) => within(file, "src/components/support"));
  assert.ok(support.length > 0, "src/components/support is not scanned");
});

test("the allowlist is short, every entry exists, has a reason and still excuses a dash", () => {
  assert.ok(ALLOWLIST.length <= 6, "the allowlist grew past six entries: fix the dashes instead");
  const paths = ALLOWLIST.map((entry) => entry.path);
  assert.equal(new Set(paths).size, paths.length, "a path is listed twice");
  for (const { path, why } of ALLOWLIST) {
    assert.ok(why.trim().length > 20, `${path} has no reason`);
    assert.ok(path.startsWith(`${ROOT}/`), `${path} is not under ${ROOT}/`);
    assert.ok(existsSync(join(process.cwd(), path)), `${path} does not exist: remove its entry`);
    // A broad entry would hide whole layers: never a top-level folder of src/.
    assert.ok(!["src/app", "src/components", "src/lib", "src/server", "src/test"].includes(path), `${path} is too broad`);
    const files: string[] = [];
    collect(path, files);
    const dashed = files.filter((file) => dashLines(readFileSync(join(process.cwd(), file), "utf8")).length > 0);
    assert.ok(dashed.length > 0, `${path} holds no dash any more: remove its entry`);
  }
});

test("no P5 path is allowlisted, and the P5 paths that exist are scanned", () => {
  const scanned = new Set(scannedFiles());
  for (const path of P5_PATHS) {
    const covering = ALLOWLIST.find((entry) => within(path, entry.path) || within(entry.path, path));
    assert.equal(covering, undefined, `${path} is allowlisted through ${covering?.path}`);
    const files: string[] = [];
    collect(path, files);
    for (const file of files) assert.ok(scanned.has(file), `${file} is not scanned`);
  }
});

test("no em dash or en dash in any scanned .ts or .tsx file under src/ (comments included)", () => {
  const hits: string[] = [];
  for (const file of scannedFiles()) {
    for (const line of dashLines(readFileSync(join(process.cwd(), file), "utf8"))) hits.push(`${file}:${line}`);
  }
  assert.deepEqual(hits, [], `dashes found:\n${hits.join("\n")}`);
});
