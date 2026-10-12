import test from "node:test";
import assert from "node:assert/strict";

import { DB_SKIP, sameHost, testEmail, testIp } from "./db";

const BRANCH_A = "postgresql://neondb_owner:secret@ep-alpha-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require";

test("sameHost compares host and port, not user, password, database or params", () => {
  assert.equal(
    sameHost(BRANCH_A, "postgresql://other:pw@ep-alpha-pooler.c-2.us-west-2.aws.neon.tech/otherdb"),
    true,
  );
  assert.equal(
    sameHost(BRANCH_A, "postgresql://neondb_owner:secret@ep-beta-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require"),
    false,
  );
  assert.equal(sameHost("postgresql://u:p@localhost:5432/a", "postgresql://u:p@localhost:5433/a"), false);
});

test("sameHost throws on a malformed URL instead of answering", () => {
  assert.throws(() => sameHost("not a url", BRANCH_A));
});

test("DB_SKIP gives the reason when DATABASE_URL_TEST is unset", () => {
  if (process.env.DATABASE_URL_TEST) assert.equal(DB_SKIP, false);
  else assert.equal(DB_SKIP, "DATABASE_URL_TEST is not set (.env.test)");
});

test("testEmail is unique and lower-case", () => {
  const a = testEmail("Pro");
  assert.match(a, /^t-pro-[a-z0-9_-]{8}@skedul\.test$/);
  assert.notEqual(a, testEmail("Pro"));
});

test("testIp stays in the 198.18.0.0/15 benchmark range", () => {
  for (let i = 0; i < 200; i++) {
    const parts = testIp().split(".").map(Number);
    assert.equal(parts.length, 4);
    assert.equal(parts[0], 198);
    assert.ok(parts[1] === 18 || parts[1] === 19, String(parts[1]));
    assert.ok(parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255));
  }
});
