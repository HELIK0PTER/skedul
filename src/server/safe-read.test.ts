/**
 * Wiring guard of `safeRead` (P4 final review RND-1, contract § 1 « URLs and logs »): every server-only read a public
 * page, a layout or a generateMetadata runs during its render goes through `safeRead`, so a read that fails (a Neon
 * timeout, a quota stop) throws the scrubbed `[read] <SQL head>` error, never Drizzle's « Failed query: … params: … »
 * with the session e-mail, which Next.js would log as it is. The rule itself is tested in src/lib/safe-read.test.ts;
 * these modules import `server-only`, `next/*` and the process db, which node:test cannot load, so they are pinned on
 * their source (the pattern of src/server/visitor.test.ts). Pure: no database, no env. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { codeView } from "@/test/source-guards";

/** The read modules, and which of their exports are reads (null: every runtime export). */
const READ_MODULES: readonly { path: string; reads: readonly string[] | null }[] = [
  { path: "src/server/public-queries.ts", reads: null },
  { path: "src/server/client-queries.ts", reads: null },
  { path: "src/server/visitor.ts", reads: null },
  // The rest of public-context.ts is the plumbing of the Server Actions, whose runner catches and logs safely.
  { path: "src/server/public-context.ts", reads: ["resolvePublicPro"] },
];

type Export = { name: string; code: string };

/** Every runtime export (`export [async] function` or `export const`) of a source, with its code up to the next top-level declaration. */
function runtimeExportsOf(source: string): Export[] {
  const code = codeView(source);
  const head = /^export (?:async )?(?:function|const) ([A-Za-z_$][\w$]*)/gm;
  const starts = [...code.matchAll(head)].map((m) => ({ name: m[1], at: m.index ?? 0 }));
  const boundary = /\n(?:export |(?:async )?function |const |let |type |interface )/g;
  return starts.map(({ name, at }) => {
    boundary.lastIndex = at + 1;
    const next = boundary.exec(code);
    return { name, code: code.slice(at, next === null ? undefined : next.index) };
  });
}

/** The index of the `)` closing the `(` at `open` (codeView text, so no paren of a string or a comment is counted). */
function closingParen(code: string, open: number): number {
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    if (code[k] === "(") depth++;
    else if (code[k] === ")" && --depth === 0) return k;
  }
  return -1;
}

/** Why this export's read can escape `safeRead`; null when its whole body is the argument of one `safeRead(...)` it returns. */
function escapeOf(exp: Export): string | null {
  const calls = exp.code.match(/\bsafeRead\(/g)?.length ?? 0;
  if (calls !== 1) return `calls safeRead ${calls} times`;
  const call = /(?:\breturn\s+|=>\s*)safeRead\(/.exec(exp.code);
  if (call === null) return "does not return safeRead(...)";
  const open = call.index + call[0].length - 1;
  const close = closingParen(exp.code, open);
  if (close === -1) return "safeRead( never closes";
  const before = exp.code.slice(0, call.index);
  if (/\bawait\b|\bdb\b/.test(before)) return "reads before safeRead";
  if (!/^[\s;),}]*$/.test(exp.code.slice(close + 1))) return "runs code after safeRead(...)";
  if (/^\s*(?:async\s*)?\(\s*\)\s*=>/.test(exp.code.slice(open + 1)) === false) return "safeRead's argument is not a function";
  return null;
}

test("safeRead is the server-only binding of the tested core to Next's unstable_rethrow, and nothing else", () => {
  const source = readFileSync("src/server/safe-read.ts", "utf8");
  assert.match(source, /^import "server-only";/m);
  assert.doesNotMatch(source, /^["']use server["']/m, "not a Server Functions file");
  assert.match(source, /^import \{ unstable_rethrow \} from "next\/navigation";\r?$/m);
  assert.match(source, /^import \{ safeReadWith \} from "@\/lib\/safe-read";\r?$/m);
  assert.match(
    codeView(source),
    /export function safeRead<T>\(fn: \(\) => Promise<T>\): Promise<T> \{\s*return safeReadWith\(fn, unstable_rethrow\);\s*\}/,
  );
});

test("every read export of the public read modules goes through safeRead: its whole body is the argument of the one safeRead it returns", () => {
  for (const { path, reads } of READ_MODULES) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /^import \{ safeRead \} from "@\/server\/safe-read";\r?$/m, `${path} imports safeRead`);
    const exports = runtimeExportsOf(source);
    const checked = reads === null ? exports : exports.filter((exp) => reads.includes(exp.name));
    assert.equal(checked.length, reads === null ? exports.length : reads.length, `${path}: every named read is found`);
    assert.ok(checked.length > 0, `${path}: the scan found its exports`);
    for (const exp of checked) assert.equal(escapeOf(exp), null, `${path} ${exp.name}`);
  }
});

test("the scan reads every export of the four modules, React cache() ones included", () => {
  const names = (path: string) => runtimeExportsOf(readFileSync(path, "utf8")).map((exp) => exp.name);
  assert.deepEqual(names("src/server/public-queries.ts"), [
    "getPublicPage",
    "getPlanningPage",
    "getNextSeanceStart",
    "getBoutiquePage",
    "getHorizonNeed",
    "getSeancePage",
    "getSeanceVisitorFacts",
    "getLivePendingHolds",
    "getOfferPage",
    "getPurchaseReference",
  ]);
  assert.deepEqual(names("src/server/client-queries.ts"), [
    "getClientsPage",
    "getClientRecordPage",
    "resolveSpaceCustomer",
    "getCustomerSpacePage",
    "getSpendableSeances",
    "getMySpacePage",
  ]);
  assert.deepEqual(names("src/server/visitor.ts"), ["visitorIpHashes", "currentSessionFacts", "currentPublicVisitor"]);
  assert.ok(names("src/server/public-context.ts").includes("resolvePublicPro"));
});

test("the guard can fail: a read outside safeRead, before it, after it, or twice is reported", () => {
  const one = (text: string): Export => runtimeExportsOf(text)[0];
  const ok = "export function f(a: string, now: Date): Promise<X> {\n  return safeRead(() => core(db, a, now));\n}\n";
  assert.equal(escapeOf(one(ok)), null);
  const cached = "export const g = cache((slug: string): Promise<{ a: 1 } | null> => {\n  return safeRead(async () => {\n    const found = await read(db, slug);\n    return found;\n  });\n});\n";
  assert.equal(escapeOf(one(cached)), null);
  const arrow = "export const h: (a: string) => Promise<X> = cache(\n  (a: string): Promise<X> =>\n    safeRead(async () => core(db, a)),\n);\n";
  assert.equal(escapeOf(one(arrow)), null);
  assert.equal(escapeOf(one("export function f(a: string): Promise<X> {\n  return core(db, a);\n}\n")), "calls safeRead 0 times");
  assert.equal(
    escapeOf(one("export async function f(a: string): Promise<X> {\n  const rows = await core(db, a);\n  return safeRead(() => rows);\n}\n")),
    "reads before safeRead",
  );
  assert.equal(
    escapeOf(one("export async function f(a: string): Promise<X> {\n  return safeRead(() => core(db, a)).then((x) => x);\n}\n")),
    "runs code after safeRead(...)",
  );
  assert.equal(
    escapeOf(one("export function f(a: string): Promise<X> {\n  return safeRead(core(db, a));\n}\n")),
    "safeRead's argument is not a function",
  );
  assert.equal(
    escapeOf(one("export function f(a: string): Promise<X> {\n  void safeRead(() => x());\n  return safeRead(() => core(db, a));\n}\n")),
    "calls safeRead 2 times",
  );
  // A comment or a string that names safeRead is not a call.
  assert.equal(escapeOf(one('export function f(a: string): Promise<X> {\n  // safeRead(() => x)\n  return core(db, "safeRead(");\n}\n')), "calls safeRead 0 times");
});
