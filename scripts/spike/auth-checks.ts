import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { and, eq, ne } from "drizzle-orm";

import * as schema from "@/lib/db/schema";

import { db, type SpikeCheck } from "./db";

const BASE = "http://localhost:3000"; // nothing listens; http => cookies without __Secure-
const RUN = Date.now().toString(36); // unique e-mails per run: the branch keeps its users
const mail = (who: string) => `spike-${who}-${RUN}@skedul.test`;

const sent: { email: string; otp: string; type: string }[] = [];
const hookCalls: { path: string | undefined; emailVerified: boolean; newSessionId: string | null }[] = [];
const capped = new Set<string>();

const spikeAuth = betterAuth({
  appName: "Skedul spike",
  baseURL: BASE,
  secret: "spike-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  emailAndPassword: { enabled: true, autoSignIn: true, minPasswordLength: 8 },
  // With overrideDefaultEmailVerification the plugin's own sendVerificationOnSignUp
  // is inert; the sign-up code comes from core sendOnSignUp (S8a checks this).
  emailVerification: { sendOnSignUp: true },
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } }, // as in src/lib/auth.ts
  rateLimit: { enabled: false },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/email-otp/send-verification-otp") return;
      const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "").toLowerCase();
      if (capped.has(email)) return ctx.json({ success: true }); // handler (and code generation) never runs
    }),
  },
  databaseHooks: {
    user: {
      update: {
        after: async (user, ctx) => {
          const newSessionId = ctx?.context.newSession?.session.id ?? null;
          hookCalls.push({ path: ctx?.path, emailVerified: user.emailVerified, newSessionId });
          if (ctx?.path !== "/sign-in/email-otp" || !user.emailVerified) return;
          try {
            const credential = and(eq(schema.account.userId, user.id), eq(schema.account.providerId, "credential"));
            const found = await db.select({ id: schema.account.id }).from(schema.account).where(credential);
            if (found.length === 0) return;
            await db.delete(schema.account).where(credential);
            await db
              .delete(schema.session)
              .where(
                newSessionId
                  ? and(eq(schema.session.userId, user.id), ne(schema.session.id, newSessionId))
                  : eq(schema.session.userId, user.id),
              );
          } catch (err) {
            console.error("[spike] takeover purge failed", err);
          }
        },
      },
    },
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      storeOTP: "encrypted",
      resendStrategy: "reuse",
      overrideDefaultEmailVerification: true,
      sendVerificationOnSignUp: true,
      async sendVerificationOTP({ email, otp, type }) {
        sent.push({ email, otp, type });
      },
    }),
  ],
});

/** One cookie jar = one browser; calls go through auth.handler like real HTTP. */
function browser() {
  const jar = new Map<string, string>();
  return async function call(path: string, body?: unknown) {
    const method = body === undefined ? "GET" : "POST";
    const headers = new Headers({ origin: BASE, "x-forwarded-for": "203.0.113.7" });
    if (body !== undefined) headers.set("content-type", "application/json");
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await spikeAuth.handler(
      new Request(`${BASE}/api/auth${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) jar.delete(name);
      else jar.set(name, value);
    }
    const text = await res.text();
    return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown> | null) : null };
  };
}

const lastCode = (email: string, type: string) =>
  [...sent].reverse().find((s) => s.email === email && s.type === type)?.otp;

async function userRow(email: string) {
  const [u] = await db.select().from(schema.user).where(eq(schema.user.email, email));
  return u;
}

async function credentialCount(userId: string) {
  const rows = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "credential")));
  return rows.length;
}

export const s8a: SpikeCheck = {
  id: "S8a",
  title: "password sign-up sends an e-mail-verification CODE (no link)",
  async run() {
    const email = mail("a");
    const res = await browser()("/sign-up/email", { email, password: "password123", name: "Spike A" });
    assert.equal(res.status, 200);
    const codes = sent.filter((s) => s.email === email);
    assert.equal(codes.length, 1, `expected exactly one code, got ${JSON.stringify(codes.map((c) => c.type))}`);
    assert.equal(codes[0].type, "email-verification");
    return "one email-verification code sent on sign-up";
  },
};

export const s8b: SpikeCheck = {
  id: "S8b",
  title: "a logged-in user verifies by code and keeps the password",
  async run() {
    const email = mail("b");
    const call = browser();
    assert.equal((await call("/sign-up/email", { email, password: "password123", name: "Spike B" })).status, 200);
    const otp = lastCode(email, "email-verification");
    assert.ok(otp, "no verification code captured");
    assert.equal((await call("/email-otp/verify-email", { email, otp })).status, 200);
    const u = await userRow(email);
    assert.equal(u.emailVerified, true);
    assert.equal(await credentialCount(u.id), 1, "the password must survive a verify-email");
    const session = await call("/get-session?disableCookieCache=true");
    assert.equal((session.json as { user?: { email?: string } } | null)?.user?.email, email);
    const hook = hookCalls.at(-1);
    return `verified; credential kept; hook path=${hook?.path}`;
  },
};

export const s8c: SpikeCheck = {
  id: "S8c",
  title: "OTP sign-in on an unverified password account purges it (takeover fix)",
  async run() {
    const email = mail("victim");
    const attacker = browser();
    assert.equal((await attacker("/sign-up/email", { email, password: "password123", name: "Attacker" })).status, 200);
    const victim = browser();
    assert.equal((await victim("/email-otp/send-verification-otp", { email, type: "sign-in" })).status, 200);
    const otp = lastCode(email, "sign-in");
    assert.ok(otp, "no sign-in code captured");
    assert.equal((await victim("/sign-in/email-otp", { email, otp })).status, 200);

    const hook = [...hookCalls].reverse().find((h) => h.path === "/sign-in/email-otp");
    assert.ok(hook, "user.update.after did not run for /sign-in/email-otp");
    assert.ok(hook.newSessionId, "ctx.context.newSession was not set when the hook ran");

    const u = await userRow(email);
    assert.equal(u.emailVerified, true);
    assert.equal(await credentialCount(u.id), 0, "the attacker's password must be gone");

    const attackerFresh = await attacker("/get-session?disableCookieCache=true");
    assert.equal(attackerFresh.json, null, "the attacker's session must be revoked");
    const victimFresh = await victim("/get-session?disableCookieCache=true");
    assert.equal((victimFresh.json as { user?: { email?: string } } | null)?.user?.email, email);

    const attackerCached = await attacker("/get-session");
    const cachedStillLoggedIn = attackerCached.json !== null;
    return `purged; victim session kept; attacker with cookie cache: ${cachedStillLoggedIn ? "STILL logged in (cache)" : "logged out"}`;
  },
};

export const s8d: SpikeCheck = {
  id: "S8d",
  title: "resend within expiry sends the SAME code (encrypted + reuse)",
  async run() {
    const email = mail("reuse");
    const call = browser();
    await call("/email-otp/send-verification-otp", { email, type: "sign-in" });
    const first = lastCode(email, "sign-in");
    await call("/email-otp/send-verification-otp", { email, type: "sign-in" });
    const second = lastCode(email, "sign-in");
    assert.ok(first && second);
    assert.equal(second, first);
    return "second send reused the first code";
  },
};

export const s8e: SpikeCheck = {
  id: "S8e",
  title: "a before-hook cap short-circuits without invalidating the live code",
  async run() {
    const email = mail("cap");
    const call = browser();
    await call("/email-otp/send-verification-otp", { email, type: "sign-in" });
    const live = lastCode(email, "sign-in");
    assert.ok(live);
    const before = sent.length;
    capped.add(email);
    const blocked = await call("/email-otp/send-verification-otp", { email, type: "sign-in" });
    capped.delete(email);
    assert.equal(blocked.status, 200);
    assert.deepEqual(blocked.json, { success: true });
    assert.equal(sent.length, before, "no e-mail may be sent past the cap");
    assert.equal((await call("/sign-in/email-otp", { email, otp: live })).status, 200, "the live code must still work");
    return "capped send answered 200 {success:true}, nothing sent, live code still valid";
  },
};
