import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Stripe from "stripe";

import { SESSION_APP } from "./checkout";
import {
  HANDLED_EVENTS,
  paymentIntentIdOf,
  sessionOrigin,
  verifyWebhook,
  type CheckoutSessionLike,
  type StripeEventLike,
} from "./webhook-core";

const OPTS = { env: "test", mode: "test" } as const;

/** A session of our app in the test environment; `over` replaces whole properties (an explicit undefined too). */
const own = (over: Partial<CheckoutSessionLike> = {}): CheckoutSessionLike => ({
  id: "cs_test_1",
  mode: "payment",
  metadata: { purchaseId: "p1", app: SESSION_APP, env: "test" },
  ...over,
});

const EVENT: StripeEventLike = {
  id: "evt_1",
  type: "checkout.session.completed",
  livemode: false,
  data: { object: { id: "cs_test_1" } },
};

test("HANDLED_EVENTS: the four checkout events the webhook acts on", () => {
  assert.deepEqual(
    [...HANDLED_EVENTS],
    [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
    ],
  );
});

test("paymentIntentIdOf: a string id, an expanded object's id, or null (OUT:32)", () => {
  assert.equal(paymentIntentIdOf("pi_123"), "pi_123");
  assert.equal(paymentIntentIdOf({ id: "pi_456" }), "pi_456");
  assert.equal(paymentIntentIdOf(null), null);
  assert.equal(paymentIntentIdOf(undefined), null);
  assert.equal(paymentIntentIdOf(""), null);
  assert.equal(paymentIntentIdOf({ id: "" }), null);
  assert.equal(paymentIntentIdOf({ id: 5 } as unknown as { id: string }), null);
  assert.equal(paymentIntentIdOf({} as unknown as { id: string }), null);
});

test("verifyWebhook: no signature is missing_signature and the verifier is never called", () => {
  let called = 0;
  const verify = () => {
    called += 1;
    return EVENT;
  };
  assert.deepEqual(verifyWebhook("{}", null, verify), { ok: false, reason: "missing_signature" });
  assert.deepEqual(verifyWebhook("{}", "", verify), { ok: false, reason: "missing_signature" });
  assert.equal(called, 0);
});

test("verifyWebhook: a verifier that throws is bad_signature and nothing of the error is returned", () => {
  const verify = () => {
    throw new Error("No signatures found matching the expected signature for payload sk_live_secret");
  };
  const res = verifyWebhook("{}", "t=1,v1=abc", verify);
  assert.deepEqual(res, { ok: false, reason: "bad_signature" });
});

test("verifyWebhook: a verified event is returned as it is, with the payload and the header the route received", () => {
  const seen: string[] = [];
  const res = verifyWebhook('{"a": 1}', "t=1,v1=abc", (payload, signature) => {
    seen.push(payload, signature);
    return EVENT;
  });
  assert.deepEqual(res, { ok: true, event: EVENT });
  assert.deepEqual(seen, ['{"a": 1}', "t=1,v1=abc"]);
});

// The real verifier, offline (COV-I5): the raw body is the signed message, so a body parsed and re-serialised is refused.
const SECRET = "whsec_offline_test_secret";
const stripe = new Stripe("sk_test_offline");
const verifyReal = (payload: string, signature: string) =>
  stripe.webhooks.constructEvent(payload, signature, SECRET) as unknown as StripeEventLike;
// Pretty-printed on purpose: JSON.stringify(JSON.parse(PAYLOAD)) is a different byte sequence. « séance » is non-ASCII.
const PAYLOAD = JSON.stringify(
  {
    id: "evt_real_1",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: "cs_test_real", metadata: { note: "séance du lundi" } } },
  },
  null,
  2,
);

test("the real Stripe verifier accepts the exact raw body it was signed on", () => {
  const header = stripe.webhooks.generateTestHeaderString({ payload: PAYLOAD, secret: SECRET });
  const res = verifyWebhook(PAYLOAD, header, verifyReal);
  assert.ok(res.ok);
  assert.equal(res.event.id, "evt_real_1");
  assert.equal(res.event.type, "checkout.session.completed");
});

test("the real Stripe verifier refuses a re-serialised body, one changed byte, another secret and a stale timestamp", () => {
  const header = stripe.webhooks.generateTestHeaderString({ payload: PAYLOAD, secret: SECRET });
  const bad = { ok: false, reason: "bad_signature" };

  const reserialised = JSON.stringify(JSON.parse(PAYLOAD));
  assert.notEqual(reserialised, PAYLOAD, "the fixture really differs once re-serialised");
  assert.deepEqual(verifyWebhook(reserialised, header, verifyReal), bad);

  assert.deepEqual(verifyWebhook(PAYLOAD.replace("séance", "seance"), header, verifyReal), bad);
  assert.deepEqual(verifyWebhook(PAYLOAD.replace("evt_real_1", "evt_real_2"), header, verifyReal), bad);

  const otherSecret = stripe.webhooks.generateTestHeaderString({ payload: PAYLOAD, secret: "whsec_someone_else" });
  assert.deepEqual(verifyWebhook(PAYLOAD, otherSecret, verifyReal), bad);

  assert.deepEqual(verifyWebhook(PAYLOAD, "t=1,v1=deadbeef", verifyReal), bad);
  assert.deepEqual(verifyWebhook(PAYLOAD, "garbage", verifyReal), bad);

  const stale = stripe.webhooks.generateTestHeaderString({
    payload: PAYLOAD,
    secret: SECRET,
    timestamp: Math.floor(Date.now() / 1000) - 3600,
  });
  assert.deepEqual(verifyWebhook(PAYLOAD, stale, verifyReal), bad, "a replayed old signature is outside the tolerance");
});

test("sessionOrigin: our marker, our environment and the payment mode is own", () => {
  assert.equal(sessionOrigin(own(), OPTS), "own");
  assert.equal(sessionOrigin(own(), { env: "production", mode: "live" }), "other_env");
  assert.equal(
    sessionOrigin(own({ metadata: { purchaseId: "p1", app: SESSION_APP, env: "production" } }), { env: "production", mode: "live" }),
    "own",
  );
});

test("sessionOrigin: our marker with another environment is other_env (SEC-I7)", () => {
  for (const env of ["preview", "production", "development", ""]) {
    assert.equal(sessionOrigin(own({ metadata: { purchaseId: "p1", app: SESSION_APP, env } }), OPTS), "other_env", env);
  }
  assert.equal(sessionOrigin(own({ metadata: { app: SESSION_APP } }), OPTS), "other_env", "no env key at all");
});

test("sessionOrigin: anything without our marker, or not in payment mode, is foreign (SaaS billing, Payment Links)", () => {
  const foreign: [string, CheckoutSessionLike][] = [
    ["no metadata", own({ metadata: null })],
    ["undefined metadata", own({ metadata: undefined })],
    ["empty metadata", own({ metadata: {} })],
    ["purchase id only", own({ metadata: { purchaseId: "p1" } })],
    ["another app", own({ metadata: { app: "someone-else", env: "test" } })],
    ["marker in capitals", own({ metadata: { app: SESSION_APP.toUpperCase(), env: "test" } })],
    ["subscription mode", own({ mode: "subscription" })],
    ["setup mode", own({ mode: "setup" })],
    ["null mode", own({ mode: null })],
    ["missing mode", own({ mode: undefined })],
  ];
  for (const [label, session] of foreign) assert.equal(sessionOrigin(session, OPTS), "foreign", label);
});

// The route handler imports next/server, which node:test cannot load: its wiring is pinned on the source.
const ROUTE = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");

test("the webhook route runs its effects with the budget none and logs no raw error (Decision 74, LED:87, S31, S49)", () => {
  assert.match(ROUTE, /runEffects\(effects, "none"\)/, "fulfilment mails are the client's due, never cut by a pro's budget");
  assert.doesNotMatch(ROUTE, /runEffects\([^)]*"pro"/);
  assert.doesNotMatch(ROUTE, /,\s*err\s*\)/, "no console call receives the raw error object");
  assert.match(ROUTE, /logSafeMessage\(err\)/);
});

test("the webhook route checks Stripe, the secret and the signature on the raw body before any engine call", () => {
  const at = (needle: string) => {
    const index = ROUTE.indexOf(needle);
    assert.notEqual(index, -1, `${needle} is in the route`);
    return index;
  };
  assert.ok(at("env.STRIPE_ENABLED") < at("env.STRIPE_WEBHOOK_CONFIGURED"), "Stripe off is a 404 before the secret is looked at");
  assert.ok(at("env.STRIPE_WEBHOOK_CONFIGURED") < at("request.text()"), "a missing secret is a 500, never a silent 200");
  assert.ok(at("request.text()") < at("verifyWebhook("), "the signature is checked on the raw body");
  assert.ok(at("verifyWebhook(") < at("handleStripeEvent("), "nothing reaches the engine unsigned");
  assert.doesNotMatch(ROUTE, /request\.json\(/);
  assert.match(ROUTE, /"Cache-Control": "no-store"/);
  assert.match(ROUTE, /export const dynamic = "force-dynamic"/);
});

test("the webhook route answers the contract's statuses: 404 Stripe off, 500 secret missing or engine error, 400 bad signature, 200", () => {
  assert.match(ROUTE, /reply\("Not found", 404\)/);
  assert.match(ROUTE, /console\.error\("\[stripe\] webhook secret missing"\)/);
  assert.match(ROUTE, /reply\("Webhook not configured", 500\)/);
  assert.match(ROUTE, /reply\("Invalid signature", 400\)/);
  assert.match(ROUTE, /reply\("Error", 500\)/);
  assert.match(ROUTE, /reply\("ok", 200\)/);
  assert.match(ROUTE, /mode: paymentMode\(\)/);
  assert.match(ROUTE, /env: env\.APP_ENV/);
});
