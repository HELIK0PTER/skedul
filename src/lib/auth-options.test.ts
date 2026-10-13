import test from "node:test";
import assert from "node:assert/strict";

import { ADMIN_HTTP_ENDPOINTS } from "./auth-admin";
import {
  AUTH_DISABLED_PATHS,
  AUTH_RATE_LIMIT,
  CORE_DISABLED_PATHS,
  OTP_DISABLED_PATHS,
  OTP_HTTP_PATHS,
  buildAuthOptions,
  type AuthMail,
} from "./auth-options";
import type { Db } from "./db/atomic";

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
  });
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
