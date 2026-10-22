import assert from "node:assert/strict";
import test from "node:test";

import type { Effect } from "@/lib/booking/types";
import { mailBudgetLogLine, type EffectBudget } from "@/lib/mail-budget";
import type { EffectPlan, OutgoingEmail } from "@/lib/notify-core";

import { runEffectsWith, type RunEffectsDeps } from "./notify-run";

const MAIL_A: OutgoingEmail = { to: "a@example.com", subject: "Sujet A", html: "<p>A</p>" };
const MAIL_B: OutgoingEmail = { to: "b@example.com", subject: "Sujet B", html: "<p>B</p>" };
const CONFIRMED: Effect = { type: "email.booking_confirmed", bookingId: "b1" };
const RECEIPT: Effect = { type: "email.purchase_receipt", purchaseId: "p1" };
const SYNC: Effect = { type: "google.sync_occurrence", occurrenceId: "o1" };
const EXPIRE: Effect = { type: "stripe.expire_session", purchaseId: "p1", checkoutSessionId: "cs_test_1" };

function emailsPlan(emails: OutgoingEmail[], professionalId: string | null = "pro_1"): EffectPlan {
  return { kind: "emails", professionalId, emails };
}

type Seen = {
  planned: string[];
  budgets: EffectBudget[];
  sent: string[];
  synced: string[];
  expired: string[];
  logs: string[];
  warns: string[];
};

/** Fake deps: `plans` scripts what planEffect answers per effect type (an Error is thrown). */
function harness(plans: Record<string, EffectPlan | Error>, over: Partial<RunEffectsDeps> = {}) {
  const seen: Seen = { planned: [], budgets: [], sent: [], synced: [], expired: [], logs: [], warns: [] };
  const deps: RunEffectsDeps = {
    plan: async (effect) => {
      seen.planned.push(effect.type);
      const plan = plans[effect.type];
      if (plan instanceof Error) throw plan;
      if (!plan) throw new Error(`no plan scripted for ${effect.type}`);
      return plan;
    },
    mailsToSend: async (plan, budget) => {
      seen.budgets.push(budget);
      return { send: plan.emails, dropped: 0 };
    },
    sendEmail: async (mail) => {
      seen.sent.push(mail.subject);
    },
    syncOccurrence: async (occurrenceId) => {
      seen.synced.push(occurrenceId);
    },
    expireCheckout: async (checkoutSessionId) => {
      seen.expired.push(checkoutSessionId);
    },
    log: (line) => {
      seen.logs.push(line);
    },
    warn: (line) => {
      seen.warns.push(line);
    },
    ...over,
  };
  return { deps, seen };
}

test("duplicates run once and the Google syncs run last, like dedupeEffects says", async () => {
  const { deps, seen } = harness({
    "email.booking_confirmed": emailsPlan([MAIL_A]),
    "email.purchase_receipt": emailsPlan([MAIL_B]),
    "google.sync_occurrence": { kind: "google", occurrenceId: "o1" },
  });
  await runEffectsWith(deps, [SYNC, CONFIRMED, CONFIRMED, RECEIPT, { ...SYNC }], "none");
  assert.deepEqual(seen.planned, ["email.booking_confirmed", "email.purchase_receipt", "google.sync_occurrence"]);
  assert.deepEqual(seen.sent, ["Sujet A", "Sujet B"]);
  assert.deepEqual(seen.synced, ["o1"]);
});

test("S49: mailsToSend receives the budget the run was given, \"pro\" and \"none\" alike", async () => {
  for (const budget of ["pro", "none"] as const) {
    const { deps, seen } = harness({ "email.booking_confirmed": emailsPlan([MAIL_A]) });
    await runEffectsWith(deps, [CONFIRMED], budget);
    assert.deepEqual(seen.budgets, [budget]);
    assert.deepEqual(seen.sent, ["Sujet A"]);
  }
});

test("the budget is required: runEffectsWith has no default (tsc proves it, Decision 74)", async () => {
  const { deps } = harness({});
  // @ts-expect-error the third argument is required: a caller must say "pro" or "none"
  await runEffectsWith(deps, []);
});

test("S49: a cut « pro » plan sends only the mails it kept and warns one line with the pro id and the count, no address", async () => {
  const { deps, seen } = harness(
    { "email.booking_confirmed": emailsPlan([MAIL_A, MAIL_B], "pro_1") },
    { mailsToSend: async (plan) => ({ send: plan.emails.slice(0, 1), dropped: 1 }) },
  );
  await runEffectsWith(deps, [CONFIRMED], "pro");
  assert.deepEqual(seen.sent, ["Sujet A"]);
  assert.deepEqual(seen.warns, [mailBudgetLogLine("pro_1", 1)]);
  assert.equal(seen.warns[0], "[notify] mail budget reached for pro pro_1: 1 e-mail(s) not sent");
  for (const line of seen.warns) assert.equal(line.includes("@"), false);

  const two = harness({ "email.booking_confirmed": emailsPlan([MAIL_A, MAIL_B], "pro_2") }, { mailsToSend: async () => ({ send: [], dropped: 2 }) });
  await runEffectsWith(two.deps, [CONFIRMED], "pro");
  assert.deepEqual(two.seen.sent, []);
  assert.deepEqual(two.seen.warns, ["[notify] mail budget reached for pro pro_2: 2 e-mail(s) not sent"]);
});

test("a plan that names no pro warns nothing, even when mailsToSend dropped its mails", async () => {
  const { deps, seen } = harness(
    { "email.booking_confirmed": emailsPlan([MAIL_A], null) },
    { mailsToSend: async () => ({ send: [], dropped: 1 }) },
  );
  await runEffectsWith(deps, [CONFIRMED], "pro");
  assert.deepEqual(seen.warns, []);
  assert.deepEqual(seen.sent, []);
});

test("a throwing plan is logged without an address and the next effect still runs", async () => {
  const { deps, seen } = harness({
    "email.booking_confirmed": new Error("read failed for beatriz@example.com"),
    "email.purchase_receipt": emailsPlan([MAIL_B]),
  });
  await runEffectsWith(deps, [CONFIRMED, RECEIPT], "none");
  assert.deepEqual(seen.logs, ["[notify] email.booking_confirmed failed: read failed for [email]"]);
  assert.deepEqual(seen.sent, ["Sujet B"]);
});

test("a throwing send is logged without an address, never thrown, and the next effect still runs", async () => {
  const { deps, seen } = harness(
    {
      "email.booking_confirmed": emailsPlan([MAIL_A]),
      "google.sync_occurrence": { kind: "google", occurrenceId: "o1" },
    },
    {
      sendEmail: async (mail) => {
        throw new Error(`Resend refused ${mail.to}`);
      },
    },
  );
  await runEffectsWith(deps, [CONFIRMED, SYNC], "none");
  assert.deepEqual(seen.logs, ["[notify] email.booking_confirmed failed: Resend refused [email]"]);
  assert.deepEqual(seen.synced, ["o1"], "the Google sync after the failing e-mail still ran");
});

test("Google and Stripe plans call their dependency with the planned id", async () => {
  const { deps, seen } = harness({
    "google.sync_occurrence": { kind: "google", occurrenceId: "occ_9" },
    "stripe.expire_session": { kind: "stripe", purchaseId: "p1", checkoutSessionId: "cs_test_9" },
  });
  await runEffectsWith(deps, [SYNC, EXPIRE], "none");
  assert.deepEqual(seen.synced, ["occ_9"]);
  assert.deepEqual(seen.expired, ["cs_test_9"]);
  assert.deepEqual(seen.logs, []);
});

test("a failing Google sync or Stripe expiry is logged with the effect type and never thrown", async () => {
  const { deps, seen } = harness(
    {
      "google.sync_occurrence": { kind: "google", occurrenceId: "o1" },
      "stripe.expire_session": { kind: "stripe", purchaseId: "p1", checkoutSessionId: "cs_test_1" },
    },
    {
      syncOccurrence: async () => {
        throw new Error("calendar down");
      },
      expireCheckout: async () => {
        throw new Error("no session cs_test_1");
      },
    },
  );
  await runEffectsWith(deps, [SYNC, EXPIRE], "none");
  assert.deepEqual(seen.logs, [
    "[notify] stripe.expire_session failed: no session [session]",
    "[notify] google.sync_occurrence failed: calendar down",
  ]);
});

test("an outer failure is logged as « run failed » and never thrown", async () => {
  const { deps, seen } = harness({});
  const broken = {
    [Symbol.iterator]() {
      throw new Error("iteration failed for beatriz@example.com");
    },
  } as unknown as Effect[];
  await runEffectsWith(deps, broken, "none");
  assert.deepEqual(seen.logs, ["[notify] run failed: iteration failed for [email]"]);
  assert.deepEqual(seen.planned, []);
});

test("S31: whatever fails, no log or warn line carries an address", async () => {
  const { deps, seen } = harness(
    {
      "email.booking_confirmed": new Error("lookup of x@example.com failed"),
      "email.purchase_receipt": emailsPlan([MAIL_A, MAIL_B], "pro_1"),
    },
    {
      mailsToSend: async (plan) => ({ send: plan.emails.slice(0, 1), dropped: 1 }),
      sendEmail: async (mail) => {
        throw new Error(`bounce for ${mail.to}`);
      },
    },
  );
  await runEffectsWith(deps, [CONFIRMED, RECEIPT], "pro");
  assert.ok(seen.logs.length >= 2);
  for (const line of [...seen.logs, ...seen.warns]) assert.equal(line.includes("@"), false, line);
});
