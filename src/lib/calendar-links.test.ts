import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIcs,
  googleCalendarUrl,
  outlookCalendarUrl,
} from "./calendar-links";

const base = {
  title: "Coaching 1h",
  description: "Rendez-vous avec Altinha Paris",
  startAt: new Date("2026-07-03T12:00:00.000Z"),
  endAt: new Date("2026-07-03T13:00:00.000Z"),
};

test("googleCalendarUrl → render?action=TEMPLATE with UTC compact dates", () => {
  const url = new URL(googleCalendarUrl(base));
  assert.equal(url.origin + url.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("text"), "Coaching 1h");
  assert.equal(url.searchParams.get("details"), "Rendez-vous avec Altinha Paris");
  assert.equal(url.searchParams.get("dates"), "20260703T120000Z/20260703T130000Z");
});

test("outlookCalendarUrl → deeplink/compose with ISO dates", () => {
  const url = new URL(outlookCalendarUrl(base));
  assert.equal(
    url.origin + url.pathname,
    "https://outlook.live.com/calendar/0/deeplink/compose",
  );
  assert.equal(url.searchParams.get("rru"), "addevent");
  assert.equal(url.searchParams.get("subject"), "Coaching 1h");
  assert.equal(url.searchParams.get("body"), "Rendez-vous avec Altinha Paris");
  assert.equal(url.searchParams.get("startdt"), "2026-07-03T12:00:00.000Z");
  assert.equal(url.searchParams.get("enddt"), "2026-07-03T13:00:00.000Z");
  assert.equal(url.searchParams.get("path"), null);
});

test("buildIcs → valid VCALENDAR with CRLF lines and UID", () => {
  const ics = buildIcs({ ...base, uid: "bk_123@skedul.app" });
  const lines = ics.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.ok(lines.includes("UID:bk_123@skedul.app"));
  assert.ok(lines.includes("DTSTART:20260703T120000Z"));
  assert.ok(lines.includes("DTEND:20260703T130000Z"));
  assert.ok(lines.includes("SUMMARY:Coaching 1h"));
  assert.ok(lines.includes("END:VCALENDAR"));
  // file ends with a CRLF
  assert.ok(ics.endsWith("\r\n"));
});

test("buildIcs → escapes commas, semicolons and newlines in text", () => {
  const ics = buildIcs({
    ...base,
    uid: "bk_esc@skedul.app",
    title: "Yoga; doux, matin",
    description: "Ligne 1\nLigne 2",
  });
  assert.ok(ics.includes("SUMMARY:Yoga\\; doux\\, matin"));
  assert.ok(ics.includes("DESCRIPTION:Ligne 1\\nLigne 2"));
});

test("no location → no location parameter and no LOCATION line", () => {
  assert.equal(new URL(googleCalendarUrl(base)).searchParams.get("location"), null);
  assert.equal(new URL(outlookCalendarUrl(base)).searchParams.get("location"), null);
  assert.equal(new URL(googleCalendarUrl({ ...base, location: null })).searchParams.get("location"), null);
  assert.equal(new URL(outlookCalendarUrl({ ...base, location: "" })).searchParams.get("location"), null);
  const ics = buildIcs({ ...base, uid: "bk_1@skedul.app", location: null });
  assert.ok(!ics.includes("LOCATION"));
  assert.equal(ics, buildIcs({ ...base, uid: "bk_1@skedul.app" }));
});

test("location → Google and Outlook parameter", () => {
  const where = "Parc de la Villette, Paris";
  assert.equal(new URL(googleCalendarUrl({ ...base, location: where })).searchParams.get("location"), where);
  assert.equal(new URL(outlookCalendarUrl({ ...base, location: where })).searchParams.get("location"), where);
  // The other parameters are unchanged.
  const url = new URL(googleCalendarUrl({ ...base, location: where }));
  assert.equal(url.searchParams.get("dates"), "20260703T120000Z/20260703T130000Z");
  assert.equal(url.searchParams.get("text"), "Coaching 1h");
});

test("a bare CR, a CRLF and a LF in a text all become the \\n escape, never a raw CR", () => {
  const ics = buildIcs({ ...base, uid: "bk_3@skedul.app", description: "a\rb\r\nc\nd", location: "Salle 1\rPorte 2" });
  const lines = ics.split("\r\n");
  assert.ok(lines.includes("DESCRIPTION:a\\nb\\nc\\nd"));
  assert.ok(lines.includes("LOCATION:Salle 1\\nPorte 2"));
  // The only CRs of the file are the CRLF line terminators.
  assert.equal(ics.split("\r").length, ics.split("\r\n").length);
});

test("location → ICS LOCATION line right after DESCRIPTION, escaped like other text", () => {
  const ics = buildIcs({ ...base, uid: "bk_2@skedul.app", location: "Gymnase Japy, salle 2; entrée B\nPorte 3" });
  const lines = ics.split("\r\n");
  const description = lines.findIndex((line) => line.startsWith("DESCRIPTION:"));
  assert.equal(lines[description + 1], "LOCATION:Gymnase Japy\\, salle 2\\; entrée B\\nPorte 3");
  assert.equal(lines[description + 2], "END:VEVENT");
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
});

/* Hostile text. RFC 5545 only breaks lines on CRLF, but lenient parsers (Python splitlines, Swift
   .newlines, ...) also break on the characters below: none may reach the file raw. Written as
   \u escapes on purpose. */

/** Characters read as a line break by some parser; the file carries them as the \n escape. */
const LINE_BREAKS = ["\r", "\n", "\r\n", "\u0085", "\u2028", "\u2029"];

/** Every other C0 control (tab excepted), DEL and C1 control: the file drops them. */
const CONTROLS: string[] = [];
for (let code = 0; code <= 0x9f; code++) {
  if (code === 0x09 || code === 0x0a || code === 0x0d || code === 0x85) continue;
  if (code > 0x1f && code < 0x7f) continue;
  CONTROLS.push(String.fromCharCode(code));
}

const FORGED = "ATTENDEE:mailto:evil@example.test";
/** Splits on CRLF and on every single character a lenient parser takes for a line break. */
const physicalLines = (s: string): string[] => s.split(/\r\n|[\n\v\f\r\u001C-\u001E\u0085\u2028\u2029]/);
/** True when `s` holds a control character other than the CRLF terminators (or a tab). */
const hasRawControl = (s: string): boolean => /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/.test(s.replace(/\r\n/g, ""));
const octets = (s: string): number => Buffer.byteLength(s, "utf8");
/** Removes the folds: CRLF followed by one space or tab. */
const unfold = (s: string): string => s.replace(/\r\n[ \t]/g, "");

type TextField = "title" | "description" | "location";
const FIELDS: readonly { field: TextField; line: string }[] = [
  { field: "title", line: "SUMMARY:" },
  { field: "description", line: "DESCRIPTION:" },
  { field: "location", line: "LOCATION:" },
];

function icsWithHostile(field: TextField, value: string): string {
  return buildIcs({ ...base, location: "Salle 1", uid: "bk_h@skedul.app", [field]: value });
}

test("every line-break class in a title, a description or a location becomes the \\n escape, never a new line", () => {
  for (const { field, line } of FIELDS) {
    for (const ch of LINE_BREAKS) {
      const ics = icsWithHostile(field, `x${ch}${FORGED}`);
      const label = `${field} ${JSON.stringify(ch)}`;
      // 13 lines of the file + the empty string after the last terminator: no physical line was added.
      assert.equal(physicalLines(ics).length, 14, label);
      assert.deepEqual(physicalLines(ics), ics.split("\r\n"), label);
      assert.ok(ics.split("\r\n").includes(`${line}x\\n${FORGED}`), label);
      assert.ok(!ics.split("\r\n").some((l) => l.startsWith("ATTENDEE")), label);
      assert.ok(!hasRawControl(ics), label);
    }
  }
});

test("every other control character (C0 except tab, DEL, C1) is dropped, never a new line", () => {
  // 29 C0 (32 minus tab, LF, CR) + DEL + 31 C1 (32 minus NEL): the list is the whole class.
  assert.equal(CONTROLS.length, 29 + 1 + 31);
  for (const { field, line } of FIELDS) {
    for (const ch of CONTROLS) {
      const ics = icsWithHostile(field, `x${ch}${FORGED}`);
      const label = `${field} U+${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
      assert.equal(physicalLines(ics).length, 14, label);
      assert.deepEqual(physicalLines(ics), ics.split("\r\n"), label);
      assert.ok(ics.split("\r\n").includes(`${line}x${FORGED}`), label);
      assert.ok(!hasRawControl(ics), label);
    }
  }
});

test("a mix of line breaks and controls in one text, in every field, leaves one VEVENT and no extra property", () => {
  const mix = `a${CONTROLS.join("")}b${LINE_BREAKS.join("")}c\u000B${FORGED}\u2028BEGIN:VEVENT\u0085${FORGED}`;
  for (const { field } of FIELDS) {
    const ics = icsWithHostile(field, mix);
    // Long: the folds (CRLF + space) are the only physical lines besides the 13 of the file.
    assert.ok(ics.split("\r\n").every((l) => octets(l) <= 75), field);
    assert.equal(physicalLines(unfold(ics)).length, 14, field);
    assert.ok(!physicalLines(ics).some((l) => l.startsWith("ATTENDEE")), field);
    assert.equal(unfold(ics).split("\r\n").filter((l) => l === "BEGIN:VEVENT").length, 1, field);
    assert.ok(!hasRawControl(ics), field);
  }
});

test("a tab is kept in a text", () => {
  assert.ok(buildIcs({ ...base, uid: "bk_t@skedul.app", title: "a\tb" }).split("\r\n").includes("SUMMARY:a\tb"));
});

test("a backslash right before a line break stays a backslash, then the \\n escape", () => {
  // input: a, backslash, LF, b  ->  output: a, \\, \n, b  (two backslashes = one literal, then the n escape)
  const ics = buildIcs({ ...base, uid: "bk_b@skedul.app", title: "a\\\nb" });
  assert.ok(ics.split("\r\n").includes("SUMMARY:a\\\\\\nb"));
});

test("a hostile uid cannot inject a line either", () => {
  for (const ch of [...LINE_BREAKS, ...CONTROLS]) {
    const ics = buildIcs({ ...base, uid: `bk${ch}${FORGED}` });
    const label = `U+${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
    assert.equal(physicalLines(ics).length, 13, label);
    assert.ok(!ics.split("\r\n").some((l) => l.startsWith("ATTENDEE")), label);
    assert.ok(!hasRawControl(ics), label);
  }
  // Text rules apply to the uid too (RFC 5545: UID is TEXT).
  assert.ok(buildIcs({ ...base, uid: "a,b;c" }).split("\r\n").includes("UID:a\\,b\\;c"));
});

/* Folding (RFC 5545 section 3.1): 75 octets per physical line, continuation = CRLF + one space. */

test("a line of exactly 75 octets is not folded, 76 is: 75 on the first line, then 74 after the space", () => {
  const room = 75 - "SUMMARY:".length;
  const exact = buildIcs({ ...base, uid: "bk_f@skedul.app", title: "a".repeat(room) }).split("\r\n");
  assert.ok(exact.includes(`SUMMARY:${"a".repeat(room)}`));
  assert.ok(exact.every((l) => octets(l) <= 75));

  const lines = buildIcs({ ...base, uid: "bk_f@skedul.app", title: "a".repeat(room + 74 + 1) }).split("\r\n");
  const at = lines.indexOf(`SUMMARY:${"a".repeat(room)}`);
  assert.ok(at >= 0);
  assert.equal(lines[at + 1], ` ${"a".repeat(74)}`);
  assert.equal(lines[at + 2], " a");
  assert.equal(lines[at + 3], "DESCRIPTION:Rendez-vous avec Altinha Paris");
});

test("a long title of 2-byte characters folds under 75 octets and unfolds to the exact escaped text", () => {
  const ics = buildIcs({ ...base, uid: "bk_l@skedul.app", title: "é".repeat(120) });
  const lines = ics.split("\r\n");
  assert.ok(lines.every((l) => octets(l) <= 75));
  assert.ok(lines.filter((l) => l.startsWith("SUMMARY:")).length === 1);
  assert.ok(lines.some((l) => l.startsWith(" ")), "folded");
  assert.ok(unfold(ics).split("\r\n").includes(`SUMMARY:${"é".repeat(120)}`));
  // Every physical line is valid UTF-8: no sequence was cut.
  assert.ok(lines.every((l) => Buffer.from(l, "utf8").toString("utf8") === l));
});

test("a long title of 4-byte characters never splits a surrogate pair or a sequence", () => {
  const title = "\u{1F600}".repeat(60);
  const lines = buildIcs({ ...base, uid: "bk_e@skedul.app", title }).split("\r\n");
  assert.ok(lines.every((l) => octets(l) <= 75));
  assert.ok(lines.every((l) => Buffer.from(l, "utf8").toString("utf8") === l));
  assert.ok(unfold(lines.join("\r\n")).split("\r\n").includes(`SUMMARY:${title}`));
});

test("escapes are folded after escaping: the unfolded text is the escaped text, with a long hostile location", () => {
  const location = `${"Salle, 1; ".repeat(20)}\n${FORGED}\u2028${"é".repeat(60)}`;
  const ics = buildIcs({ ...base, uid: "bk_g@skedul.app", location });
  const lines = ics.split("\r\n");
  assert.ok(lines.every((l) => octets(l) <= 75));
  const expected = `LOCATION:${"Salle\\, 1\\; ".repeat(20)}\\n${FORGED}\\n${"é".repeat(60)}`;
  assert.ok(unfold(ics).split("\r\n").includes(expected));
  assert.ok(!hasRawControl(ics));
  // No physical line besides the folds: unfolding gives back the 13 lines of the file.
  assert.equal(unfold(ics).split("\r\n").length, 14);
});

test("a short file is unchanged by folding", () => {
  const ics = buildIcs({ ...base, uid: "bk_s@skedul.app", location: "Parc" });
  assert.ok(!ics.includes("\r\n "));
});
