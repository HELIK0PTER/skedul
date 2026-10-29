import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { layout } from "../email-layout";
import { loginCodeEmail } from "./login-code";
import { mailButton, mailCalendarButtons, mailDetails, mailLines, mailParagraph } from "./parts";
import { passwordDisabledEmail } from "./password-disabled";
import { passwordResetEmail } from "./password-reset";
import { decodeEntities, htmlToText } from "./plain-text";
import { verifyEmailCodeEmail } from "./verify-email-code";

/** What no text part may hold: a tag, an entity, a line with spaces around it, two blank lines in a row. */
function assertClean(text: string, what: string): void {
  assert.ok(text.length > 0, `${what}: empty`);
  assert.doesNotMatch(text, /<[a-z!/]/i, `${what}: a tag left`);
  assert.doesNotMatch(text, /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i, `${what}: an entity left`);
  for (const line of text.split("\n")) assert.equal(line, line.trim(), `${what}: spaces around « ${line} »`);
  assert.doesNotMatch(text, /\n{3}/, `${what}: two blank lines in a row`);
  assert.equal(text, text.trim(), `${what}: blank lines around`);
}

test("the text part of a code mail holds the code, its title and every sentence, and nothing of the markup (P6 A26)", () => {
  for (const [mail, code] of [
    [loginCodeEmail({ code: "042917" }), "042917"],
    [verifyEmailCodeEmail({ code: "735501" }), "735501"],
  ] as const) {
    const text = htmlToText(mail.html);
    assertClean(text, mail.subject);
    assert.ok(text.split("\n").includes(code), `the code on a line of its own: ${text}`);
    assert.ok(text.startsWith("Skedul\n"), text);
  }
  const login = htmlToText(loginCodeEmail({ code: "042917" }).html);
  assert.ok(login.includes("Votre code de connexion"));
  assert.ok(login.includes("Il est valable 5 minutes."));
  assert.ok(login.includes("Si vous n'avez pas demandé ce code, ignorez cet email"), "the escaped apostrophe is read back");
});

test("a link keeps its address in the text part, its entities decoded, after its label (P6 A26)", () => {
  const url = "https://myskedul.com/api/auth/reset-password/tok_1?callbackURL=%2Freset-password&x=1";
  const text = htmlToText(passwordResetEmail({ name: "Marie Dupont", url }));
  assertClean(text, "reset");
  assert.ok(text.includes(`Choisir un nouveau mot de passe : ${url}`), text);
  assert.ok(text.includes("Bonjour Marie,"));
  const disabled = htmlToText(passwordDisabledEmail({ forgotPasswordUrl: "https://myskedul.com/forgot-password" }).html);
  assertClean(disabled, "password disabled");
  assert.ok(disabled.includes("https://myskedul.com/forgot-password"), disabled);
  // A link whose label is its address is written once.
  assert.equal(htmlToText('<p><a href="https://a.test/x">https://a.test/x</a></p>'), "https://a.test/x");
});

test("the building blocks of the client mails read as lines: paragraphs, broken lines, label : value rows, buttons (P6 A26)", () => {
  const html = layout(
    "Réservation confirmée",
    [
      mailParagraph("Bonjour Léa & Max,"),
      mailLines(["Cours de yoga", "Mardi 12 mars, 18 h 30"]),
      mailDetails([
        { label: "Lieu", value: "Studio Nord & Sud" },
        { label: "Tickets restants", value: "3" },
      ]),
      mailButton("https://myskedul.com/api/c/cus_1.2.mac?a=1&b=2", "Voir mes réservations"),
      mailCalendarButtons({ googleUrl: "https://g.test/a", outlookUrl: "https://o.test/b", icsUrl: "https://myskedul.com/api/ics/c" }),
    ].join("\n"),
  );
  const text = htmlToText(html);
  assertClean(text, "client mail");
  const lines = text.split("\n");
  for (const line of [
    "Réservation confirmée",
    "Bonjour Léa & Max,",
    "Cours de yoga",
    "Mardi 12 mars, 18 h 30",
    "Lieu : Studio Nord & Sud",
    "Tickets restants : 3",
    "Voir mes réservations : https://myskedul.com/api/c/cus_1.2.mac?a=1&b=2",
    "Ajouter à Google Agenda : https://g.test/a",
    "Ajouter à Outlook : https://o.test/b",
    "Télécharger pour mon agenda (.ics) : https://myskedul.com/api/ics/c",
    "Envoyé par Skedul · Réservations et tickets",
  ]) {
    assert.ok(lines.includes(line), `« ${line} » in\n${text}`);
  }
});

test("decodeEntities reads every entity once: named, decimal and hexadecimal, never twice", () => {
  assert.equal(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; f&nbsp;g &#233; &#xE9;"), "a & b <c> \"d\" 'e' f g é é");
  assert.equal(decodeEntities("&amp;lt; &amp;amp;"), "&lt; &amp;", "an escaped entity stays an entity");
  assert.equal(decodeEntities("&unknown; &#xZZ;"), "&unknown; &#xZZ;");
  // Tags go before the entities are read: an escaped « <b> » typed by someone is text, never markup to drop.
  assert.equal(htmlToText("<p>Salle &lt;b&gt; A</p>"), "Salle <b> A");
});

test("htmlToText drops what a reader never sees: a head, a style, a script and comments", () => {
  const text = htmlToText(
    "<!doctype html><html><head><title>T</title><style>p{color:red}</style></head><body><!-- hidden --><script>x()</script><p>Visible</p></body></html>",
  );
  assert.equal(text, "Visible");
});

test("sendEmail sends a text part with every mail: the caller's own, else the one read off the HTML (P6 A26)", () => {
  // email.ts imports "server-only" and Resend, so it cannot be loaded here: guard its source instead.
  const source = readFileSync(join(__dirname, "..", "email.ts"), "utf8");
  assert.match(source, /export async function sendEmail\(\{ to, subject, html, text \}: SendArgs\)/);
  assert.match(source, /^\s+text\?: string;$/m);
  assert.match(source, /const body = text \?\? htmlToText\(html\);/);
  assert.match(source, /resend\.emails\.send\(\{\s*from: env\.EMAIL_FROM,\s*to,\s*subject,\s*html,\s*text: body,\s*\}\)/);
});
