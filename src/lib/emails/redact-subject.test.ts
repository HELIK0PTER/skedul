import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OTP_PLUGIN_OPTIONS } from "../auth-options";
import { CODE_LENGTH } from "../public/sign-in-flow";
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

test("redactSubject masks a run of exactly CODE_LENGTH digits, the length of the codes Better Auth makes (P6 A26)", () => {
  const code = "7".repeat(CODE_LENGTH);
  assert.equal(redactSubject(`${code} est votre code`), `${"•".repeat(CODE_LENGTH)} est votre code`);
  assert.equal(redactSubject(`${"7".repeat(CODE_LENGTH + 1)} reçu`), `${"7".repeat(CODE_LENGTH + 1)} reçu`, "a longer number is not a code");
  assert.equal(redactSubject(`${"7".repeat(CODE_LENGTH - 1)} reçu`), `${"7".repeat(CODE_LENGTH - 1)} reçu`, "nor a shorter one");
  assert.equal(OTP_PLUGIN_OPTIONS.otpLength, CODE_LENGTH);
  // One constant for the code length: the redaction and the plugin read it, neither spells the number.
  const redact = readFileSync(join(__dirname, "redact-subject.ts"), "utf8");
  assert.match(redact, /CODE_LENGTH/);
  assert.doesNotMatch(redact, /\\d\{\d+\}/, "no digit count written in the pattern");
  const options = readFileSync(join(__dirname, "..", "auth-options.ts"), "utf8");
  assert.match(options, /^\s+otpLength: CODE_LENGTH,$/m);
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
