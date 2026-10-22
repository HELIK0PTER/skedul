import assert from "node:assert/strict";
import test from "node:test";

import { envBootErrors } from "./env-checks";

const SECRET_32 = "0123456789abcdef0123456789ABCDEF";
const APP_ENV_ERROR = "APP_ENV must be production on a Vercel production deployment";
const SECRET_ERROR = "BETTER_AUTH_SECRET must be at least 32 characters in production";

test("envBootErrors: a Vercel production deployment must run with APP_ENV production (SEC-I5)", () => {
  assert.deepEqual(
    envBootErrors({ VERCEL_ENV: "production", APP_ENV: "development", BETTER_AUTH_SECRET: SECRET_32 }),
    [APP_ENV_ERROR],
  );
  assert.deepEqual(
    envBootErrors({ VERCEL_ENV: "production", APP_ENV: "preview", BETTER_AUTH_SECRET: SECRET_32 }),
    [APP_ENV_ERROR],
  );
  assert.deepEqual(
    envBootErrors({ VERCEL_ENV: "production", APP_ENV: "production", BETTER_AUTH_SECRET: SECRET_32 }),
    [],
  );
});

test("envBootErrors: production needs a session secret of 32 characters at least (SEC-M5)", () => {
  assert.deepEqual(envBootErrors({ APP_ENV: "production", BETTER_AUTH_SECRET: SECRET_32.slice(0, 31) }), [SECRET_ERROR]);
  assert.deepEqual(envBootErrors({ APP_ENV: "production", BETTER_AUTH_SECRET: SECRET_32 }), []);
  assert.deepEqual(envBootErrors({ APP_ENV: "production", BETTER_AUTH_SECRET: "x".repeat(64) }), []);
  assert.deepEqual(envBootErrors({ VERCEL_ENV: "preview", APP_ENV: "production", BETTER_AUTH_SECRET: "short" }), [SECRET_ERROR]);
  assert.deepEqual(envBootErrors({ VERCEL_ENV: "production", APP_ENV: "production", BETTER_AUTH_SECRET: "" }), [SECRET_ERROR]);
});

test("envBootErrors: development and preview, with or without VERCEL_ENV, refuse nothing", () => {
  assert.deepEqual(envBootErrors({ APP_ENV: "development", BETTER_AUTH_SECRET: "x" }), [], "a local build has no VERCEL_ENV");
  assert.deepEqual(envBootErrors({ VERCEL_ENV: "development", APP_ENV: "development", BETTER_AUTH_SECRET: "x" }), []);
  assert.deepEqual(envBootErrors({ VERCEL_ENV: "preview", APP_ENV: "preview", BETTER_AUTH_SECRET: "x" }), []);
  assert.deepEqual(envBootErrors({ VERCEL_ENV: "preview", APP_ENV: "development", BETTER_AUTH_SECRET: "x" }), []);
});
