import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { loginCodeEmail } from "./login-code";
import { mockMailLog, mockMailRefusal } from "./mock-log";

const html = '<p>Bonjour</p><a href="https://app.test/api/c/cus_1.2.mac_x">Voir</a>';

test("mockMailLog in development: recipient, subject and links, so a flow can be followed without a mailbox", () => {
  const log = mockMailLog({ to: "lea@example.com", subject: "042917 est votre code de connexion Skedul", html }, false);
  assert.ok(log.includes("lea@example.com"));
  assert.ok(log.includes("042917 est votre code de connexion Skedul"));
  assert.ok(log.includes("link: https://app.test/api/c/cus_1.2.mac_x"));
});

test("mockMailLog in a production build: the redacted subject only, never the recipient, a code or a link (SEC-3)", () => {
  const mail = loginCodeEmail({ code: "042917" });
  const log = mockMailLog({ to: "lea@example.com", subject: mail.subject, html }, true);
  assert.equal(log, "[email:mock] •••••• est votre code de connexion Skedul");
  assert.ok(!log.includes("lea@example.com") && !log.includes("@"));
  assert.ok(!/\d{6}/.test(log));
  assert.ok(!log.includes("http"));
  assert.ok(!log.includes("\n"), "one line");
});

test("mockMailRefusal: mock e-mail is refused when APP_ENV is production, allowed elsewhere or with a real key (SEC-3)", () => {
  assert.match(mockMailRefusal("production", false) ?? "", /RESEND_API_KEY/);
  assert.equal(mockMailRefusal("production", true), null);
  assert.equal(mockMailRefusal("preview", false), null);
  assert.equal(mockMailRefusal("development", false), null);
});

test("sendEmail logs the mock mail through mockMailLog and refuses mock e-mail in production", () => {
  // email.ts imports "server-only" and Resend, so it cannot be loaded here: guard its source instead.
  const source = readFileSync(join(__dirname, "..", "email.ts"), "utf8");
  assert.match(source, /mockMailLog\(\{ to, subject, html \}, process\.env\.NODE_ENV === "production"\)/);
  assert.match(source, /mockMailRefusal\(env\.APP_ENV, env\.RESEND_ENABLED\)/);
  assert.ok(!source.includes("[email:mock] →"), "the recipient is no longer printed by email.ts itself");
});
