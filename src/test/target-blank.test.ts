/**
 * Every link that opens a new tab says `rel="noopener noreferrer"` (P6 A10). Without `noopener` the opened page gets
 * `window.opener` and can send the back-office tab elsewhere (reverse tabnabbing); without `noreferrer` it learns the
 * address of the page that opened it. The pros' public pages carry content their owner writes (branding, descriptions),
 * and the support attachments are files a user uploaded: neither may reach the dashboard or the admin tab. Next's
 * `<Link>` passes `rel` through to its `<a>`, so the same attribute is required on both.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { openingTags, sourceFilesUnder, type OpeningTag } from "./source-guards";

/** A string target, read on the tag's own attributes. */
const NEW_TAB = /\starget=(?:"_blank"|'_blank')/;
/** A target written as an expression: the tag's own attribute is `target={}` at top level, its text holds the string. */
const NEW_TAB_EXPR = /\starget=\{\s*["'`]_blank["'`]\s*\}/;
const SAFE_REL = /\srel="(?=[^"]*\bnoopener\b)(?=[^"]*\bnoreferrer\b)[^"]*"/;

const opensNewTab = (tag: OpeningTag): boolean =>
  NEW_TAB.test(tag.topLevel) || (/\starget=\{\}/.test(tag.topLevel) && NEW_TAB_EXPR.test(tag.text));

/** Every opening tag of a source, whatever its name, that opens a new tab. */
function newTabTags(source: string): OpeningTag[] {
  const names = new Set([...source.matchAll(/<([A-Za-z][\w.]*)(?=[\s/>])/g)].map((m) => m[1]));
  return [...names].flatMap((name) => openingTags(source, name)).filter(opensNewTab);
}

const FILES = sourceFilesUnder("src").filter((file) => file.endsWith(".tsx"));
const lineOf = (source: string, at: number): number => source.slice(0, at).split("\n").length;

test("the rel check: both words, in any order and with other words, in the tag's own attributes only", () => {
  const safe = (tag: string) => SAFE_REL.test(openingTags(tag, "a")[0].topLevel);
  assert.equal(safe('<a href="/x" target="_blank" rel="noopener noreferrer">'), true);
  assert.equal(safe('<a href="/x" target="_blank" rel="noreferrer noopener external">'), true);
  assert.equal(safe('<a href="/x" target="_blank" rel="noreferrer">'), false);
  assert.equal(safe('<a href="/x" target="_blank" rel="noopener">'), false);
  assert.equal(safe('<a href="/x" target="_blank">'), false);
  assert.equal(safe('<a href="/x" target="_blank" onClick={() => log(\' rel="noopener noreferrer"\')}>'), false);
  assert.deepEqual(newTabTags('<Link href="/x" target={"_blank"}>a</Link> <a href="/y">b</a>').length, 1);
});

test("every link of src/ that opens a new tab has rel=\"noopener noreferrer\" (P6 A10)", () => {
  const offenders = FILES.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return newTabTags(source)
      .filter((tag) => !SAFE_REL.test(tag.topLevel))
      .map((tag) => `${file}:${lineOf(source, tag.at)} ${tag.text.split(/\r?\n/)[0].trim()}`);
  });
  assert.deepEqual(offenders, [], "add rel=\"noopener noreferrer\" to each of these tags");
});

test("the guard reads every new-tab target a plain text search finds, so a tag the scanner cannot see fails instead of passing", () => {
  let total = 0;
  const missed = FILES.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const plain = (source.match(/target=(?:"_blank"|'_blank'|\{\s*["'`]_blank["'`]\s*\})/g) ?? []).length;
    const read = newTabTags(source).length;
    total += read;
    return plain === read ? [] : [`${file}: ${plain} by text, ${read} read`];
  });
  assert.deepEqual(missed, []);
  assert.ok(total >= 10, `the walker reads the app's new-tab links (${total})`);
});
