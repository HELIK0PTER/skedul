/**
 * Copy guard (decision 38): no em dash (U+2014) and no en dash (U+2013) in the
 * files that carry P3 UI text, e-mails or Google bodies, comments included.
 * Run from the repository root: the paths are relative to process.cwd().
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

/** Always scanned: these directories exist from P3 on. */
const DIRECTORIES = ["src/components/dashboard", "src/app/dashboard", "src/lib/back-office", "src/lib/emails"];

/** Scanned when they exist (a directory is walked); later tasks create most of them. */
const OPTIONAL = [
  "src/lib/pro-messages.ts",
  "src/lib/zod-fr.ts",
  "src/lib/google-event.ts",
  "src/lib/email-layout.ts",
  "src/components/public/customer-space.tsx",
  "src/app/[slug]/espace",
  "src/app/admin/activity/page.tsx",
  "src/components/admin/app-health-card.tsx",
  "src/components/admin/delete-user-card.tsx",
];

/** 1-based numbers of the lines holding a dash (LF or CRLF). */
function dashLines(text: string): number[] {
  const lines: number[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (DASH.test(line)) lines.push(index + 1);
  });
  return lines;
}

/** Every .ts / .tsx file under `path` (a file or a directory), tests excluded. */
function collect(path: string, out: string[]): void {
  const full = join(process.cwd(), path);
  if (!existsSync(full)) return;
  if (statSync(full).isDirectory()) {
    for (const name of readdirSync(full).sort()) collect(`${path}/${name}`, out);
    return;
  }
  if (/\.tsx?$/.test(path) && !/\.test\.ts$/.test(path)) out.push(path);
}

test("dashLines reports the lines holding an em dash or an en dash, LF or CRLF", () => {
  const em = String.fromCharCode(0x2014);
  const en = String.fromCharCode(0x2013);
  assert.deepEqual(dashLines(["a", `b ${em} b`, "c", `d ${en} d`].join("\n")), [2, 4]);
  assert.deepEqual(dashLines(["a", `b ${em}`].join("\r\n")), [2]);
  assert.deepEqual(dashLines("a - b : c"), []);
});

test("the directories that must be scanned exist and hold source files", () => {
  for (const dir of DIRECTORIES) {
    const files: string[] = [];
    collect(dir, files);
    assert.ok(files.length > 0, `${dir} holds no .ts or .tsx file`);
  }
});

test("no em dash or en dash in the P3 UI, e-mail and copy files (comments included)", () => {
  const files: string[] = [];
  for (const path of [...DIRECTORIES, ...OPTIONAL]) collect(path, files);
  const hits: string[] = [];
  for (const file of files) {
    for (const line of dashLines(readFileSync(join(process.cwd(), file), "utf8"))) hits.push(`${file}:${line}`);
  }
  assert.deepEqual(hits, [], `dashes found:\n${hits.join("\n")}`);
});
