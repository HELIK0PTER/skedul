/**
 * Copy guard (decision 38, extended by P4 Task 1): no em dash (U+2014) and no en
 * dash (U+2013) in the files that carry UI text, e-mails or Google bodies, and in
 * the P4 public, payment and identity code, comments included.
 * Run from the repository root: the paths are relative to process.cwd().
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

/**
 * Always scanned: these directories exist from P3 on. The admin space and the
 * public pages are walked whole, so a new file there is covered at once.
 */
const DIRECTORIES = [
  "src/components/dashboard",
  "src/app/dashboard",
  "src/lib/back-office",
  "src/lib/emails",
  "src/app/admin",
  "src/components/admin",
  "src/app/[slug]",
  "src/components/public",
];

/**
 * Scanned when they exist (a file, or a directory walked whole). P4 creates most of
 * the paths below task by task, and the ones it only modifies are scanned from Task 1
 * on, because their strings and comments become client copy.
 */
const OPTIONAL = [
  "src/lib/pro-messages.ts",
  "src/lib/zod-fr.ts",
  "src/lib/google-event.ts",
  "src/lib/email-layout.ts",
  "src/lib/admin-metrics.ts",
  "src/lib/auth-admin.ts",
  // P4: public pages' logic, payments, identity and the client-facing server code
  "src/lib/public",
  "src/lib/payments",
  "src/lib/client-ip.ts",
  "src/lib/cron-auth.ts",
  "src/lib/auth-messages.ts",
  "src/components/auth/email-code-form.tsx",
  "src/components/auth/otp-dialog.tsx",
  "src/components/auth/client-sign-in-choices.tsx",
  "src/components/auth/link-google-form.tsx",
  "src/app/mon-espace",
  "src/app/api/mock-checkout",
  "src/app/api/stripe",
  "src/app/api/cron",
  "src/server/public.ts",
  "src/server/client.ts",
  "src/server/public-context.ts",
  "src/server/public-queries.ts",
  "src/server/visitor.ts",
  // existing files whose strings or comments P4 adds or turns into client copy (COV-I13)
  "src/lib/notify-core.ts",
  "src/lib/notify-run.ts",
  "src/lib/tickets-vocab.ts",
  "src/lib/oauth-errors.ts",
  "src/lib/entry.ts",
  "src/server/entry.ts",
  "src/app/(auth)/sign-in",
  "src/components/auth/auth-form.tsx",
  "src/components/ui/dialog.tsx",
  "src/lib/stripe.ts",
  "src/lib/email.ts",
  "src/lib/throttle.ts",
  "src/lib/env.ts",
  "src/lib/same-origin.ts",
  "src/app/api/c",
  "vercel.ts",
  "next.config.ts",
  "src/lib/booking/wallet.ts",
  "src/lib/booking/claims.ts",
  "src/lib/booking/fulfillment.ts",
  "src/lib/booking/release.ts",
  "src/lib/booking/nightly.ts",
  // revision 2: the boot checks
  "src/lib/env-checks.ts",
  // revision 3: files P4 modifies outside the walked directories
  "src/lib/auth-options.ts",
  "src/server/pro.ts",
  "src/server/pro-context.ts",
  "src/server/pro-clients.ts",
  "src/server/client-queries.ts",
  "src/server/notify.ts",
  "src/lib/auth.ts",
  "src/components/auth/forgot-password-form.tsx",
  // the shared P4 test helper (Task 5 creates it, Task 7 extends it)
  "src/test/public.ts",
  // Task 31: the root metadata, whose default title is the tab title of every page that sets none (the root 404)
  "src/app/layout.tsx",
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

/** Every file the scan walks: the always-walked directories, then the optional paths that exist. */
function scannedFiles(): string[] {
  const files: string[] = [];
  for (const path of [...DIRECTORIES, ...OPTIONAL]) collect(path, files);
  return files;
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

test("the scan covers the existing files P4 turns into client copy (COV-I13)", () => {
  const scanned = new Set(scannedFiles());
  for (const file of [
    "src/lib/auth-messages.ts",
    "src/lib/auth-options.ts",
    "src/lib/auth.ts",
    "src/lib/entry.ts",
    "src/lib/env.ts",
    "src/lib/email.ts",
    "src/lib/notify-core.ts",
    "src/lib/oauth-errors.ts",
    "src/lib/stripe.ts",
    "src/lib/throttle.ts",
    "src/lib/tickets-vocab.ts",
    "src/lib/booking/claims.ts",
    "src/lib/booking/fulfillment.ts",
    "src/lib/booking/nightly.ts",
    "src/lib/booking/release.ts",
    "src/lib/booking/wallet.ts",
    "src/server/client-queries.ts",
    "src/server/entry.ts",
    "src/server/notify.ts",
    "src/server/pro.ts",
    "src/server/pro-clients.ts",
    "src/server/pro-context.ts",
    "src/components/auth/auth-form.tsx",
    "src/components/auth/forgot-password-form.tsx",
    "src/components/auth/link-google-form.tsx",
    "src/components/ui/dialog.tsx",
    "src/app/(auth)/sign-in/page.tsx",
    "src/app/api/c/[token]/route.ts",
    "src/app/api/mock-checkout/route.ts",
    "src/app/api/stripe/webhook/route.ts",
    "vercel.ts",
    "next.config.ts",
    "src/app/layout.tsx",
  ]) {
    assert.ok(scanned.has(file), `${file} is not scanned`);
  }
  // Not created yet (Task 5 creates it): listed ahead of time, so it is scanned the moment it exists.
  assert.ok(OPTIONAL.includes("src/test/public.ts"), "src/test/public.ts is not listed in OPTIONAL");
});

test("OPTIONAL lists no path twice and no path the always-walked directories already hold", () => {
  assert.equal(new Set(OPTIONAL).size, OPTIONAL.length, "a path is listed twice");
  for (const path of OPTIONAL) {
    const inside = DIRECTORIES.find((dir) => path === dir || path.startsWith(`${dir}/`));
    assert.equal(inside, undefined, `${path} is already walked through ${inside}`);
  }
});

test("no em dash or en dash in the UI, e-mail, copy and P4 public code files (comments included)", () => {
  const hits: string[] = [];
  for (const file of scannedFiles()) {
    for (const line of dashLines(readFileSync(join(process.cwd(), file), "utf8"))) hits.push(`${file}:${line}`);
  }
  assert.deepEqual(hits, [], `dashes found:\n${hits.join("\n")}`);
});
