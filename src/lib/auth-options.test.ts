import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { rawErrorLogs } from "@/test/source-guards";

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
  isAcceptedOtpName,
  isAcceptedProfileImage,
  isAcceptedSignUpName,
  isOtpVerificationTransition,
  type AuthMail,
} from "./auth-options";
import type { Db } from "./db/atomic";
import { nameToSend } from "./public/sign-in-flow";
import { otpThrottleKey, resetThrottleKey } from "./throttle";
import { BOUNDS } from "./tickets-vocab";

test("isAcceptedOtpName: no name, or a plain one of at most BOUNDS.name characters; never a link, an address, a number or a non-string (P6 A9)", () => {
  for (const name of [undefined, "", "Marie", "Marie-Anne d'Arc", "J. Dupont", "Anne 1234", "x".repeat(BOUNDS.name)]) {
    assert.equal(isAcceptedOtpName(name), true, JSON.stringify(name));
  }
  for (const name of ["Marie 06 12 34 56 78", "bit.ly", "a/b", "marie@exemple.fr", "www.x", "x".repeat(BOUNDS.name + 1), "   ", null, 42, ["Marie"], { name: "Marie" }]) {
    assert.equal(isAcceptedOtpName(name), false, JSON.stringify(name));
  }
  // Whatever the form sends passes the server check.
  for (const typed of ["  Marie  ", "Léa", `${"é".repeat(BOUNDS.name)}zz`, "Marie 06 12 34 56 78", "   "]) {
    assert.equal(isAcceptedOtpName(nameToSend(typed)), true, typed);
  }
});

test("isAcceptedSignUpName: a plain name of 1 to BOUNDS.name characters, required; never a link, an address, a number or a non-string (P6 X1)", () => {
  for (const name of ["Marie", "Marie-Anne d'Arc", "J. Dupont", "Anne 1234", "  Léa  ", "x".repeat(BOUNDS.name)]) {
    assert.equal(isAcceptedSignUpName(name), true, JSON.stringify(name));
  }
  // A sign-up always names its account (the form's field is required): no name is refused, unlike a code sign-in.
  for (const name of [undefined, "", "   ", "Marie 06 12 34 56 78", "bit.ly", "a/b", "marie@exemple.fr", "www.x", "x".repeat(BOUNDS.name + 1), null, 42, ["Marie"]]) {
    assert.equal(isAcceptedSignUpName(name), false, JSON.stringify(name));
  }
});

test("isAcceptedProfileImage: Skedul never takes a profile image from a sign-up or a code sign-in, only none (P6 X1)", () => {
  for (const image of [undefined, ""]) assert.equal(isAcceptedProfileImage(image), true, JSON.stringify(image));
  for (const image of ["https://tracker.example/pixel.png", "data:image/png;base64,AAAA", "/avatar.png", " ", null, 0, {}]) {
    assert.equal(isAcceptedProfileImage(image), false, JSON.stringify(image));
  }
});

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

test("the admin and core link-verification endpoints stay closed, and so does /update-user (P6 X1)", () => {
  for (const path of ADMIN_HTTP_ENDPOINTS) assert.ok(AUTH_DISABLED_PATHS.includes(path), path);
  for (const path of ["/send-verification-email", "/verify-email"]) assert.ok(AUTH_DISABLED_PATHS.includes(path), path);
  // Skedul never calls it; open, it lets any session set its account's name and profile image (the admin's avatar).
  assert.ok(CORE_DISABLED_PATHS.includes("/update-user"));
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

/** Runs `fn` with console.info / console.warn / console.error captured, so the test output stays clean. */
async function captureConsole(fn: () => Promise<void>): Promise<{ info: unknown[][]; warn: unknown[][]; error: unknown[][] }> {
  const captured = { info: [] as unknown[][], warn: [] as unknown[][], error: [] as unknown[][] };
  const { info, warn, error } = console;
  console.info = (...args: unknown[]) => void captured.info.push(args);
  console.warn = (...args: unknown[]) => void captured.warn.push(args);
  console.error = (...args: unknown[]) => void captured.error.push(args);
  try {
    await fn();
  } finally {
    console.info = info;
    console.warn = warn;
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
  assert.equal(queries.length, 3);
  const [lock, query, verify] = queries;
  // First the user row (FOR NO KEY UPDATE), so a password sign-in's check waits for the purge to commit.
  assert.match(lock.sql, /^select id from "user" where email = \$1 for no key update$/);
  assert.deepEqual(lock.params, ["lea@example.com"]);
  assert.deepEqual(query.params, ["lea@example.com"]);
  // One statement: the credential account and the sessions go together, or not at all.
  assert.match(query.sql, /delete from account/);
  assert.match(query.sql, /delete from session/);
  assert.match(query.sql, /email_verified = false/);
  // The same transaction marks the address verified: no gap before Better Auth's own update (P6 A2).
  assert.match(verify.sql, /^update "user" set email_verified = true, updated_at = now\(\) where email = \$1 and email_verified = false$/);
  assert.deepEqual(verify.params, ["lea@example.com"]);
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
  assert.equal(queries.length, 3, "the address is still marked verified in the same transaction");
  assert.equal(sent.length, 0);
});

test("a password sign-up whose address a code sign-in verified meanwhile loses its password and its session (P6 A2)", async () => {
  const after = (db: Db) => build(db).options.databaseHooks.session.create.after;
  const session = { id: "s1", userId: "u1", token: "t", expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() };

  const gone = stubDb([{ id: "s1" }]);
  await assert.rejects(after(gone.db)(session as never, { path: "/sign-up/email" } as never), (err: Error) => {
    assert.match(err.message, /sign-up session refused/);
    return true;
  });
  assert.equal(gone.queries.length, 3);
  assert.match(gone.queries[0].sql, /^select id from "user" where id = \$1 for share$/);
  assert.match(gone.queries[1].sql, /^delete from account where user_id = \$1 and provider_id = 'credential' and exists \(select 1 from "user" where id = \$2 and email_verified\)$/);
  assert.match(gone.queries[2].sql, /delete from session where id = \$1/);
  assert.match(gone.queries[2].sql, /email_verified/);
  for (const q of gone.queries) assert.ok(q.params.every((p) => p === "u1" || p === "s1"), JSON.stringify(q.params));

  // Still unverified: the sign-up goes on (the best-effort steps then fail on this stub and are only logged).
  const kept = stubDb([]);
  await captureConsole(() => after(kept.db)(session as never, { path: "/sign-up/email" } as never));
  assert.match(kept.queries[2]?.sql ?? "", /delete from session/);
});

test("a password sign-in or password change whose password account is gone is refused; other sessions are not checked", async () => {
  const after = (db: Db) => build(db).options.databaseHooks.session.create.after;
  const session = { id: "s1", userId: "u1", token: "t", expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() };

  // The check deleted this session (no password account left): fail closed, without the address.
  for (const path of ["/sign-in/email", "/change-password"]) {
    const gone = stubDb([{ id: "s1" }]);
    await assert.rejects(after(gone.db)(session as never, { path } as never), (err: Error) => {
      assert.match(err.message, /password session refused/);
      return true;
    });
    assert.equal(gone.queries.length, 2, path);
    assert.match(gone.queries[0].sql, /^select id from "user" where id = \$1 for share$/);
    assert.deepEqual(gone.queries[0].params, ["u1"]);
    assert.match(gone.queries[1].sql, /delete from session where id = \$1/);
    assert.match(gone.queries[1].sql, /provider_id = 'credential'/);
  }

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
  // The link is not mailed: its token row goes too (P6 A3).
  assert.equal(over.queries.length, 2);
  assert.match(over.queries[1].sql, /^delete from verification where identifier = \$1$/);
  assert.deepEqual(over.queries[1].params, ["reset-password:t0k3n-secret"]);
});

test("backgroundTasks becomes Better Auth's background handler; without it Better Auth awaits each send (P6 A3)", () => {
  const handler = (task: Promise<unknown>) => void task;
  const withTasks = buildAuthOptions({ db: stubDb([]).db, baseURL: "http://localhost:3000", secret: SECRET, sendEmail: async () => {}, backgroundTasks: handler });
  assert.equal(withTasks.advanced?.backgroundTasks.handler, handler);
  assert.equal(build(stubDb([]).db).options.advanced, undefined);
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

test("a code request the route will reject is not counted", async () => {
  const { db, queries } = stubDb([{ hits: 99 }]);
  const { options } = build(db);
  for (const body of [
    { email: "lea@example.com", type: "change-email" },
    { email: "lea@example.com", type: "bogus" },
    { email: "lea@example.com" },
    { email: " lea@example.com", type: "sign-in" },
    { email: "Lea@Example.com ", type: "email-verification" },
    { email: "not-an-address", type: "sign-in" },
    { email: 42, type: "sign-in" },
    { type: "sign-in" },
  ]) {
    assert.equal(await runBefore(options, ctxOf(OTP_SEND_PATH, body)), undefined, JSON.stringify(body));
  }
  assert.equal(queries.length, 0);
});

/** The context of a code request made by a browser whose session e-mail is `sessionEmail` (null: no session cookie at all). */
function otpCtx(body: Record<string, unknown>, sessionEmail: string | null): HookCtx {
  return {
    path: OTP_SEND_PATH,
    body,
    // With a session in the context, getSessionFromCtx returns it as it is: no read happens, so this stub cannot show
    // that the hook asks for a fresh one (the DB test « a confirmation code counts a session only when it is read
    // fresh » and the guard below do). Without one it tries to read the request: the stub has no headers, getSession()
    // throws « Headers is required », and getSessionFromCtx's own catch turns that into null.
    context: sessionEmail === null ? {} : { session: { session: { id: "s1" }, user: { id: "u1", email: sessionEmail } } },
  };
}

test("a confirmation code is mailed and counted only for the address of the signed-in session (OUT:129)", async () => {
  // Its own session, however the address is spelled: the request goes on, the counter is the only query (no account lookup).
  const own = stubDb([{ hits: 1 }]);
  assert.equal(
    await runBefore(build(own.db).options, otpCtx({ email: "Lea@Example.com", type: "email-verification" }, "lea@example.com")),
    undefined,
  );
  assert.equal(own.queries.length, 1);
  assert.ok(own.queries[0].params.includes(otpThrottleKey("lea@example.com")));

  // Its own session past the hourly cap: the usual answer, no new code.
  const capped = stubDb([{ hits: 6 }]);
  assert.deepEqual(
    await runBefore(build(capped.db).options, otpCtx({ email: "lea@example.com", type: "email-verification" }, "lea@example.com")),
    { success: true },
  );
  assert.equal(capped.queries.length, 1);

  // The session of another address, and no session at all: the usual answer before anything is read or counted.
  for (const sessionEmail of ["someone@else.com", null]) {
    const stranger = stubDb([{ found: true, hits: 1 }]);
    const answer = await runBefore(
      build(stranger.db).options,
      otpCtx({ email: "lea@example.com", type: "email-verification" }, sessionEmail),
    );
    assert.deepEqual(answer, { success: true }, String(sessionEmail));
    assert.equal(stranger.queries.length, 0, `${sessionEmail}: no lookup, no counter`);
  }
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

const sessionRow = { id: "s1", userId: "u1", token: "t", expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() };

test("a session creation stamps the last sign-in and links no customer row (Decision 72, FR:SEC-5)", async () => {
  const updated: string[] = [];
  const db = {
    update: (table: unknown) => {
      updated.push(getTableName(table as never));
      return { set: () => ({ where: async () => undefined }) };
    },
    select: () => {
      throw new Error("a sign-in reads no customer row");
    },
  } as unknown as Db;
  const { options } = build(db);
  const logged = await captureConsole(() =>
    options.databaseHooks.session.create.after(sessionRow as never, { path: OTP_SIGN_IN_PATH } as never),
  );
  assert.deepEqual(updated, ["user"], "only the user row is written: no customer row is linked");
  assert.equal(logged.error.length, 0, "nothing else was attempted, so nothing failed");
});

test("the best-effort auth logs carry the step and a scrubbed message, never the raw error or an address", async () => {
  const failing = {
    update: () => {
      throw new Error("connection to lea@example.com lost");
    },
  } as unknown as Db;
  const { options } = build(failing);

  const stamp = await captureConsole(() =>
    options.databaseHooks.session.create.after(sessionRow as never, { path: OTP_SIGN_IN_PATH } as never),
  );
  assert.deepEqual(stamp.error, [["[auth] could not stamp last_login_at: connection to [email] lost"]]);

  const reset = await captureConsole(() => options.emailAndPassword.onPasswordReset({ user: { id: "u1" } } as never));
  assert.deepEqual(reset.error, [["[auth] could not mark the email verified after reset: connection to [email] lost"]]);

  const mailFails = build(stubDb([{ purged: 1 }]).db, async () => {
    throw new Error("resend refused lea@example.com");
  });
  const disabled = await captureConsole(() =>
    mailFails.options.databaseHooks.user.update.before(
      { emailVerified: true },
      { path: OTP_SIGN_IN_PATH, body: { email: "lea@example.com" } } as never,
    ),
  );
  assert.deepEqual(disabled.error, [["[auth] could not send the password-disabled e-mail: resend refused [email]"]]);
});

test("no console call of the auth options receives a raw error object (shared guard, whatever the binding)", () => {
  assert.deepEqual(rawErrorLogs(readFileSync("src/lib/auth-options.ts", "utf8")), []);
});

// P4 final review RND-1: Better Auth's default logger prints the raw adapter error (getSession logs
// « INTERNAL_SERVER_ERROR » with the failed query, whose parameters hold the session token), and an adapter debug line
// carries `{ where }` objects with the values. Our logger keeps the message and the Error arguments, each through
// logSafeMessage, and drops every other argument.
test("Better Auth's own log lines print no address, no query parameter and no token: the message and Error arguments only, each scrubbed", async () => {
  const { options } = build(stubDb([]).db);
  const adapterFailure = Object.assign(
    new Error('Failed query: select "id" from "session" where "token" = $1\nparams: tok_123'),
    { cause: new Error("fetch failed for alice@example.com") },
  );
  const logged = await captureConsole(async () => {
    options.logger.log("error", "INTERNAL_SERVER_ERROR", adapterFailure);
    options.logger.log("warn", "no user for alice@example.com", { where: [{ field: "email", value: "alice@example.com" }] }, "alice@example.com", 42);
    options.logger.log("info", "linked account for bob@example.com", new Error("state cs_test_a1B2c3 at /api/c/abc.1.def"));
  });
  assert.deepEqual(logged.error, [['[auth] INTERNAL_SERVER_ERROR Failed query: select "id" from "session" where "token" = $1']]);
  assert.deepEqual(logged.warn, [["[auth] no user for [email]"]], "the where object, the string and the number are dropped");
  assert.deepEqual(logged.info, [["[auth] linked account for [email] state [session] at /api/c/[token]"]]);
  const all = JSON.stringify(logged);
  for (const secret of ["tok_123", "params", "alice", "fetch failed", "bob@"]) assert.ok(!all.includes(secret), secret);
});

test("an Error handed over as the message itself is printed by its scrubbed message, never as « unknown error » (P6 A27)", async () => {
  const { options } = build(stubDb([]).db);
  const log = options.logger.log as (level: "error" | "warn", message: unknown, ...args: unknown[]) => void;
  const logged = await captureConsole(async () => {
    log("error", new Error("Failed query: select 1 where email = $1\nparams: alice@example.com"));
    log("error", new Error("refused for bob@example.com"), new Error("cause at /api/c/abc.1.def"));
    log("warn", { message: "plain object for carol@example.com" });
    log("warn", 42);
  });
  assert.deepEqual(logged.error, [
    ["[auth] Failed query: select 1 where email = $1"],
    ["[auth] refused for [email] cause at /api/c/[token]"],
  ]);
  assert.deepEqual(logged.warn, [["[auth] plain object for [email]"], ["[auth] unknown error"]]);
  const all = JSON.stringify(logged);
  for (const secret of ["alice", "bob@", "carol@", "params", "abc.1.def"]) assert.ok(!all.includes(secret), secret);
});

test("buildAuthOptions declares its logger and keeps Better Auth's default level (warn and error only reach it)", () => {
  const { options } = build(stubDb([]).db);
  assert.equal(typeof options.logger.log, "function");
  assert.equal("level" in options.logger, false, "no level of our own: Better Auth's default (warn) filters first");
  assert.equal("disabled" in options.logger, false, "the lines are scrubbed, not silenced");
  const source = readFileSync("src/lib/auth-options.ts", "utf8");
  const body = source.slice(source.indexOf("export function buildAuthOptions"));
  assert.match(body, /\n {4}logger: \{ log: writeAuthLog \},\r?\n/, "the returned options carry the logger");
});

test("the hooks read the session fresh, never from the 5-minute cookie cache (Identity, P6 A6)", () => {
  const source = readFileSync("src/lib/auth-options.ts", "utf8");
  // The confirmation-code hook and the /link-social refusal of an impersonated session (P6 A6) are the only readers.
  assert.equal((source.match(/getSessionFromCtx\(/g) ?? []).length, 2, "two readers of the session here");
  assert.equal((source.match(/getSessionFromCtx\(ctx, \{ disableCookieCache: true \}\)/g) ?? []).length, 2, "both read it fresh");
});
