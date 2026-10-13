import test from "node:test";
import assert from "node:assert/strict";

import { loginCodeEmail } from "./login-code";
import { passwordDisabledEmail } from "./password-disabled";
import { passwordResetEmail } from "./password-reset";
import { verifyEmailCodeEmail } from "./verify-email-code";

/** How the DB tests and the auth harness read a code back (src/test/auth.ts). */
const CODE_RE = /^(\d{6})\b/;

test("the sign-in code leads the subject and is shown in the body", () => {
  const mail = loginCodeEmail({ code: "042917" });
  assert.equal(mail.subject, "042917 est votre code de connexion Skedul");
  assert.equal(CODE_RE.exec(mail.subject)?.[1], "042917");
  assert.ok(mail.html.includes("Votre code de connexion"));
  assert.ok(mail.html.includes(">042917</p>"));
  assert.ok(mail.html.includes("Il est valable 5 minutes."));
});

test("the confirmation code leads the subject and is shown in the body", () => {
  const mail = verifyEmailCodeEmail({ code: "735501" });
  assert.equal(mail.subject, "735501 est votre code de confirmation Skedul");
  assert.equal(CODE_RE.exec(mail.subject)?.[1], "735501");
  assert.ok(mail.html.includes("Confirmez votre adresse"));
  assert.ok(mail.html.includes(">735501</p>"));
});

test("codes are escaped in the HTML body", () => {
  for (const mail of [loginCodeEmail({ code: "<b>1</b>" }), verifyEmailCodeEmail({ code: "<b>1</b>" })]) {
    assert.ok(!mail.html.includes("<b>1</b>"));
    assert.ok(mail.html.includes("&lt;b&gt;1&lt;/b&gt;"));
  }
});

test("the password-disabled e-mail explains the purge and links to « Mot de passe oublié »", () => {
  const mail = passwordDisabledEmail({ forgotPasswordUrl: "https://myskedul.com/forgot-password" });
  assert.equal(mail.subject, "Votre mot de passe Skedul a été désactivé");
  assert.ok(
    mail.html.includes(
      "Pour votre sécurité, le mot de passe associé à cette adresse a été désactivé ; utilisez « Mot de passe oublié » pour en choisir un.",
    ),
  );
  assert.ok(mail.html.includes('href="https://myskedul.com/forgot-password"'));
  assert.ok(mail.html.includes(">Choisir un mot de passe</a>"));
});

test("the password-disabled link is escaped", () => {
  const mail = passwordDisabledEmail({ forgotPasswordUrl: 'https://x.test/"><script>' });
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(mail.html.includes("https://x.test/&quot;&gt;&lt;script&gt;"));
});

test("the password-reset e-mail keeps its content after the move", () => {
  const html = passwordResetEmail({ name: "  Ana <b>Souza</b> ", url: "https://myskedul.com/reset?a=1&b=2" });
  assert.ok(html.includes("Choisissez un nouveau mot de passe"));
  assert.ok(html.includes("<p>Bonjour Ana,</p>"));
  assert.ok(html.includes('href="https://myskedul.com/reset?a=1&amp;b=2"'));
  assert.ok(html.includes("Ce lien est valable 1 heure et ne sert qu'une fois."));
  assert.ok(!html.includes("<b>Souza</b>"));
});

test("an empty name gives a plain « Bonjour, »", () => {
  assert.ok(passwordResetEmail({ name: "   ", url: "https://x.test" }).includes("<p>Bonjour,</p>"));
});

test("no auth e-mail contains an em dash", () => {
  const mails = [
    loginCodeEmail({ code: "123456" }),
    verifyEmailCodeEmail({ code: "123456" }),
    passwordDisabledEmail({ forgotPasswordUrl: "https://x.test" }),
    { subject: "", html: passwordResetEmail({ name: "Ana", url: "https://x.test" }) },
  ];
  for (const mail of mails) {
    assert.ok(!mail.subject.includes("—"), mail.subject);
    assert.ok(!mail.html.includes("—"), mail.subject);
  }
});
