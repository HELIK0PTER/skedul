/**
 * Auth DB tests (spec § 14: T12, T13, T15) through auth.handler, like HTTP.
 * Not dbTest: these users are created by Better Auth itself; each test uses
 * unique addresses and random IPs (rate-limit and throttle rows persist) and
 * deletes its users in a finally.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql, type Query } from "drizzle-orm";
import { nanoid } from "nanoid";

import { browser, deleteUsersByEmail, makeTestAuth, TEST_BASE_URL, type BrowserCall, type TestAuth } from "../test/auth";
import { createTestPro, DB_SKIP, deleteTestUser, getTestDb, testEmail, testIp } from "../test/db";
import type { Db } from "./db/atomic";
import * as schema from "./db/schema";
import { otpThrottleKey, resetThrottleKey } from "./throttle";

const OPTS = { skip: DB_SKIP, timeout: 120_000 };
const CODE_RE = /^(\d{6})\b/;
const PASSWORD = "password123";
const PASSWORD_DISABLED = "Votre mot de passe Skedul a été désactivé";
const RESET_SUBJECT = "Réinitialisez votre mot de passe Skedul";
const RESET_REDIRECT = `${TEST_BASE_URL}/reset-password`;

async function userByEmail(db: Db, email: string) {
  const [row] = await db.select().from(schema.user).where(eq(schema.user.email, email));
  assert.ok(row, `no user for ${email}`);
  return row;
}

async function credentialCount(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "credential")));
  return rows.length;
}

async function sessionCount(db: Db, userId: string): Promise<number> {
  const rows = await db.select({ id: schema.session.id }).from(schema.session).where(eq(schema.session.userId, userId));
  return rows.length;
}

function sessionEmail(json: Record<string, unknown> | null): string | undefined {
  return (json?.user as { email?: string } | undefined)?.email;
}

/* ───────── helpers of the takeover / caps regression tests ───────── */

async function sessionIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.select({ id: schema.session.id }).from(schema.session).where(eq(schema.session.userId, userId));
  return rows.map((r) => r.id).sort();
}

/** Hits of a `throttle` row, or null when the key has no row. */
async function throttleHits(db: Db, key: string): Promise<number | null> {
  const [row] = await db.select({ hits: schema.throttle.hits }).from(schema.throttle).where(eq(schema.throttle.key, key));
  return row ? row.hits : null;
}

/** Signs `email` up (own browser, own IP unless given) and returns that browser. */
async function signUp(t: TestAuth, email: string, ip?: string) {
  const call = browser(t, ip);
  const res = await call("/sign-up/email", { email, password: PASSWORD, name: "Client" });
  assert.equal(res.status, 200, `sign-up of ${email}`);
  return call;
}

/** Asks for a sign-in code and signs in with it, spelling the address as typed. */
async function codeSignIn(t: TestAuth, call: BrowserCall, typedEmail: string) {
  const sent = await call("/email-otp/send-verification-otp", { email: typedEmail, type: "sign-in" });
  assert.equal(sent.status, 200, "code request");
  const otp = t.lastCode(typedEmail);
  assert.ok(otp, "no sign-in code captured");
  return call("/sign-in/email-otp", { email: typedEmail, otp });
}

/** Alternating-case spelling of an address: Better Auth lower-cases it on every route. */
function mixedCase(email: string): string {
  return [...email].map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c)).join("");
}

/** Makes the Better Auth window of `ip` on `path` look 2 minutes older (past a 60 s window, inside the 600 s one). */
async function ageRateLimit(db: Db, ip: string, path: string): Promise<void> {
  const key = `${ip}|${path}`;
  const res = await db.execute(sql`update rate_limit set last_request = last_request - 120000 where key = ${key} returning key`);
  assert.equal(res.rows.length, 1, `exactly one rate_limit row to age for ${key}`);
}

/**
 * Captures what Better Auth logs through console.warn / console.error during this test (expected: rejected
 * requests, unknown addresses, a simulated failure). node:test restores both methods when the test ends.
 */
function captureLogs(ctx: TestContext): string[] {
  const lines: string[] = [];
  const grab = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  ctx.mock.method(console, "warn", grab);
  ctx.mock.method(console, "error", grab);
  return lines;
}

/**
 * The same db, except that the first `execute`, or the first `batch` holding a statement, that satisfies
 * `matches` rejects with "simulated failure: <what>" (a batch fails as a whole, like a rolled-back
 * transaction). `assertFired()` fails with a message naming the statement when it never matched, so a
 * renamed CTE or a changed key reads as that, not as an unrelated assertion.
 */
function failingDb(db: Db, what: string, matches: (statement: Query) => boolean) {
  let fired = false;
  const fire = () => {
    fired = true;
    return Promise.reject(new Error(`simulated failure: ${what}`));
  };
  const hits = (q: unknown) => !fired && matches((q as { getQuery(): Query }).getQuery());
  const proxy = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "batch") {
        return (queries: Parameters<Db["batch"]>[0]) => (queries.some(hits) ? fire() : target.batch(queries));
      }
      if (prop !== "execute") return Reflect.get(target, prop, receiver);
      return (query: Parameters<Db["execute"]>[0]) => {
        const raw = target.execute(query);
        // Awaited alone, a raw query runs its own `execute`; inside a batch it never does.
        if (hits(raw)) {
          const own = raw as unknown as { execute: () => Promise<unknown> };
          const run = own.execute;
          own.execute = () => (fired ? run() : fire());
        }
        return raw;
      };
    },
  });
  return {
    db: proxy,
    assertFired() {
      assert.ok(fired, `the failing db never saw ${what}: did that statement change?`);
    },
  };
}

test("T12 a sign-in code on an unverified password account deletes the password and the other sessions", OPTS, async () => {
  const db = await getTestDb();
  const t = makeTestAuth(db);
  const email = testEmail("t12");
  try {
    const attacker = browser(t);
    const signUp = await attacker("/sign-up/email", { email, password: "password123", name: "Intrus" });
    assert.equal(signUp.status, 200);
    const user = await userByEmail(db, email);
    assert.equal(user.emailVerified, false);
    assert.equal(await credentialCount(db, user.id), 1);

    const victim = browser(t);
    assert.equal((await victim("/email-otp/send-verification-otp", { email, type: "sign-in" })).status, 200);
    const codeMail = t.mails[t.mails.length - 1];
    assert.equal(codeMail.to, email);
    assert.ok(codeMail.subject.endsWith("est votre code de connexion Skedul"), codeMail.subject);
    const otp = t.lastCode(email);
    assert.ok(otp, "no sign-in code captured");
    assert.equal((await victim("/sign-in/email-otp", { email, otp })).status, 200);

    assert.equal((await userByEmail(db, email)).emailVerified, true);
    assert.equal(await credentialCount(db, user.id), 0, "the password set at sign-up must be gone");
    assert.equal(await sessionCount(db, user.id), 1, "only the session created by the code survives");

    // Cached read FIRST: a no-cache read expires the jar's cookies. The 5-min
    // cookie cache still shows the attacker, which is why every client-data
    // read uses disableCookieCache (spec § 12).
    assert.notEqual((await attacker("/get-session")).json, null);
    assert.equal((await attacker("/get-session?disableCookieCache=true")).json, null);
    assert.equal(sessionEmail((await victim("/get-session?disableCookieCache=true")).json), email);

    const disabled = t.mails.filter((m) => m.to === email && m.subject === PASSWORD_DISABLED);
    assert.equal(disabled.length, 1);
    assert.ok(disabled[0].html.includes(`href="${TEST_BASE_URL}/forgot-password"`));
  } finally {
    await deleteUsersByEmail(db, [email]);
  }
});

test("T13 the 6th code request of the hour sends nothing and the first code still signs in", OPTS, async () => {
  const db = await getTestDb();
  const t = makeTestAuth(db);
  const email = testEmail("t13");
  try {
    // A new browser (new IP) per request: only the per-address cap can bite.
    for (let i = 1; i <= 6; i++) {
      const res = await browser(t)("/email-otp/send-verification-otp", { email, type: "sign-in" });
      assert.equal(res.status, 200, `request ${i}`);
      assert.deepEqual(res.json, { success: true }, `request ${i}`);
    }
    const sent = t.mails.filter((m) => m.to === email);
    assert.equal(sent.length, 5, "the 6th request must not send an e-mail");
    const codes = sent.map((m) => CODE_RE.exec(m.subject)?.[1]);
    assert.ok(codes[0], "no code in the first e-mail");
    assert.deepEqual(new Set(codes), new Set([codes[0]]), "a resend within 5 minutes reuses the first code");

    const signIn = await browser(t)("/sign-in/email-otp", { email, otp: codes[0] });
    assert.equal(signIn.status, 200);
    const user = await userByEmail(db, email);
    assert.equal(user.emailVerified, true);
    assert.equal(user.role, "client");
  } finally {
    await deleteUsersByEmail(db, [email]);
  }
});

test("T15 a signed-in unverified user confirms the address by code and keeps the password", OPTS, async () => {
  const db = await getTestDb();
  const t = makeTestAuth(db);
  const email = testEmail("t15");
  try {
    const call = browser(t);
    assert.equal((await call("/sign-up/email", { email, password: "password123", name: "Client" })).status, 200);
    const signUpMails = t.mails.filter((m) => m.to === email);
    assert.equal(signUpMails.length, 1, "a password sign-up sends exactly one code");
    assert.ok(signUpMails[0].subject.endsWith("est votre code de confirmation Skedul"), signUpMails[0].subject);
    assert.ok(!signUpMails[0].html.includes("/verify-email?token="), "a code, never a link");

    const otp = t.lastCode(email);
    assert.ok(otp, "no confirmation code captured");
    assert.equal((await call("/email-otp/verify-email", { email, otp })).status, 200);

    const user = await userByEmail(db, email);
    assert.equal(user.emailVerified, true);
    assert.equal(await credentialCount(db, user.id), 1, "confirming the address keeps the password");
    assert.equal(sessionEmail((await call("/get-session?disableCookieCache=true")).json), email);
    assert.ok(!t.mails.some((m) => m.subject === PASSWORD_DISABLED));
  } finally {
    await deleteUsersByEmail(db, [email]);
  }
});

test("a verified sign-in links the customer rows of that address", OPTS, async () => {
  const db = await getTestDb();
  const t = makeTestAuth(db);
  const pro = await createTestPro(db);
  const email = testEmail("link");
  try {
    const [row] = await db
      .insert(schema.customer)
      .values({ professionalId: pro.proId, email, name: "Client lié" })
      .returning({ id: schema.customer.id });
    const call = browser(t);
    assert.equal((await call("/email-otp/send-verification-otp", { email, type: "sign-in" })).status, 200);
    assert.equal((await call("/sign-in/email-otp", { email, otp: t.lastCode(email) })).status, 200);
    const user = await userByEmail(db, email);
    const [customer] = await db
      .select({ userId: schema.customer.userId })
      .from(schema.customer)
      .where(eq(schema.customer.id, row.id));
    assert.equal(customer.userId, user.id);
  } finally {
    await deleteUsersByEmail(db, [email]);
    await deleteTestUser(db, pro.userId);
  }
});

test("closed endpoints answer 404 over HTTP", OPTS, async () => {
  const db = await getTestDb();
  const call = browser(makeTestAuth(db));
  const email = testEmail("closed");
  assert.equal((await call("/email-otp/check-verification-otp", { email, type: "sign-in", otp: "000000" })).status, 404);
  assert.equal((await call("/email-otp/reset-password", { email, otp: "000000", password: "password123" })).status, 404);
  assert.equal((await call("/forget-password/email-otp", { email })).status, 404);
  // Core link verification: would mail address codes outside the per-address cap.
  assert.equal((await call("/send-verification-email", { email })).status, 404);
  assert.equal((await call("/verify-email?token=x")).status, 404);
  assert.equal((await call("/admin/list-users")).status, 404);
});

test("a forget-password code request mails nothing and stores no code", OPTS, async () => {
  const db = await getTestDb();
  const t = makeTestAuth(db);
  const email = testEmail("forgot");
  try {
    const call = browser(t);
    assert.equal((await call("/sign-up/email", { email, password: "password123", name: "Client" })).status, 200);
    assert.equal(t.mails.filter((m) => m.to === email).length, 1, "the sign-up code only");

    const res = await call("/email-otp/send-verification-otp", { email, type: "forget-password" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { success: true });
    assert.equal(t.mails.filter((m) => m.to === email).length, 1, "no mail for a forget-password code");
    const stored = await db
      .select({ id: schema.verification.id })
      .from(schema.verification)
      .where(eq(schema.verification.identifier, `forget-password-otp-${email}`));
    assert.equal(stored.length, 0, "the hook answers before any code is generated");
  } finally {
    await deleteUsersByEmail(db, [email]);
  }
});

/* ───────── takeover purge: real execution, scope, and what it must not touch ───────── */

test("the purge really runs: it hits the verified address only, whatever its spelling, and spares everyone else", OPTS, async () => {
  const db = await getTestDb();
  const t = makeTestAuth(db);
  const target = testEmail("purge");
  const bystander = testEmail("bystander");
  try {
    await signUp(t, target);
    const secondBrowser = browser(t);
    assert.equal((await secondBrowser("/sign-in/email", { email: target, password: PASSWORD })).status, 200);
    await signUp(t, bystander);

    const targetUser = await userByEmail(db, target);
    const bystanderUser = await userByEmail(db, bystander);
    const oldSessions = await sessionIds(db, targetUser.id);
    const bystanderSessions = await sessionIds(db, bystanderUser.id);
    assert.equal(oldSessions.length, 2, "sign-up session + password sign-in session");
    assert.equal(bystanderSessions.length, 1);
    assert.equal(await credentialCount(db, targetUser.id), 1);

    const typed = mixedCase(target);
    assert.notEqual(typed, target);
    const real = browser(t);
    const signIn = await codeSignIn(t, real, typed);
    assert.equal(signIn.status, 200);

    const after = await userByEmail(db, target);
    assert.equal(after.emailVerified, true);
    assert.equal(await credentialCount(db, targetUser.id), 0, "the password account is gone");
    const newSessions = await sessionIds(db, targetUser.id);
    assert.equal(newSessions.length, 1, "both old sessions are gone, only the one created by the code remains");
    assert.ok(!oldSessions.includes(newSessions[0]), "the survivor is the new session");
    assert.equal(sessionEmail((await real("/get-session?disableCookieCache=true")).json), target);

    const disabled = t.mails.filter((m) => m.subject === PASSWORD_DISABLED);
    assert.equal(disabled.length, 1, "exactly one « désactivé » mail");
    assert.equal(disabled[0].to, target, "sent to the lower-cased address");

    // The other unverified password user is untouched: same account, same session.
    assert.equal((await userByEmail(db, bystander)).emailVerified, false);
    assert.equal(await credentialCount(db, bystanderUser.id), 1);
    assert.deepEqual(await sessionIds(db, bystanderUser.id), bystanderSessions);
  } finally {
    await deleteUsersByEmail(db, [target, bystander]);
  }
});

test("lifting an expired timed ban at a code sign-in keeps a verified user's password and sessions", OPTS, async () => {
  const db = await getTestDb();
  const t = makeTestAuth(db);
  const email = testEmail("ban");
  try {
    await signUp(t, email);
    const other = browser(t);
    assert.equal((await other("/sign-in/email", { email, password: PASSWORD })).status, 200);
    const user = await userByEmail(db, email);
    await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, user.id));
    const before = await sessionIds(db, user.id);
    assert.equal(before.length, 2);
    // Banned for an hour, an hour ago: the admin plugin lifts it while creating the next session.
    await db
      .update(schema.user)
      .set({ banned: true, banReason: "test", banExpires: new Date(Date.now() - 3_600_000) })
      .where(eq(schema.user.id, user.id));

    assert.equal((await codeSignIn(t, browser(t), email)).status, 200);

    const after = await userByEmail(db, email);
    assert.equal(after.banned, false);
    assert.equal(after.banExpires, null);
    assert.equal(after.emailVerified, true);
    assert.equal(await credentialCount(db, user.id), 1, "the password account is kept");
    const now = await sessionIds(db, user.id);
    assert.equal(now.length, before.length + 1, "the other sessions are kept, plus the new one");
    for (const id of before) assert.ok(now.includes(id), `session ${id} must survive`);
    assert.ok(!t.mails.some((m) => m.subject === PASSWORD_DISABLED), "no « désactivé » mail");
  } finally {
    await deleteUsersByEmail(db, [email]);
  }
});

test("a code sign-in on an unverified address with no password account deletes nothing and mails nothing", OPTS, async () => {
  const db = await getTestDb();
  const t = makeTestAuth(db);
  const email = testEmail("nopass");
  try {
    await signUp(t, email);
    const user = await userByEmail(db, email);
    // Turn the account into a Google-only one: no credential, one other account, one live session.
    await db
      .delete(schema.account)
      .where(and(eq(schema.account.userId, user.id), eq(schema.account.providerId, "credential")));
    await db.insert(schema.account).values({ id: nanoid(), accountId: nanoid(), providerId: "google", userId: user.id });
    const before = await sessionIds(db, user.id);
    assert.equal(before.length, 1);

    assert.equal((await codeSignIn(t, browser(t), email)).status, 200);

    assert.equal((await userByEmail(db, email)).emailVerified, true);
    const now = await sessionIds(db, user.id);
    assert.equal(now.length, 2, "the existing session survives next to the new one");
    assert.ok(now.includes(before[0]));
    const accounts = await db.select({ p: schema.account.providerId }).from(schema.account).where(eq(schema.account.userId, user.id));
    assert.deepEqual(accounts.map((a) => a.p), ["google"], "the other account is untouched");
    assert.ok(!t.mails.some((m) => m.subject === PASSWORD_DISABLED), "no « désactivé » mail");
  } finally {
    await deleteUsersByEmail(db, [email]);
  }
});

test("a purge that fails aborts the sign-in, leaves everything in place, and the next code retries it", OPTS, async (ctx) => {
  const db = await getTestDb();
  const email = testEmail("failclosed");
  const failing = failingDb(db, "the takeover purge (`with gone as …`)", (q) => q.sql.includes("with gone as") && q.params.includes(email));
  const t = makeTestAuth(failing.db);
  const logs = captureLogs(ctx);
  try {
    await signUp(t, email);
    const user = await userByEmail(db, email);
    const before = await sessionIds(db, user.id);

    const failed = await codeSignIn(t, browser(t), email);
    failing.assertFired();
    assert.equal(failed.status, 500, "the sign-in fails instead of verifying the address");
    assert.ok(logs.some((l) => l.includes("simulated failure")), "the failure is logged, not swallowed");
    assert.equal((await userByEmail(db, email)).emailVerified, false, "the address stays unverified");
    assert.equal(await credentialCount(db, user.id), 1, "the password account is still there");
    assert.deepEqual(await sessionIds(db, user.id), before, "no session was created or deleted");
    assert.ok(!t.mails.some((m) => m.subject === PASSWORD_DISABLED), "no mail before the purge succeeded");

    // The retry: a fresh code, the statement now succeeds.
    const retry = await codeSignIn(t, browser(t), email);
    assert.equal(retry.status, 200);
    assert.equal((await userByEmail(db, email)).emailVerified, true);
    assert.equal(await credentialCount(db, user.id), 0);
    const now = await sessionIds(db, user.id);
    assert.equal(now.length, 1);
    assert.ok(!before.includes(now[0]));
    assert.equal(t.mails.filter((m) => m.subject === PASSWORD_DISABLED).length, 1);
  } finally {
    await deleteUsersByEmail(db, [email]);
  }
});

test("IDE1 a password sign-in paused past its password check while a code sign-in purges the password gets no session", OPTS, async (ctx) => {
  const db = await getTestDb();
  let armed = false;
  let reached!: () => void;
  const atGate = new Promise<void>((resolve) => (reached = resolve));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  // Pauses the attacker's /sign-in/email after it read the password account and checked the password,
  // before it inserts its session (the scrypt + ban-lookup window of the real route).
  const t = makeTestAuth(db, {
    async beforeSessionInsert(hookCtx) {
      if (!armed || hookCtx?.path !== "/sign-in/email") return;
      armed = false;
      reached();
      await gate;
    },
  });
  const logs = captureLogs(ctx);
  const email = testEmail("ide1");
  try {
    await signUp(t, email);
    const attacker = browser(t);
    armed = true;
    const pending = attacker("/sign-in/email", { email, password: PASSWORD }).then(
      (res) => res,
      (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
    );
    await atGate;

    const victim = browser(t);
    assert.equal((await codeSignIn(t, victim, email)).status, 200);
    const user = await userByEmail(db, email);
    assert.equal(user.emailVerified, true);
    assert.equal(await credentialCount(db, user.id), 0, "the purge ran");
    const victimSessions = await sessionIds(db, user.id);
    assert.equal(victimSessions.length, 1);

    release();
    const outcome = await pending;
    assert.ok(outcome instanceof Error || outcome.status !== 200, `the paused password sign-in must fail: ${JSON.stringify(outcome)}`);
    if (outcome instanceof Error) assert.ok(!outcome.message.includes(email), "no address in the error");
    assert.equal((await attacker("/get-session?disableCookieCache=true")).json, null, "the attacker holds no live session");
    assert.deepEqual(await sessionIds(db, user.id), victimSessions, "only the victim's session is left");
    assert.equal(sessionEmail((await victim("/get-session?disableCookieCache=true")).json), email);
    assert.ok(!logs.some((l) => l.includes(email)), "no address in the logs");
  } finally {
    release();
    await deleteUsersByEmail(db, [email]);
  }
});

test("IDE1 a password change paused before its new session while a code sign-in purges the password gets no session", OPTS, async (ctx) => {
  const db = await getTestDb();
  let armed = false;
  let reached!: () => void;
  const atGate = new Promise<void>((resolve) => (reached = resolve));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  // Pauses the attacker's /change-password (revokeOtherSessions) after it read the password account,
  // checked it and deleted the user's sessions, before it inserts its new session.
  const t = makeTestAuth(db, {
    async beforeSessionInsert(hookCtx) {
      if (!armed || hookCtx?.path !== "/change-password") return;
      armed = false;
      reached();
      await gate;
    },
  });
  const logs = captureLogs(ctx);
  const email = testEmail("ide1cp");
  try {
    const attacker = await signUp(t, email);
    armed = true;
    const pending = attacker("/change-password", {
      currentPassword: PASSWORD,
      newPassword: "password456",
      revokeOtherSessions: true,
    }).then(
      (res) => res,
      (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
    );
    await atGate;

    const victim = browser(t);
    assert.equal((await codeSignIn(t, victim, email)).status, 200);
    const user = await userByEmail(db, email);
    assert.equal(user.emailVerified, true);
    assert.equal(await credentialCount(db, user.id), 0, "the purge ran");
    const victimSessions = await sessionIds(db, user.id);
    assert.equal(victimSessions.length, 1);

    release();
    const outcome = await pending;
    assert.ok(outcome instanceof Error || outcome.status !== 200, `the paused password change must fail: ${JSON.stringify(outcome)}`);
    if (outcome instanceof Error) assert.ok(!outcome.message.includes(email), "no address in the error");
    assert.equal((await attacker("/get-session?disableCookieCache=true")).json, null, "the attacker holds no live session");
    assert.deepEqual(await sessionIds(db, user.id), victimSessions, "only the victim's session is left");
    assert.equal(await credentialCount(db, user.id), 0, "no password came back");
    assert.ok(!logs.some((l) => l.includes(email)), "no address in the logs");
  } finally {
    release();
    await deleteUsersByEmail(db, [email]);
  }
});

/** pids of the other backends running a statement that contains `fragment` (only those waiting on a lock if asked). */
async function backends(db: Db, fragment: string, waitingOnLock = false): Promise<number[]> {
  const res = await db.execute<{ pid: number }>(sql`
    select pid from pg_stat_activity
    where pid <> pg_backend_pid() and state = 'active' and position(${fragment} in query) > 0
      ${waitingOnLock ? sql`and wait_event_type = 'Lock'` : sql``}`);
  return res.rows.map((r) => Number(r.pid));
}

/** Probes until it answers (bounded: a missed state fails the test instead of hanging). */
async function waitFor<T>(what: string, probe: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 150; i++) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test("IDE1 a password session inserted while the purge statement runs is caught by the user-row lock pair", { ...OPTS, timeout: 280_000 }, async (ctx) => {
  const db = await getTestDb();
  let armed = false;
  let reached!: () => void;
  const atGate = new Promise<void>((resolve) => (reached = resolve));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const t = makeTestAuth(db, {
    async beforeSessionInsert(hookCtx) {
      if (!armed || hookCtx?.path !== "/sign-in/email") return;
      armed = false;
      reached();
      await gate;
    },
  });
  const logs = captureLogs(ctx);
  const email = testEmail("ide1lock");
  const tag = `ide1-blocker-${nanoid(10).replace(/[^A-Za-z0-9]/g, "x")}`;
  let blockerPid: number | undefined;
  try {
    await signUp(t, email);
    const user = await userByEmail(db, email);
    const victim = browser(t);
    assert.equal((await victim("/email-otp/send-verification-otp", { email, type: "sign-in" })).status, 200);
    const otp = t.lastCode(email);
    assert.ok(otp, "no sign-in code captured");

    // 1. The attacker's password sign-in is past its password check, before its session insert.
    const attacker = browser(t);
    armed = true;
    let attackerDone = false;
    const pending = attacker("/sign-in/email", { email, password: PASSWORD })
      .then(
        (res) => res,
        (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
      )
      .finally(() => (attackerDone = true));
    await atGate;

    // 2. A blocker holds the password account row, so the purge statement will wait inside its transaction.
    const blocker = db
      .batch([
        db.execute(sql`select id from account where user_id = ${user.id} and provider_id = 'credential' for update`),
        db.execute(sql.raw(`select pg_sleep(60) /* ${tag} */`)),
      ])
      .catch(() => undefined);
    blockerPid = await waitFor("the blocker to hold the account row", async () => (await backends(db, tag))[0]);

    // 3. The victim's code sign-in: the purge has taken its snapshot and waits on the account row.
    const signedIn = victim("/sign-in/email-otp", { email, otp });
    await waitFor("the purge to wait on the account row", async () =>
      (await backends(db, "with gone as", true)).length > 0 ? true : undefined,
    );

    // 4. The attacker inserts its session now, after the purge's snapshot, while the purge is uncommitted. Its
    //    check either waits behind the purge's user-row lock, or (without that lock) is already done.
    release();
    await waitFor("the attacker's check to wait behind the purge, or the attacker to finish", async () =>
      attackerDone || (await backends(db, `from "user" where id = $1 for share`, true)).length > 0 ? true : undefined,
    );

    // 5. The purge commits.
    await db.execute(sql`select pg_cancel_backend(${blockerPid}::int)`);
    blockerPid = undefined;
    await blocker;
    assert.equal((await signedIn).status, 200);
    assert.equal(await credentialCount(db, user.id), 0, "the purge ran");
    const outcome = await pending;
    assert.ok(outcome instanceof Error || outcome.status !== 200, `the password sign-in must fail: ${JSON.stringify(outcome)}`);
    assert.equal((await attacker("/get-session?disableCookieCache=true")).json, null, "the attacker holds no live session");
    const left = await sessionIds(db, user.id);
    assert.equal(left.length, 1, "only the victim's session is left");
    assert.equal(sessionEmail((await victim("/get-session?disableCookieCache=true")).json), email);
    assert.ok(!logs.some((l) => l.includes(email)), "no address in the logs");
  } finally {
    release();
    if (blockerPid !== undefined) await db.execute(sql`select pg_cancel_backend(${blockerPid}::int)`);
    await deleteUsersByEmail(db, [email]);
  }
});

/* ───────── mail caps ───────── */

test("password-reset mails are capped per address: counted when sent, not when rejected, same answer past the cap", OPTS, async (ctx) => {
  const db = await getTestDb();
  const t = makeTestAuth(db);
  const email = testEmail("resetcap");
  const unknown = testEmail("nobody");
  const resetMails = () => t.mails.filter((m) => m.to === email && m.subject === RESET_SUBJECT);
  const hits = () => throttleHits(db, resetThrottleKey(email));
  // A new browser (new IP) per request: only the per-address cap can bite.
  const reset = (typed: string, redirectTo: string = RESET_REDIRECT) => browser(t)("/request-password-reset", { email: typed, redirectTo });
  const logs = captureLogs(ctx);
  try {
    await signUp(t, email);
    const user = await userByEmail(db, email);
    await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, user.id));
    assert.equal(await hits(), null);

    const first = await reset(email);
    assert.equal(first.status, 200);
    assert.equal((await reset(email.toUpperCase())).status, 200, "the cap does not depend on the spelling");
    assert.equal(resetMails().length, 2);
    assert.equal(await hits(), 2);

    // Requests the endpoint rejects, or that match no account, send nothing and use none of the cap.
    assert.equal((await reset(email, "https://evil.example/reset")).status, 403, "redirectTo on another origin");
    assert.equal((await reset(` ${email} `)).status, 400, "padded address");
    const nobody = await reset(unknown);
    assert.equal(nobody.status, 200, "an unknown address gets the usual answer");
    assert.deepEqual(nobody.json, first.json);
    assert.equal(resetMails().length, 2);
    assert.equal(await hits(), 2, "rejected and unknown requests leave the counter alone");
    assert.equal(await throttleHits(db, resetThrottleKey(unknown)), null);
    assert.ok(!t.mails.some((m) => m.to === unknown));

    for (let i = 3; i <= 5; i++) assert.equal((await reset(email)).status, 200, `request ${i}`);
    assert.equal(resetMails().length, 5, "5 valid requests, 5 mails");
    const sixth = await reset(email);
    assert.equal(sixth.status, 200);
    assert.equal(resetMails().length, 5, "the 6th valid request sends nothing");
    assert.equal(await hits(), 6);
    assert.deepEqual(sixth.json, first.json, "and answers exactly like any other valid request");

    // Its own counter: reset spam does not use up the sign-in codes of the address.
    assert.equal(await throttleHits(db, otpThrottleKey(email)), null);
    const code = await browser(t)("/email-otp/send-verification-otp", { email, type: "sign-in" });
    assert.equal(code.status, 200);
    const last = t.mails[t.mails.length - 1];
    assert.equal(last.to, email);
    assert.ok(last.subject.endsWith("est votre code de connexion Skedul"), last.subject);

    // Better Auth logged the two rejected-or-empty requests, and nothing else.
    assert.equal(logs.length, 2, logs.join("\n"));
    assert.ok(logs.some((l) => l.includes("Invalid redirectURL")), "the redirect on another origin");
    assert.ok(logs.some((l) => l.includes("User not found")), "the unknown address");
  } finally {
    await deleteUsersByEmail(db, [email]);
  }
});

test("a failing reset counter sends no mail, and the request still gets the usual answer", OPTS, async (ctx) => {
  const db = await getTestDb();
  const email = testEmail("resetfail");
  const unknown = testEmail("nobody");
  const failing = failingDb(
    db,
    "the reset counter of the address",
    (q) => q.sql.includes("insert into throttle") && q.params.includes(resetThrottleKey(email)),
  );
  const t = makeTestAuth(failing.db);
  const logs = captureLogs(ctx);
  const resetMails = () => t.mails.filter((m) => m.to === email && m.subject === RESET_SUBJECT);
  const reset = (typed: string) => browser(t)("/request-password-reset", { email: typed, redirectTo: RESET_REDIRECT });
  try {
    await signUp(t, email);
    const user = await userByEmail(db, email);
    await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, user.id));

    const usual = await reset(unknown);
    assert.equal(usual.status, 200);

    // Better Auth awaits sendResetPassword inside a try/catch (runInBackgroundOrAwait): the throw is logged, not answered.
    const failed = await reset(email);
    failing.assertFired();
    assert.equal(failed.status, 200);
    assert.deepEqual(failed.json, usual.json, "the same answer as for an unknown address");
    assert.equal(resetMails().length, 0, "closed: no counter, no mail");
    assert.equal(await throttleHits(db, resetThrottleKey(email)), null);

    // Per request, not for good: the next request counts and mails.
    assert.equal((await reset(email)).status, 200);
    assert.equal(resetMails().length, 1);
    assert.equal(await throttleHits(db, resetThrottleKey(email)), 1);

    assert.equal(logs.length, 2, logs.join("\n"));
    assert.ok(logs.some((l) => l.includes("User not found")), "the unknown address");
    assert.ok(
      logs.some((l) => l.includes("Failed to run background task") && l.includes("simulated failure")),
      "the counter failure is logged by Better Auth",
    );
  } finally {
    await deleteUsersByEmail(db, [email]);
  }
});

test("IDE2 code requests the route rejects, or that mail nothing, never count against the address's cap", OPTS, async (ctx) => {
  const db = await getTestDb();
  const t = makeTestAuth(db);
  const logs = captureLogs(ctx);
  const email = testEmail("ide2");
  try {
    // One browser = one IP: 5 requests fit Better Auth's per-IP rule. Each one used to add a hit to the
    // victim's counter, so the victim's next request answered 200 and mailed nothing for the hour.
    const attacker = browser(t);
    const rejected = [
      { email, type: "change-email" },
      { email, type: "bogus" },
      { email: ` ${email}`, type: "sign-in" },
      { email: `${email.toUpperCase()} `, type: "email-verification" },
    ];
    for (const body of rejected) {
      assert.equal((await attacker("/email-otp/send-verification-otp", body)).status, 400, JSON.stringify(body));
    }
    // A confirmation code for an address without an account: the route answers 200 and mails nothing.
    const silent = await attacker("/email-otp/send-verification-otp", { email, type: "email-verification" });
    assert.equal(silent.status, 200);
    assert.equal(t.mails.length, 0);
    assert.equal(await throttleHits(db, otpThrottleKey(email)), null, "the address's counter is untouched");

    const victim = browser(t);
    assert.equal((await victim("/email-otp/send-verification-otp", { email, type: "sign-in" })).status, 200);
    assert.equal(t.mails.filter((m) => m.to === email).length, 1, "the victim gets a code");
    assert.ok(t.lastCode(email));
    assert.equal(await throttleHits(db, otpThrottleKey(email)), 1);
    assert.ok(!logs.some((l) => l.includes(email)), "no address in the logs");
  } finally {
    await deleteUsersByEmail(db, [email]);
  }
});

test("a failing sign-in code counter answers 500 and neither mails nor stores a code", OPTS, async (ctx) => {
  const db = await getTestDb();
  const email = testEmail("otpfail");
  const failing = failingDb(
    db,
    "the sign-in code counter of the address",
    (q) => q.sql.includes("insert into throttle") && q.params.includes(otpThrottleKey(email)),
  );
  const t = makeTestAuth(failing.db);
  const logs = captureLogs(ctx);
  const request = () => browser(t)("/email-otp/send-verification-otp", { email, type: "sign-in" });
  const stored = async () =>
    (await db.select({ id: schema.verification.id }).from(schema.verification).where(eq(schema.verification.identifier, `sign-in-otp-${email}`)))
      .length;

  const failed = await request();
  failing.assertFired();
  assert.equal(failed.status, 500, "hooks.before throws before the endpoint runs");
  assert.equal(t.mails.length, 0, "no code mailed");
  assert.equal(await stored(), 0, "no code stored");
  assert.equal(await throttleHits(db, otpThrottleKey(email)), null);
  assert.ok(logs.some((l) => l.includes("simulated failure")), "the failure is logged");

  // Per request, not for good: the next request counts, stores and mails a code.
  assert.equal((await request()).status, 200);
  assert.equal(t.mails.length, 1);
  assert.ok(t.lastCode(email));
  assert.equal(await stored(), 1);
  assert.equal(await throttleHits(db, otpThrottleKey(email)), 1);
});

// The exact 600 s window is pinned by the pure config test (auth-options.test.ts); these prove the rule is
// installed: max 3, and a window longer than the 2 minutes the bucket is aged by (Better Auth's defaults are 10 and 60 s).
test("a password-reset request is limited to 3 per IP over a window longer than 2 minutes", OPTS, async (ctx) => {
  const db = await getTestDb();
  const t = makeTestAuth(db);
  const ip = testIp();
  const call = browser(t, ip);
  const request = (c: BrowserCall, tag: string) =>
    c("/request-password-reset", { email: testEmail(tag), redirectTo: RESET_REDIRECT });
  const logs = captureLogs(ctx);
  for (let i = 1; i <= 3; i++) assert.equal((await request(call, `rl${i}`)).status, 200, `request ${i}`);
  assert.equal((await request(call, "rl4")).status, 429);
  assert.equal((await request(browser(t, testIp()), "other")).status, 200, "another IP has its own bucket");

  // Aged by 2 minutes (past Better Auth's default 60 s) the bucket still blocks.
  await ageRateLimit(db, ip, "/request-password-reset");
  assert.equal((await request(call, "rl5")).status, 429);

  // Only the 4 requests that reached the endpoint (unknown addresses) logged anything.
  assert.equal(logs.length, 4, logs.join("\n"));
  assert.ok(logs.every((l) => l.includes("User not found")));
});

test("a sign-up is limited to 3 per IP over a window longer than 2 minutes", OPTS, async () => {
  const db = await getTestDb();
  const t = makeTestAuth(db);
  const ip = testIp();
  const emails = [1, 2, 3, 4, 5].map((i) => testEmail(`su${i}`));
  const other = testEmail("suother");
  const attempt = (typed: string, from: string) =>
    browser(t, from)("/sign-up/email", { email: typed, password: PASSWORD, name: "Client" });
  try {
    for (const typed of emails.slice(0, 3)) assert.equal((await attempt(typed, ip)).status, 200, typed);
    assert.equal((await attempt(emails[3], ip)).status, 429);
    assert.equal((await attempt(other, testIp())).status, 200, "another IP has its own bucket");

    // Aged by 2 minutes (past Better Auth's default 10 s) the bucket still blocks.
    await ageRateLimit(db, ip, "/sign-up/email");
    assert.equal((await attempt(emails[4], ip)).status, 429);

    const rows = await db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.email, emails[3]));
    assert.equal(rows.length, 0, "a rate-limited sign-up creates no user");
  } finally {
    await deleteUsersByEmail(db, [...emails, other]);
  }
});

test("the trailing-slash spelling of the reset path is not served", OPTS, async () => {
  const db = await getTestDb();
  const t = makeTestAuth(db);
  const res = await browser(t)("/request-password-reset/", { email: testEmail("slash"), redirectTo: RESET_REDIRECT });
  assert.equal(res.status, 404);
});
