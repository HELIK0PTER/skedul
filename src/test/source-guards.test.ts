import assert from "node:assert/strict";
import test from "node:test";

import { bodyOf, codeView, rawErrorLogs, sourceFilesUnder } from "./source-guards";

/** The calls rawErrorLogs reports for a one-statement source. */
const hits = (source: string): number => rawErrorLogs(source).length;

test("rawErrorLogs: a raw error handed to a console call is reported, whatever its name or shape", () => {
  const raw = [
    'console.error("[x] failed", err);',
    'console.error("[x] failed", error);',
    'console.warn("[x] failed", e);',
    'console.log("[x] failed", cause);',
    'console.info("[x] failed", reason);',
    "console.error(err);",
    'console.error("[x] failed:", err.message);',
    "console.error(err.stack);",
    'console.error("[x]", new Error("boom").stack);',
    'console.error("[x] failed: " + String(err));',
    'console.error("[x] failed: " + err);',
    "console.error(`[x] failed: ${err}`);",
    "console.error(`[x] failed: ${err.message}`);",
    "console.error(`[x] failed: ${String(error)}`);",
    "console.error(`[x] ${format(`${err}`)}`);",
    'console.warn(\n  "[x] failed",\n  err,\n);',
    'console.error("[x] failed", { err });',
    'console.error("[x] failed", cond ? err : null);',
  ];
  for (const source of raw) assert.equal(hits(source), 1, source);
});

test("rawErrorLogs: a catch binding of the same source counts as a caught error, whatever its name", () => {
  assert.equal(hits('try { run(); } catch (failure) { console.error("[x] failed", failure); }'), 1);
  assert.equal(hits('run().catch((boom) => console.error("[x] failed", boom));'), 1);
  assert.equal(hits('run().catch(boom => console.error(boom));'), 1);
  assert.equal(hits('try { run(); } catch (failure) { console.error("[x] failed"); }'), 0, "bound but not logged");
  assert.equal(hits('console.error("[x] failed", failure);'), 0, "no catch binds it here");
});

test("rawErrorLogs: a spread of a caught error is reported (a `...` before the name is not a property access)", () => {
  const spread = [
    'console.error("[x] failed", { ...err });',
    "console.error({ ...error, step: 2 });",
    "console.error(...err);",
    'console.warn("[x] failed", ...[err]);',
    'try { run(); } catch (failure) { console.error("[x] failed", { ...failure }); }',
  ];
  for (const source of spread) assert.equal(hits(source), 1, source);
  // A property named like an error is still a property, spread or not.
  assert.equal(hits('console.error("[x] failed", { ...verified.reason });'), 0);
  assert.equal(hits('console.error("[x] failed", ...errors);'), 0, "another name");
});

test("rawErrorLogs: a console method handed over as a callback receives the error, and is reported", () => {
  const callbacks = [
    "run().catch(console.error);",
    "run().catch(console.warn);",
    "run().then(ok, console.error);",
    "run().catch(console.error.bind(console));",
    "run().catch( console . log );",
  ];
  for (const source of callbacks) assert.equal(hits(source), 1, source);
  // Reported as the reference, with its own text, in source order with the calls.
  assert.deepEqual(rawErrorLogs('console.error("[a] x", err);\nrun().catch(console.error);'), ['console.error("[a] x", err)', "console.error"]);
  // Not a hand-over: a call (without an error), an assignment, a default value or a property that only names a logger, a comparison, a string.
  for (const source of [
    'console.error("[x] done");',
    "console.error = capture;",
    "const report = console.warn;",
    "export function run(log: (line: string) => void = console.error) { log(line); }",
    "const deps = { log: console.error };",
    'typeof console.error === "function";',
    'const name = "console.error";',
    "// run().catch(console.error)",
  ]) {
    assert.equal(hits(source), 0, source);
  }
});

test("rawErrorLogs: the parameter of a function-expression catch handler counts as a caught error", () => {
  const handlers = [
    'run().catch(function (boom) { console.error("[x] failed", boom); });',
    'run().catch(function named(boom) { console.error("[x] failed", boom); });',
    'run().catch(async function (boom) { console.error("[x] failed", boom); });',
    'run().catch(async (boom) => { console.error("[x] failed", boom); });',
    'run().catch(async boom => console.error("[x] failed", boom));',
    'run().catch((boom: unknown) => console.error("[x] failed", boom));',
    'run().catch(function (boom: unknown) { console.error(boom); });',
    'try { run(); } catch (boom: unknown) { console.error("[x] failed", boom); }',
  ];
  for (const source of handlers) assert.equal(hits(source), 1, source);
  assert.equal(hits('run().catch(function (boom) { console.error("[x] failed"); });'), 0, "bound but not logged");
  assert.equal(hits('run().then(function (boom) { console.error("[x] failed", boom); });'), 0, "a then handler binds a value, not a caught error");
});

test("rawErrorLogs: the names inside a destructured catch parameter count as a caught error", () => {
  const destructured = [
    'try { run(); } catch ({ message }) { console.error("[x] failed", message); }',
    'try { run(); } catch ({ message: text }) { console.error("[x] failed", text); }',
    'try { run(); } catch ({ code, cause }) { console.error("[x] failed", cause); }',
    'try { run(); } catch ({ code, ...rest }) { console.error("[x] failed", rest); }',
    'try { run(); } catch ({ message = "none" }) { console.error("[x] failed", message); }',
    'run().catch(({ message }) => console.error("[x] failed", message));',
    'run().catch(async function ({ message }) { console.error("[x] failed", message); });',
  ];
  for (const source of destructured) assert.equal(hits(source), 1, source);
  assert.equal(hits('try { run(); } catch ({ message }) { console.error("[x] failed"); }'), 0, "bound but not logged");
  assert.equal(hits('console.error("[x] failed", message);'), 0, "no catch binds it here");
  assert.equal(hits('try { run(); } catch ({ message: text }) { console.error("[x] failed", message); }'), 0, "renamed: only the alias is bound");
});

test("rawErrorLogs: logSafeMessage scrubs the error, so an identifier that only appears inside it is not reported", () => {
  const safe = [
    "console.error(`[x] failed: ${logSafeMessage(err)}`);",
    'console.error("[x] failed: " + logSafeMessage(err));',
    'console.error("[x] failed:", logSafeMessage(error));',
    "console.error(`[cron] ${logSafeMessage({ message: error })}`);",
    "console.error(`[x] ${logSafeMessage(new Error(String(cause)))}`);",
    'console.warn(\n  "[x] failed:",\n  logSafeMessage(err),\n);',
  ];
  for (const source of safe) assert.equal(hits(source), 0, source);
  // ... but a second, unscrubbed use in the same call is.
  assert.equal(hits("console.error(`[x] ${logSafeMessage(err)} ${err}`);"), 1);
  assert.equal(hits('console.error(logSafeMessage(err), err.stack);'), 1);
});

test("rawErrorLogs: words in strings, properties, object keys and other names are not errors", () => {
  const clean = [
    'console.error("[x] error while reading the e-mail: the cause is unknown");',
    "console.warn(`[stripe] signature rejected: ${verified.reason}`);",
    'console.error("[x] failed", { error: 1 });',
    'console.error("[x] failed", { reason: "closed", cause: 2 });',
    'console.error("[x] failed", errors.length);',
    'console.error("[x] failed", errorCount);',
    "console.info(impersonation);",
    'console.log("[x] done");',
    'console.error("[x] failed", report.errors);',
    'logger.error("[x] failed", err);',
    'process.stderr.write(err);',
    'console.error("[x] failed" /* err */);',
    "console.error(`[x] ${count} rows`);",
  ];
  for (const source of clean) assert.equal(hits(source), 0, source);
});

test("rawErrorLogs: a console call inside a comment or a string is not a call, and the text around it is not read as code", () => {
  assert.equal(hits('// console.error("x", err);'), 0);
  assert.equal(hits('/* console.error("x", err); */'), 0);
  assert.equal(hits('/**\n * console.error("x", err);\n */'), 0);
  assert.equal(hits('const doc = "console.error(\'x\', err)";'), 0);
  assert.equal(hits("const doc = `console.error('x', err)`;"), 0);
  // A regular expression that holds a quote, a comment marker or a backtick does not derail the scan that follows it.
  assert.equal(hits('const re = /"/; console.error("x", err);'), 1);
  assert.equal(hits('const re = /\\/\\*/g; console.error("x", err);'), 1);
  assert.equal(hits("const re = /`/; console.error('x', err);"), 1);
  assert.equal(hits("const ratio = a / b; console.error('x', err); const half = c / 2;"), 1);
  assert.equal(hits("const a = b / 2; const s = 'it is c / d'; console.log('x', s);"), 0);
});

test("rawErrorLogs: every offending call is returned, as its source text, and only the offending ones", () => {
  const source = [
    "export async function POST() {",
    "  try {",
    "    await run();",
    "  } catch (err) {",
    '    console.error("[a] failed", err);',
    "    console.error(`[b] failed: ${logSafeMessage(err)}`);",
    '    console.warn("[c] failed:", err.stack);',
    "  }",
    "}",
  ].join("\n");
  assert.deepEqual(rawErrorLogs(source), ['console.error("[a] failed", err)', 'console.warn("[c] failed:", err.stack)']);
});

test("rawErrorLogs: an unclosed call is read to the end of the source, not skipped", () => {
  assert.equal(hits('console.error("x", err'), 1);
});

test("rawErrorLogs sees what the narrow /,\\s*err\\s*\\)/ guard missed", () => {
  const narrow = /,\s*err\s*\)/;
  for (const source of ['console.error("x", error);', 'console.error("x", err, extra);', "console.error(`x ${err}`);", "console.error(err.stack);"]) {
    assert.equal(narrow.test(source), false, `the narrow regex lets ${source} through`);
    assert.equal(hits(source), 1, source);
  }
});

test("codeView: same length, same lines, comments and strings blanked, template expressions kept", () => {
  const source = 'const a = "str-literal"; // line-note\nconst b = `tpl-text ${f(err)} tail-text`; /* block\nnote */ const r = /re"gex/;\n';
  const view = codeView(source);
  assert.equal(view.length, source.length);
  assert.equal(view.split("\n").length, source.split("\n").length);
  for (const gone of ["str-literal", "line-note", "tpl-text", "tail-text", "block", 're"gex']) assert.ok(!view.includes(gone), gone);
  assert.ok(view.includes("f(err)"), "the expression of a template literal is code");
  assert.ok(view.includes("const a =") && view.includes("const r ="));
});

test("sourceFilesUnder: the .ts and .tsx files under a directory, test files excluded, forward slashes", () => {
  const files = sourceFilesUnder("src/test");
  assert.ok(files.includes("src/test/source-guards.ts"), "this helper is a source file");
  assert.ok(files.includes("src/test/db.ts"));
  assert.ok(files.every((f) => /^src\/test\/[^\\]+\.tsx?$/.test(f)), JSON.stringify(files));
  assert.ok(files.every((f) => !/\.test\.tsx?$/.test(f)), "no test file");
  const all = sourceFilesUnder("src");
  assert.ok(all.length > 200, `the whole tree is walked (${all.length})`);
  assert.ok(all.includes("src/server/visitor.ts") && all.includes("src/lib/booking/claims.ts"));
});

const FILE = [
  "/** The first. */",
  "export async function first(a: number) {",
  "  return a;",
  "}",
  "",
  "/** The second, with its own doc comment. */",
  "export function second() {",
  "  return 2;",
  "}",
  "",
  "function helper() {",
  "  return 3;",
  "}",
  "export default async function Third() {",
  "  return helper();",
  "}",
  "",
].join("\n");

test("bodyOf: the declaration of an exported function up to the next top-level doc comment or export, the neighbour's comment left out", () => {
  const first = bodyOf(FILE, "first");
  assert.ok(first.startsWith("export async function first(a: number) {"));
  assert.ok(first.includes("return a;"));
  assert.ok(!first.includes("second") && !first.includes("The second"), "the doc comment of the next function is not part of this one");
  assert.ok(bodyOf(FILE, "second").includes("return 2;"));
});

test("bodyOf: stops at the next export even without a doc comment, keeps a private helper in between, and reads a default export to the end of the file", () => {
  const second = bodyOf(FILE, "second");
  assert.ok(second.includes("function helper()") && second.includes("return 3;"), "a private helper belongs to the function above it");
  assert.ok(!second.includes("Third"), "the next export starts the next body");
  const third = bodyOf(FILE, "Third");
  assert.ok(third.startsWith("export default async function Third() {"));
  assert.ok(third.includes("return helper();"), "to the end of the file");
});

test("bodyOf: a name that is a prefix of another export does not match it, a generic or CRLF source still works", () => {
  const source = "export async function requireProContext() {\n  return 1;\n}\n/** doc */\nexport async function requirePro<T>(x: T) {\n  return 2;\n}\n";
  assert.ok(bodyOf(source, "requirePro").includes("return 2;"), "requirePro is the generic one, not requireProContext");
  assert.ok(!bodyOf(source, "requirePro").includes("return 1;"));
  assert.ok(bodyOf(source.replace(/\n/g, "\r\n"), "requireProContext").includes("return 1;"));
  assert.ok(!bodyOf(source.replace(/\n/g, "\r\n"), "requireProContext").includes("return 2;"));
});

test("bodyOf: throws when the function is not exported (a private function or a name inside a string does not count)", () => {
  assert.throws(() => bodyOf(FILE, "helper"), /helper/);
  assert.throws(() => bodyOf(FILE, "missing"), /missing/);
  assert.throws(() => bodyOf('const s = "export async function ghost() {}";', "ghost"), /ghost/);
});

test("rawErrorLogs: the hand-over shapes it does not see are documented, and this test pins them so a change is deliberate (read by eye in Task 31)", () => {
  for (const source of [
    "const opts = { onError: console.error };",
    "const log = verbose ? console.error : noop;",
    "const log = custom ?? console.error;",
    'try { run(); } catch ({ cause: { detail } }) { console.error("[x] failed", detail); }',
  ]) {
    assert.equal(hits(source), 0, source);
  }
  // The same calls, spelled as the rule reads them, are reported: the blind spots are the shapes above, nothing more.
  assert.equal(hits("run().catch(console.error);"), 1);
  assert.equal(hits('try { run(); } catch ({ cause }) { console.error("[x] failed", cause); }'), 1);
});
