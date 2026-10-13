import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loginCodeEmail } from "./login-code";
import { redactSubject } from "./redact-subject";
import { verifyEmailCodeEmail } from "./verify-email-code";

test("redactSubject hides the one-time code of both code e-mails", () => {
  for (const mail of [loginCodeEmail({ code: "042917" }), verifyEmailCodeEmail({ code: "735501" })]) {
    const safe = redactSubject(mail.subject);
    assert.ok(!/\d{6}/.test(safe), safe);
    assert.ok(safe.endsWith("Skedul"), safe);
  }
  assert.equal(redactSubject("042917 est votre code de connexion Skedul"), "•••••• est votre code de connexion Skedul");
});

test("redactSubject leaves other subjects untouched", () => {
  for (const subject of ["Votre mot de passe Skedul a été désactivé", "Réservation confirmée : 12 mars", "Pack 1234567 reçu"]) {
    assert.equal(redactSubject(subject), subject);
  }
});

test("sendEmail's delivery-failure logs never print the raw subject", () => {
  // email.ts imports "server-only" and Resend, so it cannot be loaded here: guard its source instead.
  const source = readFileSync(join(__dirname, "..", "email.ts"), "utf8");
  const errorLogs = source.split("\n").filter((line) => line.includes("console.error"));
  assert.equal(errorLogs.length, 2, "expected the rejected and the failed-request log lines");
  for (const line of errorLogs) {
    assert.ok(!line.includes("${subject}"), line);
    assert.ok(line.includes("${redactSubject(subject)}"), line);
  }
});
