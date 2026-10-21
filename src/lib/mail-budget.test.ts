import test from "node:test";
import assert from "node:assert/strict";

import { mailBudgetLogLine, PRO_MAIL_BUDGET } from "./mail-budget";
import { proMailThrottleKey } from "./throttle";

test("PRO_MAIL_BUDGET: 50 client e-mails per 24 h until the pro's own address is verified, 2000 after", () => {
  assert.deepEqual(PRO_MAIL_BUDGET, { unverified: 50, verified: 2000, windowSec: 86_400 });
});

test("proMailThrottleKey: one counter per pro, apart from every auth and public key", () => {
  assert.equal(proMailThrottleKey("pro_1"), "t:mail:p:pro_1");
  assert.notEqual(proMailThrottleKey("pro_1"), proMailThrottleKey("pro_2"));
  assert.ok(!proMailThrottleKey("pro_1").startsWith("t:otp:") && !proMailThrottleKey("pro_1").startsWith("t:reset:"));
});

test("mailBudgetLogLine: ids and counts only, never an address", () => {
  const line = mailBudgetLogLine("pro_1", 7);
  assert.equal(line, "[notify] mail budget reached for pro pro_1: 7 e-mail(s) not sent");
  assert.ok(!line.includes("@"));
  assert.ok(!line.includes("\n"));
});
