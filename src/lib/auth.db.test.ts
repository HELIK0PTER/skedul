/**
 * Auth DB tests (spec § 14: T12, T13, T15) through auth.handler, like HTTP.
 * Not dbTest: these users are created by Better Auth itself; each test uses
 * unique addresses and random IPs (rate-limit and throttle rows persist) and
 * deletes its users in a finally.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
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

/** Makes the next Better Auth window of `ip` on `path` look 2 minutes older (past a 60 s window, inside the 600 s one). */
async function ageRateLimit(db: Db, ip: string, path: string): Promise<void> {
  await db.execute(sql`update rate_limit set last_request = last_request - 120000 where key = ${`${ip}|${path}`}`);
}

/** Captures what Better Auth logs through console.warn / console.error (expected here: rejected requests, a simulated failure). */
function muteLogs() {
  const { warn, error } = console;
  const lines: string[] = [];
  const grab = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  console.warn = grab;
  console.error = grab;
  return {
    lines,
    restore() {
      console.warn = warn;
      console.error = error;
    },
  };
}

/** The same db, except that the first takeover-purge statement (`with gone as …`) throws. */
function failingFirstPurge(db: Db): Db {
  const dialect = new PgDialect();
  let armed = true;
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "execute") return Reflect.get(target, prop, receiver);
      return (query: Parameters<Db["execute"]>[0]) => {
        if (armed && typeof query !== "string" && dialect.sqlToQuery(query.getSQL()).sql.includes("with gone as")) {
          armed = false;
          return Promise.reject(new Error("simulated purge failure"));
        }
        return target.execute(query);
      };
    },
  });
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

test("a purge that fails aborts the sign-in, leaves everything in place, and the next code retries it", OPTS, async () => {
  const db = await getTestDb();
  const t = makeTestAuth(failingFirstPurge(db));
  const email = testEmail("failclosed");
  const logs = muteLogs();
  try {
    await signUp(t, email);
    const user = await userByEmail(db, email);
    const before = await sessionIds(db, user.id);

    const failed = await codeSignIn(t, browser(t), email);
    assert.equal(failed.status, 500, "the sign-in fails instead of verifying the address");
    assert.ok(logs.lines.some((l) => l.includes("simulated purge failure")), "the failure is logged, not swallowed");
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
    logs.restore();
    await deleteUsersByEmail(db, [email]);
  }
});

/* ───────── mail caps ───────── */

test("password-reset mails are capped per address: counted when sent, not when rejected, same answer past the cap", OPTS, async () => {
  const db = await getTestDb();
  const t = makeTestAuth(db);
  const email = testEmail("resetcap");
  const unknown = testEmail("nobody");
  const resetMails = () => t.mails.filter((m) => m.to === email && m.subject === RESET_SUBJECT);
  const hits = () => throttleHits(db, resetThrottleKey(email));
  // A new browser (new IP) per request: only the per-address cap can bite.
  const reset = (typed: string, redirectTo: string = RESET_REDIRECT) => browser(t)("/request-password-reset", { email: typed, redirectTo });
  const logs = muteLogs(); // Better Auth logs the rejected redirect and the unknown address
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
  } finally {
    logs.restore();
    await deleteUsersByEmail(db, [email]);
  }
});

test("a password-reset request is limited to 3 per IP in 10 minutes", OPTS, async () => {
  const db = await getTestDb();
  const t = makeTestAuth(db);
  const ip = testIp();
  const call = browser(t, ip);
  const request = (c: BrowserCall, tag: string) =>
    c("/request-password-reset", { email: testEmail(tag), redirectTo: RESET_REDIRECT });
  const logs = muteLogs(); // Better Auth warns about each unknown address
  try {
    for (let i = 1; i <= 3; i++) assert.equal((await request(call, `rl${i}`)).status, 200, `request ${i}`);
    assert.equal((await request(call, "rl4")).status, 429);
    assert.equal((await request(browser(t, testIp()), "other")).status, 200, "another IP has its own bucket");

    // The window is 10 minutes: aged by 2 minutes (past Better Auth's default 60 s) the bucket still blocks.
    await ageRateLimit(db, ip, "/request-password-reset");
    assert.equal((await request(call, "rl5")).status, 429);
  } finally {
    logs.restore();
  }
});

test("a sign-up is limited to 3 per IP in 10 minutes", OPTS, async () => {
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

    // The window is 10 minutes: aged by 2 minutes (past Better Auth's default 10 s) the bucket still blocks.
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
