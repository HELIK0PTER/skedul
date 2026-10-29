/**
 * Every form of the app posts. A server-rendered `<form>` with no `method` is a native GET of its action (the current
 * URL by default): submitted before hydration, or when a client chunk fails to load, it writes every field it holds
 * (an e-mail, a name, a phone, a password) into the address bar, the history and the request logs. `method="post"`
 * changes nothing once hydrated, because every client handler calls `preventDefault()` first (pinned below). A form
 * bound to a Server Action or a client action function (`action={...}`) is posted by React, so it passes as well.
 * Task 26 review, G4b item 1; contract § 1 « URLs and logs ».
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { openingTags, sourceFilesUnder, type OpeningTag } from "./source-guards";

/** True when the tag cannot send its fields as a GET query string: it posts, or an action expression handles it. */
const posts = (tag: OpeningTag): boolean =>
  /\smethod="post"(?=[\s/>])/.test(tag.topLevel) || /\saction=\{/.test(tag.topLevel);

/**
 * The forms that keep the browser's GET on purpose, by file, with the reason. Each must stay a plain server-rendered
 * form (a string `action`, no client handler): the last test fails as soon as one gets an `onSubmit`. None is left: the
 * admin user search, the last one, sends its term through a Server Action since P6 A4.
 */
const GET_FORMS: Record<string, string> = {};

const TSX = sourceFilesUnder("src").filter((file) => file.endsWith(".tsx"));
const FORMS = TSX.flatMap((file) => {
  const source = readFileSync(file, "utf8");
  return openingTags(source, "form").map((tag) => ({ file, source, tag }));
});
const lineOf = (source: string, at: number): number => source.slice(0, at).split("\n").length;

test("openingTags: a tag holding an arrow function ends at its own `>`, and what sits inside braces is not top level", () => {
  const source = [
    "<form",
    "  onSubmit={(e) => {",
    "    e.preventDefault();",
    "    if (a > b) log('method=\"post\"');",
    "  }}",
    '  className="space-y-4"',
    ">",
    "  <input name=\"email\" />",
    "</form>",
  ].join("\r\n");
  const [tag, ...rest] = openingTags(source, "form");
  assert.equal(rest.length, 0);
  assert.ok(tag.text.startsWith("<form") && tag.text.endsWith('className="space-y-4"\r\n>'), tag.text);
  assert.ok(!tag.topLevel.includes("preventDefault") && !tag.topLevel.includes("method="), tag.topLevel);
  assert.ok(tag.topLevel.includes("onSubmit={}") && tag.topLevel.includes('className="space-y-4"'), tag.topLevel);
  assert.equal(posts(tag), false, "a method spelled inside an expression is not the tag's own");
});

test("openingTags: a `>` in a string attribute does not end the tag; comments, strings and longer names are not tags", () => {
  const source = [
    '<form className="a>b" method="post" onSubmit={go}>',
    "// <form onSubmit={nope}>",
    "/* <form onSubmit={nope}> */",
    'const html = "<form onSubmit={nope}>";',
    "<formatted /> <FormField label=\"x\" />",
    "<form action={save}>",
  ].join("\n");
  const tags = openingTags(source, "form");
  assert.deepEqual(
    tags.map((t) => t.text),
    ['<form className="a>b" method="post" onSubmit={go}>', "<form action={save}>"],
  );
  assert.ok(tags.every(posts));
});

test("openingTags: an unclosed tag is read to the end of the source", () => {
  const [tag] = openingTags('<form onSubmit={(e) => go(e)} className="x"', "form");
  assert.equal(tag.text, '<form onSubmit={(e) => go(e)} className="x"');
});

test("openingTags: the shape it does not see is documented, and pinned so a change is deliberate", () => {
  assert.deepEqual(openingTags('<p>a</p><form action="/x" onSubmit={go}>', "form"), []);
  assert.equal(openingTags('<p>a</p>\n<form action="/x" onSubmit={go}>', "form").length, 1);
});

test("posts: method=\"post\" or an action expression passes; no method, a GET or a string action fails", () => {
  const read = (tag: string) => posts(openingTags(tag, "form")[0]);
  assert.equal(read('<form method="post" onSubmit={go}>'), true);
  assert.equal(read("<form ref={root} method=\"post\" onSubmit={submit} noValidate>"), true);
  assert.equal(read("<form action={createThing}>"), true);
  assert.equal(read("<form\n  action={(formData) => run(formData)}\n>"), true);
  assert.equal(read("<form onSubmit={go}>"), false);
  assert.equal(read('<form method="get" onSubmit={go}>'), false);
  assert.equal(read('<form action="/admin/users">'), false);
  assert.equal(read('<form methodx="post" onSubmit={go}>'), false);
});

test("every <form> under src posts or is handled by an action, so a submit before hydration never puts a field in a URL", () => {
  assert.ok(FORMS.length >= 40, `the walker reads the app's forms (${FORMS.length})`);
  const offenders = FORMS.filter(({ file, tag }) => !posts(tag) && !(file in GET_FORMS)).map(
    ({ file, source, tag }) => `${file}:${lineOf(source, tag.at)} ${tag.text.split(/\r?\n/)[0]}`,
  );
  assert.deepEqual(offenders, [], "add method=\"post\" to each of these forms");
});

test("the guard reads every <form> a plain text search finds, so a tag the scanner cannot see fails instead of passing", () => {
  const missed = TSX.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const plain = (source.match(/<form(?=[\s/>])/g) ?? []).length;
    const read = openingTags(source, "form").length;
    return plain === read ? [] : [`${file}: ${plain} by text, ${read} read`];
  });
  assert.deepEqual(missed, [], "a <form> the scanner did not read (in a comment or a string? reword it; else fix openingTags)");
});

test("every client-handled form prevents the native submit first, so method=\"post\" changes nothing once hydrated", () => {
  const offenders: string[] = [];
  for (const { file, source, tag } of FORMS) {
    const handler = /\sonSubmit=\{([\s\S]*)$/.exec(tag.text);
    if (handler === null) continue;
    const expr = handler[1];
    const inline = /^\s*\(?\s*([A-Za-z_$][\w$]*)\s*(?::[^)]*)?\)?\s*=>\s*\{\s*([A-Za-z_$][\w$]*)\.preventDefault\(\);/.exec(expr);
    if (inline !== null && inline[1] === inline[2]) continue;
    // A named handler (or a choice of two): the identifiers of the expression that this file declares as functions.
    const names = [...expr.split("}")[0].matchAll(/[A-Za-z_$][\w$]*/g)]
      .map((m) => m[0])
      .filter((name) => new RegExp(`function\\s+${name}\\s*\\(`).test(source));
    const ok =
      names.length > 0 &&
      names.every((name) => {
        const decl = new RegExp(
          `(?:async\\s+)?function\\s+${name}\\s*\\(\\s*([A-Za-z_$][\\w$]*)[^)]*\\)\\s*\\{\\s*([A-Za-z_$][\\w$]*)\\.preventDefault\\(\\);`,
        ).exec(source);
        return decl !== null && decl[1] === decl[2];
      });
    if (!ok) offenders.push(`${file}:${lineOf(source, tag.at)} ${tag.text.split(/\r?\n/)[0]}`);
  }
  assert.deepEqual(offenders, [], "the submit handler of these forms does not start with e.preventDefault()");
});

test("the GET forms kept on purpose stay plain server-rendered forms: a string action and no client handler", () => {
  for (const [file, reason] of Object.entries(GET_FORMS)) {
    const tags = FORMS.filter((f) => f.file === file).map((f) => f.tag);
    assert.equal(tags.length, 1, `${file} holds one form (${reason})`);
    assert.match(tags[0].topLevel, /\saction="\/[^"]*"/, file);
    assert.doesNotMatch(tags[0].text, /\bonSubmit=/, `${file}: a client handler makes it a client form, which must post`);
  }
});
