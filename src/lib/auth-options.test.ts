import test from "node:test";
import assert from "node:assert/strict";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { ADMIN_HTTP_ENDPOINTS } from "./auth-admin";
import {
  AUTH_DISABLED_PATHS,
  AUTH_RATE_LIMIT,
  CORE_DISABLED_PATHS,
  OTP_DISABLED_PATHS,
  OTP_HTTP_PATHS,
  OTP_SEND_PATH,
  OTP_SIGN_IN_PATH,
  OTP_VERIFY_EMAIL_PATH,
  RESET_REQUEST_PATH,
  buildAuthOptions,
  buildOtpMailer,
  isOtpVerificationTransition,
  type AuthMail,
} from "./auth-options";
import type { Db } from "./db/atomic";
import { otpThrottleKey, resetThrottleKey } from "./throttle";

test("every emailOTP endpoint except send, sign-in and verify-email is closed over HTTP", () => {
  for (const path of [
    "/email-otp/check-verification-otp",
    "/email-otp/request-password-reset",
    "/forget-password/email-otp",
    "/email-otp/reset-password",
    "/email-otp/request-email-change",
    "/email-otp/change-email",
  ]) {
    assert.ok(OTP_DISABLED_PATHS.includes(path), path);
  }
  for (const path of OTP_HTTP_PATHS) {
    assert.ok(!OTP_DISABLED_PATHS.includes(path), path);
    assert.ok(!AUTH_DISABLED_PATHS.includes(path), path);
  }
  // 6 in better-auth 1.6.19; an upgrade may add some, never remove them.
  assert.ok(OTP_DISABLED_PATHS.length >= 6, String(OTP_DISABLED_PATHS.length));
});

test("the admin and core link-verification endpoints stay closed", () => {
  for (const path of ADMIN_HTTP_ENDPOINTS) assert.ok(AUTH_DISABLED_PATHS.includes(path), path);
  for (const path of ["/send-verification-email", "/verify-email"]) assert.ok(AUTH_DISABLED_PATHS.includes(path), path);
  assert.equal(
    AUTH_DISABLED_PATHS.length,
    ADMIN_HTTP_ENDPOINTS.length + OTP_DISABLED_PATHS.length + CORE_DISABLED_PATHS.length,
  );
});

test("the Better Auth rate limits are the ones of spec § 12", () => {
  assert.equal(AUTH_RATE_LIMIT.enabled, true);
  assert.equal(AUTH_RATE_LIMIT.storage, "database");
  assert.equal(AUTH_RATE_LIMIT.window, 600);
  assert.equal(AUTH_RATE_LIMIT.max, 6000);
  assert.deepEqual(AUTH_RATE_LIMIT.customRules, {
    "/email-otp/send-verification-otp": { window: 600, max: 5 },
    "/sign-in/email-otp": { window: 600, max: 10 },
    "/email-otp/verify-email": { window: 600, max: 10 },
    // The two other endpoints that mail someone: Better Auth's own per-IP defaults
    // (3 per 10 s and 3 per 60 s) are too short to protect the e-mail quota.
    "/sign-up/email": { window: 600, max: 3 },
    "/request-password-reset": { window: 600, max: 3 },
  });
  // Better Auth purges its rows after the global window: no rule may outlive it.
  for (const [path, rule] of Object.entries(AUTH_RATE_LIMIT.customRules)) {
    assert.ok(rule.window <= AUTH_RATE_LIMIT.window, path);
  }
});

test("buildAuthOptions wires the plugins, the closed paths and the sign-up code", () => {
  const sent: AuthMail[] = [];
  // drizzleAdapter is lazy: a placeholder db is never touched here.
  const options = buildAuthOptions({
    db: {} as Db,
    baseURL: "http://localhost:3000",
    secret: "test-secret-0123456789abcdefghijklmnop",
    sendEmail: async (mail) => {
      sent.push(mail);
    },
  });
  assert.deepEqual(
    options.plugins.map((plugin) => plugin.id),
    ["admin", "email-otp"],
  );
  assert.equal(options.disabledPaths, AUTH_DISABLED_PATHS);
  assert.equal(options.rateLimit, AUTH_RATE_LIMIT);
  assert.equal(options.emailVerification.sendOnSignUp, true);
  assert.equal(options.session.cookieCache.maxAge, 300);
  assert.equal(options.socialProviders, undefined);
  assert.equal(sent.length, 0);
});

test("Google is configured only when credentials are given", () => {
  const options = buildAuthOptions({
    db: {} as Db,
    baseURL: "http://localhost:3000",
    secret: "test-secret-0123456789abcdefghijklmnop",
    sendEmail: async () => {},
    google: { clientId: "id", clientSecret: "secret" },
  });
  assert.equal(options.socialProviders?.google.clientId, "id");
  assert.equal(options.socialProviders?.google.accessType, "offline");
});

/* ───────────── hooks, with a stub db that records the SQL it receives ───────────── */

const SECRET = "test-secret-0123456789abcdefghijklmnop";

/**
 * Every statement answers `rows`, or throws when given an Error; every query is recorded as rendered SQL +
 * params. Like drizzle, `execute` is lazy: awaited alone it runs, inside `batch` it runs with the others
 * (one array of results; the first failure rejects the whole batch).
 */
function stubDb(answer: Array<Record<string, unknown>> | Error) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const dialect = new PgDialect();
  const run = (query: SQL) => {
    queries.push(dialect.sqlToQuery(query));
    if (answer instanceof Error) throw answer;
    return { rows: answer };
  };
  const db = {
    execute: (query: SQL) => ({
      query,
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve().then(() => run(query)).then(ok, ko),
    }),
    batch: async (items: { query: SQL }[]) => items.map((item) => run(item.query)),
  } as unknown as Db;
  return { db, queries };
}

function build(db: Db, sendEmail?: (mail: AuthMail) => Promise<unknown>, logResetLink?: boolean) {
  const sent: AuthMail[] = [];
  const options = buildAuthOptions({
    db,
    baseURL: "http://localhost:3000",
    secret: SECRET,
    sendEmail:
      sendEmail ??
      (async (mail) => {
        sent.push(mail);
      }),
    logResetLink,
  });
  return { options, sent };
}

/** Runs `fn` with console.info / console.error captured, so the test output stays clean. */
async function captureConsole(fn: () => Promise<void>): Promise<{ info: unknown[][]; error: unknown[][] }> {
  const captured = { info: [] as unknown[][], error: [] as unknown[][] };
  const { info, error } = console;
  console.info = (...args: unknown[]) => void captured.info.push(args);
  console.error = (...args: unknown[]) => void captured.error.push(args);
  try {
    await fn();
  } finally {
    console.info = info;
    console.error = error;
  }
  return captured;
}

type HookCtx = { path: string; body: Record<string, unknown>; context: object };

/** `hooks.before` is a plain function of the endpoint context when called in process. */
async function runBefore(options: ReturnType<typeof build>["options"], ctx: HookCtx): Promise<unknown> {
  return (options.hooks.before as unknown as (ctx: HookCtx) => Promise<unknown>)(ctx);
}
const ctxOf = (path: string, body: Record<string, unknown>): HookCtx => ({ path, body, context: {} });

test("the password purge reacts to the emailVerified update of the code sign-in only", () => {
  assert.equal(isOtpVerificationTransition({ emailVerified: true }, { path: OTP_SIGN_IN_PATH }), true);
  // What the admin plugin writes during the same request when a timed ban has expired.
  assert.equal(
    isOtpVerificationTransition({ banned: false, banReason: null, banExpires: null }, { path: OTP_SIGN_IN_PATH }),
    false,
  );
  assert.equal(isOtpVerificationTransition({ emailVerified: false }, { path: OTP_SIGN_IN_PATH }), false);
  assert.equal(isOtpVerificationTransition({}, { path: OTP_SIGN_IN_PATH }), false);
  // Confirming one's own address while logged in must keep the password.
  assert.equal(isOtpVerificationTransition({ emailVerified: true }, { path: OTP_VERIFY_EMAIL_PATH }), false);
  assert.equal(isOtpVerificationTransition({ emailVerified: true }, { path: "/reset-password" }), false);
  assert.equal(isOtpVerificationTransition({ emailVerified: true }, {}), false);
  assert.equal(isOtpVerificationTransition({ emailVerified: true }, null), false);
  assert.equal(isOtpVerificationTransition({ emailVerified: true }, undefined), false);
});

test("an expired-ban update during a code sign-in touches neither the database nor the mailbox", async () => {
  const { db, queries } = stubDb([{ purged: 1 }]);
  const { options, sent } = build(db);
  const before = options.databaseHooks.user.update.before;
  await before(
    { banned: false, banReason: null, banExpires: null },
    { path: OTP_SIGN_IN_PATH, body: { email: "a@b.com" } } as never,
  );
  await before({ emailVerified: true }, { path: OTP_VERIFY_EMAIL_PATH, body: { email: "a@b.com" } } as never);
  assert.equal(queries.length, 0);
  assert.equal(sent.length, 0);
});

test("the OTP verification locks the user row, purges the password and every session in one statement, then mails", async () => {
  const { db, queries } = stubDb([{ purged: 1 }]);
  const { options, sent } = build(db);
  await options.databaseHooks.user.update.before(
    { emailVerified: true },
    { path: OTP_SIGN_IN_PATH, body: { email: "Lea@Example.com", otp: "123456" } } as never,
  );
  assert.equal(queries.length, 2);
  const [lock, query] = queries;
  // First the user row (FOR NO KEY UPDATE), so a password sign-in's check waits for the purge to commit.
  assert.match(lock.sql, /^select id from "user" where email = \$1 for no key update$/);
  assert.deepEqual(lock.params, ["lea@example.com"]);
  assert.deepEqual(query.params, ["lea@example.com"]);
  // One statement: the credential account and the sessions go together, or not at all.
  assert.match(query.sql, /delete from account/);
  assert.match(query.sql, /delete from session/);
  assert.match(query.sql, /email_verified = false/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "lea@example.com");
  assert.equal(sent[0].subject, "Votre mot de passe Skedul a été désactivé");
  assert.ok(sent[0].html.includes("http://localhost:3000/forgot-password"));
});

test("no password account to purge: no mail", async () => {
  const { db, queries } = stubDb([{ purged: 0 }]);
  const { options, sent } = build(db);
  await options.databaseHooks.user.update.before(
    { emailVerified: true },
    { path: OTP_SIGN_IN_PATH, body: { email: "a@b.com" } } as never,
  );
  assert.equal(queries.length, 2);
  assert.equal(sent.length, 0);
});

test("a password sign-in whose password account is gone is refused; other sessions are not checked", async () => {
  const after = (db: Db) => build(db).options.databaseHooks.session.create.after;
  const session = { id: "s1", userId: "u1", token: "t", expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() };

  // The check deleted this session (no password account left): fail closed, without the address.
  const gone = stubDb([{ id: "s1" }]);
  await assert.rejects(after(gone.db)(session as never, { path: "/sign-in/email" } as never), (err: Error) => {
    assert.match(err.message, /password sign-in refused/);
    return true;
  });
  assert.equal(gone.queries.length, 2);
  assert.match(gone.queries[0].sql, /^select id from "user" where id = \$1 for share$/);
  assert.deepEqual(gone.queries[0].params, ["u1"]);
  assert.match(gone.queries[1].sql, /delete from session where id = \$1/);
  assert.match(gone.queries[1].sql, /provider_id = 'credential'/);

  // Still there: the sign-in goes on (the best-effort steps then fail on this stub and are only logged).
  const kept = stubDb([]);
  await captureConsole(() => after(kept.db)(session as never, { path: "/sign-in/email" } as never));
  assert.match(kept.queries[1]?.sql ?? "", /delete from session/);

  // A code sign-in or an impersonation never runs the check.
  for (const path of [OTP_SIGN_IN_PATH, "/admin/impersonate-user"]) {
    const other = stubDb([{ id: "s1" }]);
    await captureConsole(() => after(other.db)(session as never, { path } as never));
    assert.ok(!other.queries.some((q) => /delete from session/.test(q.sql)), path);
  }
});

test("a purge failure aborts the verification and mails nothing; a mail failure does not", async () => {
  const failing = stubDb(new Error("boom"));
  const a = build(failing.db);
  await assert.rejects(
    a.options.databaseHooks.user.update.before(
      { emailVerified: true },
      { path: OTP_SIGN_IN_PATH, body: { email: "a@b.com" } } as never,
    ),
    /boom/,
  );
  assert.equal(a.sent.length, 0);

  const ok = stubDb([{ purged: 1 }]);
  const b = build(ok.db, async () => {
    throw new Error("resend down");
  });
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    await b.options.databaseHooks.user.update.before(
      { emailVerified: true },
      { path: OTP_SIGN_IN_PATH, body: { email: "a@b.com" } } as never,
    );
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
});

const resetData = (email: string) => ({ user: { email, name: "Léa Martin" }, url: "http://localhost:3000/reset-password/t0k3n-secret?callbackURL=", token: "t0k3n-secret" });

test("a reset request is not counted before the endpoint has validated it", async () => {
  // hooks.before runs before validation: a bad redirectTo (403) or a padded e-mail (400) must not use up the victim's cap.
  const { db, queries } = stubDb([{ hits: 99 }]);
  const { options } = build(db);
  for (const body of [{ email: "Lea@Example.com" }, { email: " lea@example.com " }, { email: "lea@example.com", redirectTo: "https://evil.test" }, {}]) {
    assert.equal(await runBefore(options, ctxOf(RESET_REQUEST_PATH, body)), undefined);
  }
  assert.equal(queries.length, 0);
});

test("sendResetPassword counts only the mails it sends: past the cap it sends nothing and does not throw", async () => {
  const sendReset = (options: ReturnType<typeof build>["options"], email: string) =>
    options.emailAndPassword.sendResetPassword(resetData(email) as never);

  const under = stubDb([{ hits: 5 }]);
  const a = build(under.db);
  await sendReset(a.options, "Lea@Example.com");
  assert.equal(a.sent.length, 1);
  assert.equal(a.sent[0].to, "Lea@Example.com");
  assert.equal(a.sent[0].subject, "Réinitialisez votre mot de passe Skedul");
  assert.ok(a.sent[0].html.includes("reset-password/t0k3n-secret"));
  // Own counter, keyed on the account's address (however the request spelled it).
  assert.equal(under.queries.length, 1);
  assert.ok(under.queries[0].params.includes(resetThrottleKey("lea@example.com")));
  assert.ok(!under.queries[0].params.includes(otpThrottleKey("lea@example.com")));

  const over = stubDb([{ hits: 6 }]);
  const b = build(over.db);
  await sendReset(b.options, "lea@example.com");
  assert.equal(b.sent.length, 0);
  assert.equal(over.queries.length, 1);
});

test("a failing counter makes sendResetPassword throw before any mail is sent (the HTTP answer is checked in auth.db.test.ts)", async () => {
  const { db } = stubDb(new Error("db down"));
  const { options, sent } = build(db);
  await assert.rejects(options.emailAndPassword.sendResetPassword(resetData("lea@example.com") as never), /db down/);
  assert.equal(sent.length, 0);
});

test("the reset link is printed in mock mode only for a mail that is actually sent", async () => {
  const sentCase = build(stubDb([{ hits: 1 }]).db, undefined, true);
  const printed = await captureConsole(async () => {
    await sentCase.options.emailAndPassword.sendResetPassword(resetData("lea@example.com") as never);
  });
  assert.equal(printed.info.length, 1);
  assert.ok(String(printed.info[0][0]).includes("reset-password/t0k3n-secret"));

  const cappedCase = build(stubDb([{ hits: 6 }]).db, undefined, true);
  const silent = await captureConsole(async () => {
    await cappedCase.options.emailAndPassword.sendResetPassword(resetData("lea@example.com") as never);
  });
  assert.equal(silent.info.length, 0);
});

test("a code verification that carries no e-mail fails closed instead of skipping the purge", async () => {
  const { db, queries } = stubDb([{ purged: 1 }]);
  const { options, sent } = build(db);
  const before = options.databaseHooks.user.update.before;
  for (const body of [{}, { email: 42 }, { email: null }]) {
    await assert.rejects(before({ emailVerified: true }, { path: OTP_SIGN_IN_PATH, body } as never), /e-mail/);
  }
  await assert.rejects(before({ emailVerified: true }, { path: OTP_SIGN_IN_PATH } as never), /e-mail/);
  assert.equal(queries.length, 0);
  assert.equal(sent.length, 0);
});

test("sign-in code requests keep their own counter; reset by code is never mailed; other paths are untouched", async () => {
  const over = stubDb([{ hits: 6 }]);
  const answer = await runBefore(
    build(over.db).options,
    ctxOf(OTP_SEND_PATH, { email: "Lea@Example.com", type: "sign-in" }),
  );
  assert.deepEqual(answer, { success: true });
  assert.ok(over.queries[0].params.includes(otpThrottleKey("lea@example.com")));

  const under = stubDb([{ hits: 1 }]);
  assert.equal(
    await runBefore(build(under.db).options, ctxOf(OTP_SEND_PATH, { email: "lea@example.com", type: "sign-in" })),
    undefined,
  );

  const forget = stubDb([{ hits: 1 }]);
  assert.deepEqual(
    await runBefore(build(forget.db).options, ctxOf(OTP_SEND_PATH, { email: "a@b.com", type: "forget-password" })),
    { success: true },
  );
  assert.equal(forget.queries.length, 0);

  const other = stubDb([{ hits: 99 }]);
  assert.equal(await runBefore(build(other.db).options, ctxOf("/sign-in/email", { email: "a@b.com" })), undefined);
  assert.equal(other.queries.length, 0);
});

test("only sign-in and email-verification codes are mailed, with their own template", async () => {
  const sent: AuthMail[] = [];
  const mailer = buildOtpMailer(async (mail) => {
    sent.push(mail);
  });
  await mailer({ email: "a@b.com", otp: "111111", type: "forget-password" });
  await mailer({ email: "a@b.com", otp: "222222", type: "change-email" });
  assert.equal(sent.length, 0);

  await mailer({ email: "a@b.com", otp: "333333", type: "sign-in" });
  await mailer({ email: "a@b.com", otp: "444444", type: "email-verification" });
  assert.deepEqual(
    sent.map((mail) => [mail.to, mail.subject]),
    [
      ["a@b.com", "333333 est votre code de connexion Skedul"],
      ["a@b.com", "444444 est votre code de confirmation Skedul"],
    ],
  );
});
