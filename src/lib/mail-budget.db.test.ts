import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";

import { createTestPro, dbTest, deleteTestUser, testEmail } from "../test/db";
import { user } from "./db/schema";
import { applyMailBudget, PRO_MAIL_BUDGET } from "./mail-budget";
import type { EffectPlan, OutgoingEmail } from "./notify-core";
import { proMailThrottleKey } from "./throttle";

type EmailsPlan = Extract<EffectPlan, { kind: "emails" }>;

const T0 = new Date("2026-10-21T10:00:00Z");
const after = (sec: number) => new Date(T0.getTime() + sec * 1000);

function mails(n: number): OutgoingEmail[] {
  return Array.from({ length: n }, (_, i) => ({ to: testEmail(`mb${i}`), subject: `Sujet ${i}`, html: "<p>x</p>" }));
}

function planFor(professionalId: string, n: number): EmailsPlan {
  return { kind: "emails", professionalId, emails: mails(n) };
}

const SMALL = { unverified: 3, verified: 5, windowSec: 3600 } as const;

dbTest("mail budget: the N+1th e-mail of a pro is not sent, another pro is unaffected", async ({ db, pro }) => {
  const other = await createTestPro(db);
  try {
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, pro.userId));
    const first = await applyMailBudget(db, planFor(pro.proId, 2), T0, SMALL);
    assert.equal(first.send.length, 2);
    assert.equal(first.dropped, 0);
    const second = await applyMailBudget(db, planFor(pro.proId, 2), after(60), SMALL);
    assert.equal(second.send.length, 1, "3 allowed, 2 already used: one more leaves");
    assert.equal(second.dropped, 1);
    const third = await applyMailBudget(db, planFor(pro.proId, 1), after(120), SMALL);
    assert.equal(third.send.length, 0);
    assert.equal(third.dropped, 1);
    // The other pro (verified, own counter) is untouched by the first one's spending.
    const otherRun = await applyMailBudget(db, planFor(other.proId, 5), after(180), SMALL);
    assert.equal(otherRun.send.length, 5);
    assert.equal(otherRun.dropped, 0);
  } finally {
    await db.execute(
      sql`delete from throttle where key = any(${sql.param([proMailThrottleKey(pro.proId), proMailThrottleKey(other.proId)])}::text[])`,
    );
    await deleteTestUser(db, other.userId);
  }
});

dbTest("mail budget: a verified address gets the higher budget, the mails sent are the first ones of the plan", async ({ db, pro }) => {
  try {
    const plan = planFor(pro.proId, 7);
    const run = await applyMailBudget(db, plan, T0, SMALL);
    assert.deepEqual(run.send, plan.emails.slice(0, 5), "verified: 5, in plan order");
    assert.equal(run.dropped, 2);
  } finally {
    await db.execute(sql`delete from throttle where key = ${proMailThrottleKey(pro.proId)}`);
  }
});

dbTest("mail budget: the production numbers, 50 then the 51st is dropped while unverified", async ({ db, pro }) => {
  try {
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, pro.userId));
    const run = await applyMailBudget(db, planFor(pro.proId, PRO_MAIL_BUDGET.unverified + 1), T0);
    assert.equal(run.send.length, PRO_MAIL_BUDGET.unverified);
    assert.equal(run.dropped, 1);
  } finally {
    await db.execute(sql`delete from throttle where key = ${proMailThrottleKey(pro.proId)}`);
  }
});

dbTest("mail budget: the window reopens after windowSec", async ({ db, pro }) => {
  try {
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, pro.userId));
    const spent = await applyMailBudget(db, planFor(pro.proId, 3), T0, SMALL);
    assert.equal(spent.send.length, 3);
    assert.equal((await applyMailBudget(db, planFor(pro.proId, 1), after(3599), SMALL)).send.length, 0);
    const reopened = await applyMailBudget(db, planFor(pro.proId, 2), after(3600), SMALL);
    assert.equal(reopened.send.length, 2);
    assert.equal(reopened.dropped, 0);
  } finally {
    await db.execute(sql`delete from throttle where key = ${proMailThrottleKey(pro.proId)}`);
  }
});

dbTest("mail budget: an empty plan spends nothing; a plan with no pro sends nothing", async ({ db, pro }) => {
  try {
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, pro.userId));
    const empty = await applyMailBudget(db, planFor(pro.proId, 0), T0, SMALL);
    assert.deepEqual(empty, { send: [], dropped: 0 });
    // Still the full budget afterwards.
    assert.equal((await applyMailBudget(db, planFor(pro.proId, 3), after(1), SMALL)).send.length, 3);
    const orphan = await applyMailBudget(db, { kind: "emails", professionalId: null, emails: mails(2) }, T0, SMALL);
    assert.deepEqual(orphan, { send: [], dropped: 2 });
  } finally {
    await db.execute(sql`delete from throttle where key = ${proMailThrottleKey(pro.proId)}`);
  }
});
