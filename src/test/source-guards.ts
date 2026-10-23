/**
 * Shared source guards for the `*.test.ts` files that pin a file's source because node:test cannot load it (route
 * handlers, "use server" wrappers, client components). Pure: no test runner, no env, no database. This file is a
 * helper, not a test: it is not named `*.test.ts`, and `source-guards.test.ts` tests it. Run from the repository root.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every .ts and .tsx file under `dir`, test files excluded, with forward slashes. */
export function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFilesUnder(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path.replace(/\\/g, "/")] : [];
  });
}

/**
 * The source of the exported function `exportName` (`export function`, `export async function` or `export default
 * [async] function`, at the start of a line), from its declaration up to the next top-level doc comment or export, or
 * the end of the file: a neighbour's doc comment never leaks into the body, an undocumented private helper
 * between two exports belongs to the function above it, and a name that is only the beginning of another export does not match it. Throws
 * when the function is not exported, so a guard on a renamed function fails instead of reading nothing. Replaces the
 * local copies of the wiring guards (`bodyOf`, `handlerOf`) of the entry, pro-context, mock-checkout and guest-access tests.
 */
export function bodyOf(source: string, exportName: string): string {
  const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const head = new RegExp(`^export (?:default )?(?:async )?function ${escaped}\\b`, "m").exec(source);
  if (head === null) throw new Error(`\`export function ${exportName}\` is not in the source`);
  const afterHead = head.index + head[0].length;
  const next = source.slice(afterHead).search(/\r?\n(?:\/\*\*|export )/);
  return next === -1 ? source.slice(head.index) : source.slice(head.index, afterHead + next);
}

/** Characters after which a `/` starts a regular expression, not a division. */
const REGEX_AFTER = "(,=:[!&|?{};+-*%<>~^";
/** Keywords after which a `/` starts a regular expression. */
const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do"]);

/**
 * The source with everything that is not code replaced by spaces (newlines kept, so every index and line still lines up
 * with the original): comments, the text of string literals, the text parts of template literals and regular expression
 * literals. The expressions inside a template literal's `${ ... }` are code and stay. A scanner, not a parser: a string
 * ends at its closing quote or its line, a regular expression at its closing slash or its line, so a stray quote in JSX
 * text derails nothing beyond its own line.
 */
export function codeView(source: string): string {
  const out = source.split("");
  const n = source.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  /** One entry per open template expression: the depth of `{` braces inside it. */
  const expressions: number[] = [];
  let inTemplate = false;
  let prev = "";
  let prevWord = "";
  let i = 0;
  while (i < n) {
    const c = source[i];
    if (inTemplate) {
      if (c === "\\") {
        blank(i, i + 2);
        i += 2;
      } else if (c === "`") {
        blank(i, i + 1);
        inTemplate = false;
        prev = "`";
        prevWord = "";
        i++;
      } else if (c === "$" && source[i + 1] === "{") {
        blank(i, i + 2);
        expressions.push(0);
        inTemplate = false;
        prev = "";
        prevWord = "";
        i += 2;
      } else {
        blank(i, i + 1);
        i++;
      }
      continue;
    }
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      let end = source.indexOf("\n", i);
      if (end === -1) end = n;
      blank(i, end);
      i = end;
    } else if (c === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      blank(i, end);
      i = end;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      blank(i + 1, j);
      i = source[j] === c ? j + 1 : j;
      prev = c;
      prevWord = "";
    } else if (c === "`") {
      blank(i, i + 1);
      inTemplate = true;
      i++;
    } else if (c === "}" && expressions.length > 0 && expressions[expressions.length - 1] === 0) {
      expressions.pop();
      blank(i, i + 1);
      inTemplate = true;
      i++;
    } else if (c === "/" && (prev === "" || REGEX_AFTER.includes(prev) || REGEX_AFTER_WORD.has(prevWord))) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n && source[j] !== "\n") {
        const d = source[j];
        if (d === "\\") {
          j += 2;
          continue;
        }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) {
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        let end = j + 1;
        while (end < n && /[a-z]/.test(source[end])) end++;
        blank(i, end);
        i = end;
        prev = "a";
        prevWord = "";
      } else {
        prev = c;
        prevWord = "";
        i++;
      }
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(source[j])) j++;
      prevWord = source.slice(i, j);
      prev = "a";
      i = j;
    } else if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(source[j])) j++;
      prev = "0";
      prevWord = "";
      i = j;
    } else {
      if (c === "{" && expressions.length > 0) expressions[expressions.length - 1]++;
      else if (c === "}" && expressions.length > 0) expressions[expressions.length - 1]--;
      if (!/\s/.test(c)) {
        prev = c;
        prevWord = "";
      }
      i++;
    }
  }
  return out.join("");
}

/** The index of the `)` that closes the `(` at `open` in a code view (the length of the text when it never closes). */
function closingParen(code: string, open: number): number {
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    if (code[k] === "(") depth++;
    else if (code[k] === ")" && --depth === 0) return k;
  }
  return code.length;
}

/** `args` with every `logSafeMessage( ... )` call blanked out, its arguments included: an error inside it is scrubbed. */
function withoutSafeCalls(args: string): string {
  const chars = args.split("");
  const call = /\blogSafeMessage\s*\(/g;
  for (let m = call.exec(args); m !== null; m = call.exec(args)) {
    const close = closingParen(args, m.index + m[0].length - 1);
    for (let k = m.index; k <= close && k < chars.length; k++) if (chars[k] !== "\n") chars[k] = " ";
    call.lastIndex = close + 1;
  }
  return chars.join("");
}

/** The names a destructuring pattern binds (`message, code: c, cause = x, ...rest` gives message, c, cause, rest); a nested pattern is skipped. */
function boundNames(pattern: string): string[] {
  const names: string[] = [];
  for (const raw of pattern.split(",")) {
    const part = raw.trim().replace(/^\.\.\./, "");
    const alias = part.includes(":") ? part.slice(part.indexOf(":") + 1) : part;
    const id = /^\s*([A-Za-z_$][\w$]*)/.exec(alias);
    if (id) names.push(id[1]);
  }
  return names;
}

/**
 * The names a caught error is commonly bound to, plus every name a catch of this source binds: `catch (x)`,
 * `catch ({ message, cause: c })`, `.catch((x) => ...)`, `.catch(async x => ...)`, `.catch(function (x) { ... })`,
 * `.catch(({ message }) => ...)`, with or without a type annotation.
 */
function errorNamesOf(code: string): Set<string> {
  const names = new Set(["err", "error", "e", "cause", "reason"]);
  for (const m of code.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\.catch\s*\(\s*(?:async\s+)?\(?\s*([A-Za-z_$][\w$]*)\s*(?::[^)=]*)?\)?\s*=>/g)) names.add(m[1]);
  for (const m of code.matchAll(/\.catch\s*\(\s*(?:async\s+)?function\s*[A-Za-z_$]*\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\bcatch\s*\(\s*\{([^}]*)\}/g)) for (const name of boundNames(m[1])) names.add(name);
  for (const m of code.matchAll(/\.catch\s*\(\s*(?:async\s+)?(?:function\s*[A-Za-z_$]*\s*)?\(\s*\{([^}]*)\}/g)) {
    for (const name of boundNames(m[1])) names.add(name);
  }
  return names;
}

/** True when `args` (a code view, `logSafeMessage` calls already removed) names a caught error as a value or reads a stack. */
function namesRawError(args: string, names: Set<string>): boolean {
  if (/\.\s*stack\b/.test(args)) return true;
  for (const m of args.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (!names.has(m[0])) continue;
    const at = m.index ?? 0;
    const before = args.slice(0, at).trimEnd();
    const after = args.slice(at + m[0].length).trimStart();
    if (before.endsWith(".") && !before.endsWith("...")) continue; // a property (`verified.reason`), not the caught error itself; a spread (`...err`) is the error
    if ((before.endsWith("{") || before.endsWith(",")) && after.startsWith(":")) continue; // an object key (`{ error: 1 }`)
    return true;
  }
  return false;
}

/**
 * Every `console.log|info|warn|error(...)` call of `source` that hands a raw error to the log: its arguments name an
 * identifier commonly bound to a caught error (`err`, `error`, `e`, `cause`, `reason`, and every name a `catch (x)`,
 * `catch ({ message })`, `.catch((x) =>`, `.catch(function (x)` or `.catch(({ message }) =>` of the same source binds)
 * or read a `.stack`, as a bare argument, in a spread (`{ ...err }`), in `String(err)`, in `err.message` or inside a
 * template literal's `${ }`; unless the identifier only appears inside `logSafeMessage( ... )`. Also every console method
 * passed as an argument without being called (`.catch(console.error)`, `.then(ok, console.warn)`), which receives the
 * raw error: reported as the reference itself. The whole error (stack, cause, driver message with its SQL parameters)
 * would reach the platform log, which `logSafeMessage` scrubs. Returns the text of each offending call or reference, in
 * source order, so a failing test shows it; an empty list is a pass. Comments, string text and regular expressions are
 * never read as code. A property that happens to be named like an error (`verified.reason`) is not one.
 *
 * What it does NOT see (a human reads these by eye in the final sweep, and `source-guards.test.ts` pins the list so a
 * change is deliberate): a console method handed over as an object value (`{ onError: console.error }`), in a
 * conditional (`verbose ? console.error : noop`), through a nullish fallback (`custom ?? console.error`), and an error
 * bound by a NESTED destructured catch parameter (`catch ({ cause: { detail } })`, whose `detail` is not a known error
 * name). Only a reference right after `(` or `,` counts as handed to a callee.
 */
export function rawErrorLogs(source: string): string[] {
  const code = codeView(source);
  const names = errorNamesOf(code);
  const found: { at: number; text: string }[] = [];
  const head = /\bconsole\s*\.\s*(?:log|info|warn|error)\s*\(/g;
  for (let m = head.exec(code); m !== null; m = head.exec(code)) {
    const open = m.index + m[0].length - 1;
    const close = closingParen(code, open);
    if (namesRawError(withoutSafeCalls(code.slice(open + 1, close)), names)) {
      found.push({ at: m.index, text: source.slice(m.index, Math.min(close + 1, source.length)) });
    }
    head.lastIndex = Math.max(close, m.index + m[0].length);
  }
  // A console method passed as an argument without being called (nor assigned or compared) is handed to something that
  // calls it with the error. A default value or an assignment (`log = console.error`) is not a hand-over: it names a logger.
  const reference = /\bconsole\s*\.\s*(?:log|info|warn|error)\b(?!\s*[(=])/g;
  for (let m = reference.exec(code); m !== null; m = reference.exec(code)) {
    const before = code.slice(0, m.index).trimEnd();
    if (before.endsWith("(") || before.endsWith(",")) found.push({ at: m.index, text: source.slice(m.index, m.index + m[0].length) });
  }
  return found.sort((x, y) => x.at - y.at).map((hit) => hit.text);
}
