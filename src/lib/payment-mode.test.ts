/**
 * Source guards for the payment mode helpers (contract § 3.6, Revision 3.2). `PaymentMode` and `paymentModeOf` live in
 * src/lib/payment-mode.ts, a module with no import, because the admin bar chart (a client component) reaches
 * src/lib/admin-metrics.ts at run time and the client boundary forbids any `@/lib/payments/*` module in a client
 * bundle (plan Global Constraints). Run from the repository root.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import test from "node:test";

import { stripeMode } from "@/lib/admin-metrics";
import * as checkout from "@/lib/payments/checkout";

import { paymentModeOf } from "./payment-mode";

/** The source without comments: a sentence in a doc comment is never counted as an import. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every .ts and .tsx source file under `dir`, test files excluded, with forward slashes. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path.replace(/\\/g, "/")] : [];
  });
}

/** True when the file opens with the given directive ("use client" or "use server"). */
function hasDirective(file: string, directive: string): boolean {
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  return new RegExp(`^\\s*["']${directive}["']`).test(text);
}

/** The specifiers a file loads at run time: every `import` and `export ... from`, `import type` and `export type` excluded. */
function runtimeSpecifiers(file: string): string[] {
  const code = codeOf(file);
  const out: string[] = [];
  for (const m of code.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^;]*?\sfrom\s+["']([^"']+)["']/gm)) {
    if (m[1] === undefined) out.push(m[2]);
  }
  for (const m of code.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(m[1]);
  return out;
}

/** The project file a specifier names (`@/x` is src/x), or null for a package or a Next.js virtual module. */
function resolve(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? join("src", specifier.slice(2))
    : specifier.startsWith(".")
      ? join(dirname(from), specifier)
      : null;
  if (base === null) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate)) return normalize(candidate).replace(/\\/g, "/");
  }
  return null;
}

/** Every project file `entry` loads at run time, itself included; the walk stops at a Server Functions file (a client gets stubs). */
function runtimeClosure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [normalize(entry).replace(/\\/g, "/")];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (hasDirective(file, "use server")) continue;
    for (const specifier of runtimeSpecifiers(file)) {
      const next = resolve(file, specifier);
      if (next !== null) queue.push(next);
    }
  }
  return [...seen];
}

test("src/lib/payment-mode.ts has no import at all (a client bundle can load it alone)", () => {
  const code = codeOf("src/lib/payment-mode.ts");
  assert.doesNotMatch(code, /\bimport\b/, "no import, `import type` included");
  assert.doesNotMatch(code, /\brequire\s*\(/);
  assert.match(code, /export type PaymentMode = "mock" \| "test" \| "live";/);
  assert.match(code, /export function paymentModeOf\(/);
});

test("src/lib/admin-metrics.ts takes the payment mode from payment-mode.ts and imports nothing from @/lib/payments", () => {
  const code = codeOf("src/lib/admin-metrics.ts");
  assert.doesNotMatch(code, /["']@\/lib\/payments/, "no payments module, type imports included");
  assert.match(code, /from "@\/lib\/payment-mode"/);
});

test("the admin bar chart reaches admin-metrics (niceCeil) and the import-free payment mode module, nothing of payments", () => {
  const closure = runtimeClosure("src/components/admin/bar-chart.tsx");
  assert.ok(closure.includes("src/lib/admin-metrics.ts"), "the walk reaches admin-metrics (niceCeil)");
  assert.ok(closure.includes("src/lib/payment-mode.ts"), "and the import-free payment mode module");
  assert.equal(closure.some((f) => f.startsWith("src/lib/payments/")), false);
});

test("no client component loads a payments module or the Stripe client at run time (plan Global Constraints, client boundary)", () => {
  const clients = sourceFiles("src").filter((f) => hasDirective(f, "use client"));
  assert.ok(clients.length > 20, `the scan found the client components (${clients.length})`);
  const offenders = clients.flatMap((client) =>
    runtimeClosure(client)
      .filter((f) => f.startsWith("src/lib/payments/") || f === "src/lib/stripe.ts")
      .map((f) => `${client} -> ${f}`),
  );
  assert.deepEqual(offenders, []);
});

test("checkout.ts re-exports the one rule, so every importer keeps working and stripeMode cannot drift (COV-M8)", () => {
  assert.equal(checkout.paymentModeOf, paymentModeOf);
  assert.equal(stripeMode, paymentModeOf);
});
