/**
 * Wiring guard for src/server/public.ts, the "use server" file of the public writes (P4 final review X-1; the pattern
 * of src/server/client.test.ts). Every export of a Server Actions file is a public endpoint, and each one must reach
 * its core through runPublicAction: the slug check, resolvePublicPro, the fresh-session visitor, the "none" effects
 * budget (S49) and the revalidation all live there, and a core called directly would lose them while every core test
 * still passed (those tests hand the core a pro and a visitor they build). The file imports the action plumbing
 * (next/cache, next/server) and the process db, which the node:test runner cannot load, so the wiring is pinned on
 * the source; the rules themselves have their own tests (run-action.test.ts, booking-actions.db.test.ts,
 * shop-actions.db.test.ts, release-actions.db.test.ts, rdv-actions.db.test.ts). P5 added `bookRdv` (ACTIONS below, with
 * its core). Pure: no database, no env. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { codeView } from "@/test/source-guards";

const SOURCE = readFileSync("src/server/public.ts", "utf8");

/** Each export, the name runPublicAction logs it under, its core, and whether the core takes the server's publicDeps(). */
const ACTIONS: readonly { exportName: string; name: string; core: string; deps: boolean }[] = [
  { exportName: "startBuyAndBookAction", name: "startBuyAndBook", core: "startBuyAndBookCore", deps: true },
  { exportName: "registerFreeAction", name: "registerFree", core: "registerFreeCore", deps: false },
  { exportName: "bookWithHeldTicketAction", name: "bookWithHeldTicket", core: "bookWithHeldTicketCore", deps: false },
  { exportName: "startShopPurchaseAction", name: "startShopPurchase", core: "startShopPurchaseCore", deps: true },
  { exportName: "bookRdvAction", name: "bookRdv", core: "bookRdvCore", deps: true },
  { exportName: "abandonCheckoutAction", name: "abandonCheckout", core: "abandonCheckoutCore", deps: true },
];

/** The runtime imports the file may hold, by specifier, with the bindings it may take from each (`import type` aside). */
const RUNTIME_IMPORTS: Record<string, readonly string[]> = {
  "@/lib/db": ["db"],
  "@/lib/public/booking-actions": ["bookWithHeldTicketCore", "registerFreeCore", "startBuyAndBookCore"],
  "@/lib/public/context": ["splitActionInput"],
  "@/lib/public/rdv-actions": ["bookRdvCore"],
  "@/lib/public/release-actions": ["abandonCheckoutCore"],
  "@/lib/public/shop-actions": ["startShopPurchaseCore"],
  "@/server/public-context": ["publicDeps", "runPublicAction"],
};

/** One export: `code` is its code view (comments and string text blanked: the structure is read there), `text` the same span as written (string literals kept). */
type Action = { name: string; params: string; code: string; text: string };

/** Every `export async function` of a source: its name, its parameter list (code view) and its span up to the next export. */
function exportedActions(source: string): Action[] {
  const view = codeView(source);
  const starts = [...view.matchAll(/^export async function (\w+)\(/gm)];
  return starts.map((m, i) => {
    const at = m.index ?? 0;
    const end = starts[i + 1]?.index ?? view.length;
    const code = view.slice(at, end);
    const open = m[0].length - 1;
    return { name: m[1], params: code.slice(open + 1, closingParen(code, open)), code, text: source.slice(at, end) };
  });
}

/** The index of the `)` closing the `(` at `open` (a code view: no paren of a string or a comment counts); -1 when it never closes. */
function closingParen(code: string, open: number): number {
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    if (code[k] === "(") depth++;
    else if (code[k] === ")" && --depth === 0) return k;
  }
  return -1;
}

/** Why this export does not reach its core through runPublicAction as ACTIONS says; null when it does. */
function wiringProblemOf(action: Action, expected: (typeof ACTIONS)[number]): string | null {
  // The body: the slug split off first, then one `return runPublicAction(...)`, nothing before, between or after.
  const head = /\{\s*const \{ slug, rest \} = splitActionInput\(input\);\s*(?:return runPublicAction\()?/.exec(action.code);
  if (head === null) return "does not start with `const { slug, rest } = splitActionInput(input);`";
  if (!head[0].endsWith("return runPublicAction(")) return "does not return runPublicAction(...) right after the split";
  const open = head.index + head[0].length - 1;
  const close = closingParen(action.code, open);
  if (close === -1) return "runPublicAction( never closes";
  if (!/^\s*;\s*\}\s*$/.test(action.code.slice(close + 1))) return "runs code after runPublicAction(...)";
  // The arguments as written (the action name is a string literal), at the span the code view located.
  const args = action.text.slice(open + 1, close);
  const deps = expected.deps ? ", publicDeps()" : "";
  const call = new RegExp(
    `^\\s*"${expected.name}", slug, \\(pro, visitor, now\\) =>\\s*${expected.core}\\(db, pro, visitor, rest${deps.replace(/[()]/g, "\\$&")}, now\\),?\\s*$`,
  );
  if (!call.test(args)) return `does not hand runPublicAction("${expected.name}", slug, (pro, visitor, now) => ${expected.core}(db, pro, visitor, rest${deps}, now))`;
  return null;
}

/** The runtime imports of a source: specifier → the names it binds (an `import type` statement and `type X` bindings left out). */
function runtimeImportsOf(source: string): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const m of source.matchAll(/^import\s+(type\s+)?([\s\S]*?)\s+from\s+"([^"]+)";/gm)) {
    if (m[1]) continue;
    const names = /\{([\s\S]*)\}/.exec(m[2])?.[1] ?? m[2];
    const bound = names
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "" && !part.startsWith("type "));
    if (bound.length > 0) found[m[3]] = bound.sort();
  }
  for (const m of source.matchAll(/^import\s+"([^"]+)";/gm)) found[m[1]] = [];
  return found;
}

test("public.ts is a Server Actions file: the directive first, and only the six public writes are exported", () => {
  assert.ok(SOURCE.trimStart().startsWith('"use server";'), "the directive comes first");
  const exports = SOURCE.split(/\r?\n/).filter((line) => line.startsWith("export "));
  for (const line of exports) assert.match(line, /^export async function \w+\(/, `only async functions are exported: ${line}`);
  assert.deepEqual(
    exportedActions(SOURCE).map((a) => a.name),
    ACTIONS.map((a) => a.exportName),
  );
});

test("every export splits the slug off, then hands runPublicAction its core with the server's pro, visitor and clock and the rest of the input", () => {
  const actions = exportedActions(SOURCE);
  for (const expected of ACTIONS) {
    const action = actions.find((a) => a.name === expected.exportName);
    assert.ok(action, `${expected.exportName} is exported`);
    assert.equal(wiringProblemOf(action, expected), null, expected.exportName);
    // The core's strict schema refuses a `slug` key; and nothing of the input may stand for the pro or the visitor.
    assert.doesNotMatch(action.code, /\binput\.|Core\([^)]*\binput\b/, `${expected.exportName} never reads the input itself`);
  }
});

test("no action takes an identity from the browser: its input names ids of rows and the slug only", () => {
  for (const action of exportedActions(SOURCE)) {
    assert.match(action.params, /^\s*input: \{\s*slug: string;?/, `${action.name}: the slug comes first`);
    assert.doesNotMatch(action.params, /userId|email|customerId|professionalId|session|impersonat|visitor|\bpro\b/i, `${action.name}(${action.params})`);
  }
});

test("the only runtime imports are the db, the six cores, splitActionInput and the two wrappers: no writer, no notify, no session read", () => {
  assert.deepEqual(runtimeImportsOf(SOURCE), Object.fromEntries(Object.entries(RUNTIME_IMPORTS).map(([k, v]) => [k, [...v].sort()])));
  const code = codeView(SOURCE);
  assert.doesNotMatch(code, /\bgetSession\(|\bgetFreshSession\(|\bgetCurrentUser\(|\bauth\.api\b|\bcookies\(|\bheaders\(|\brunEffects\(|\brevalidatePath\(/);
  assert.equal(code.match(/\bdb\b/g)?.length, 1 + ACTIONS.length, "db is imported once and handed to each core, nothing else");
});

test("the guard can fail: a core called directly, `input` for `rest`, a missing publicDeps(), code after the call, an extra import", () => {
  const wired = (body: string) =>
    exportedActions(`export async function startBuyAndBookAction(input: { slug: string } & BuyAndBookInput): Promise<R> {\n${body}\n}\n`)[0];
  const expected = ACTIONS[0];
  const good = '  const { slug, rest } = splitActionInput(input);\n  return runPublicAction("startBuyAndBook", slug, (pro, visitor, now) =>\n    startBuyAndBookCore(db, pro, visitor, rest, publicDeps(), now),\n  );';
  assert.equal(wiringProblemOf(wired(good), expected), null);
  assert.notEqual(wiringProblemOf(wired(good.replace(/return runPublicAction\([\s\S]*$/, "return startBuyAndBookCore(db, pro, visitor, rest, publicDeps(), new Date());")), expected), null);
  assert.notEqual(wiringProblemOf(wired(good.replace("visitor, rest, publicDeps()", "visitor, input, publicDeps()")), expected), null);
  assert.notEqual(wiringProblemOf(wired(good.replace(", publicDeps()", "")), expected), null);
  assert.notEqual(wiringProblemOf(wired(good.replace('"startBuyAndBook"', '"other"')), expected), null);
  assert.notEqual(wiringProblemOf(wired(`${good.replace(/\);$/, ").then((r) => r);")}`), expected), null);
  assert.notEqual(wiringProblemOf(wired(`  await linkCustomerUser(db);\n${good}`), expected), null);
  assert.deepEqual(runtimeImportsOf('import { runEffects } from "@/server/notify";\nimport type { X } from "y";\nimport { type A, b } from "z";'), {
    "@/server/notify": ["runEffects"],
    z: ["b"],
  });
});
