import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { stripeMode } from "@/lib/admin-metrics";
import { CHECKOUT_MINUTES } from "@/lib/tickets-vocab";

import {
  CREATE_OPTIONS,
  MOCK_SESSION_PREFIX,
  SESSION_APP,
  buybookCheckoutExpiry,
  cancelPathOf,
  checkoutUrls,
  closeOutcomeOf,
  createRequestOptions,
  isMockSession,
  mockCheckoutAllowed,
  mockCheckoutUrl,
  mockSessionId,
  paymentModeOf,
  stripeSessionParams,
  type CheckoutRequest,
  type CheckoutTarget,
} from "./checkout";

const EXPIRES = new Date("2026-10-21T10:31:00.789Z");

const BUYBOOK: CheckoutRequest = {
  kind: "buybook",
  purchaseId: "pur_abc-123",
  amountCents: 8500,
  currency: "eur",
  productName: "Carnet de 4",
  customerEmail: "beatriz@example.com",
  successUrl: "https://app.test/altinha-paris/merci?p=pur_abc-123",
  cancelUrl: "https://app.test/altinha-paris/seance/occ_1?paiement=annule&p=pur_abc-123",
  expiresAt: EXPIRES,
  env: "preview",
};

const SHOP: CheckoutRequest = {
  ...BUYBOOK,
  kind: "shop",
  productName: "Carnet de 10",
  amountCents: 19000,
  cancelUrl: "https://app.test/altinha-paris/offre/off_1?paiement=annule&p=pur_abc-123",
};

const BUYBOOK_TARGET: CheckoutTarget = { kind: "buybook", slug: "altinha-paris", purchaseId: "pur_abc-123", occurrenceId: "occ_1" };
const SHOP_TARGET: CheckoutTarget = { kind: "shop", slug: "altinha-paris", purchaseId: "pur_abc-123", offerId: "off_1" };

test("stripeSessionParams: the exact Checkout session of a buy + book (card only, app marker, whole-second expiry)", () => {
  assert.deepEqual(stripeSessionParams(BUYBOOK), {
    mode: "payment",
    customer_email: "beatriz@example.com",
    client_reference_id: "pur_abc-123",
    metadata: { purchaseId: "pur_abc-123", app: "skedul-tickets", env: "preview" },
    payment_intent_data: { metadata: { purchaseId: "pur_abc-123", app: "skedul-tickets", env: "preview" } },
    line_items: [
      { quantity: 1, price_data: { currency: "eur", unit_amount: 8500, product_data: { name: "Carnet de 4" } } },
    ],
    expires_at: Math.floor(EXPIRES.getTime() / 1000),
    success_url: "https://app.test/altinha-paris/merci?p=pur_abc-123",
    cancel_url: "https://app.test/altinha-paris/seance/occ_1?paiement=annule&p=pur_abc-123",
    locale: "fr",
    submit_type: "pay",
    payment_method_types: ["card"],
  });
});

test("stripeSessionParams: a shop session has the same shape without payment_method_types (the dashboard methods apply)", () => {
  const params = stripeSessionParams(SHOP);
  assert.equal("payment_method_types" in params, false);
  assert.equal(params.mode, "payment");
  assert.equal(params.locale, "fr");
  assert.equal(params.submit_type, "pay");
  assert.equal(params.client_reference_id, "pur_abc-123");
  assert.deepEqual(params.line_items, [
    { quantity: 1, price_data: { currency: "eur", unit_amount: 19000, product_data: { name: "Carnet de 10" } } },
  ]);
  assert.equal(params.cancel_url, "https://app.test/altinha-paris/offre/off_1?paiement=annule&p=pur_abc-123");
});

test("stripeSessionParams: the session and its payment intent carry exactly { purchaseId, app, env } (SEC-I7)", () => {
  assert.equal(SESSION_APP, "skedul-tickets");
  for (const [req, env] of [[BUYBOOK, "preview"], [{ ...SHOP, env: "production" }, "production"]] as const) {
    const params = stripeSessionParams(req);
    const marker = { purchaseId: "pur_abc-123", app: "skedul-tickets", env };
    assert.deepEqual(params.metadata, marker);
    assert.deepEqual(params.payment_intent_data?.metadata, marker);
    assert.equal(params.client_reference_id, req.purchaseId);
  }
});

test("stripeSessionParams: expires_at is whole seconds (the milliseconds are dropped, never rounded up)", () => {
  const params = stripeSessionParams(BUYBOOK);
  assert.ok(Number.isInteger(params.expires_at));
  assert.equal(params.expires_at, 1_792_578_660, "2026-10-21T10:31:00Z");
  assert.equal(stripeSessionParams({ ...BUYBOOK, expiresAt: new Date("2026-10-21T10:31:00.000Z") }).expires_at, 1_792_578_660);
  assert.equal(stripeSessionParams({ ...BUYBOOK, expiresAt: new Date("2026-10-21T10:30:59.999Z") }).expires_at, 1_792_578_659);
});

test("stripeSessionParams: the address is only the customer_email; no metadata, id or URL carries it", () => {
  const params = stripeSessionParams(BUYBOOK);
  assert.equal(params.customer_email, "beatriz@example.com");
  const rest = JSON.stringify([params.metadata, params.payment_intent_data, params.client_reference_id, params.success_url, params.cancel_url]);
  assert.equal(rest.includes("@"), false);
});

test("cancelPathOf: the séance page for a buy + book, the offer page for a shop purchase, both with ?paiement=annule&p=", () => {
  assert.equal(cancelPathOf(BUYBOOK_TARGET), "/altinha-paris/seance/occ_1?paiement=annule&p=pur_abc-123");
  assert.equal(cancelPathOf(SHOP_TARGET), "/altinha-paris/offre/off_1?paiement=annule&p=pur_abc-123");
});

test("checkoutUrls: built from the trusted app URL, trailing slashes stripped, success on /merci?p=", () => {
  const buybook = {
    successUrl: "https://app.test/altinha-paris/merci?p=pur_abc-123",
    cancelUrl: "https://app.test/altinha-paris/seance/occ_1?paiement=annule&p=pur_abc-123",
  };
  const shop = {
    successUrl: "https://app.test/altinha-paris/merci?p=pur_abc-123",
    cancelUrl: "https://app.test/altinha-paris/offre/off_1?paiement=annule&p=pur_abc-123",
  };
  for (const appUrl of ["https://app.test", "https://app.test/", "https://app.test///"]) {
    assert.deepEqual(checkoutUrls(appUrl, BUYBOOK_TARGET), buybook, appUrl);
    assert.deepEqual(checkoutUrls(appUrl, SHOP_TARGET), shop, appUrl);
  }
  assert.deepEqual(checkoutUrls("http://localhost:3102", SHOP_TARGET).successUrl, "http://localhost:3102/altinha-paris/merci?p=pur_abc-123");
});

test("S16: no URL carries a redirect or next parameter or an address, and a hostile id stays one parameter", () => {
  const hostile = "x y&redirect=https://evil.test&next=/admin@evil.test";
  const targets: CheckoutTarget[] = [
    BUYBOOK_TARGET,
    SHOP_TARGET,
    { ...BUYBOOK_TARGET, purchaseId: hostile },
    { ...SHOP_TARGET, purchaseId: hostile },
    { kind: "buybook", slug: "altinha-paris", purchaseId: "p1", occurrenceId: hostile },
    { kind: "shop", slug: "altinha-paris", purchaseId: "p1", offerId: hostile },
  ];
  for (const target of targets) {
    const { successUrl, cancelUrl } = checkoutUrls("https://app.test", target);
    for (const url of [successUrl, cancelUrl]) {
      const parsed = new URL(url);
      assert.equal(parsed.origin, "https://app.test", url);
      assert.equal(url.includes("@"), false, url);
      for (const key of parsed.searchParams.keys()) assert.ok(["p", "paiement"].includes(key), `${key} in ${url}`);
    }
    assert.equal(new URL(successUrl).searchParams.get("p"), target.purchaseId, "the id round-trips as one value");
  }
  for (const target of [BUYBOOK_TARGET, SHOP_TARGET]) {
    const { successUrl, cancelUrl } = checkoutUrls("https://app.test", target);
    for (const url of [successUrl, cancelUrl]) assert.equal(/redirect|next/i.test(url), false, url);
  }
  const mock = new URL(mockCheckoutUrl("https://app.test", hostile));
  assert.deepEqual([...mock.searchParams.keys()], ["purchase"]);
  assert.equal(mock.searchParams.get("purchase"), hostile);
});

test("mockCheckoutUrl: /api/mock-checkout with the purchase parameter only", () => {
  assert.equal(mockCheckoutUrl("https://app.test", "pur_abc-123"), "https://app.test/api/mock-checkout?purchase=pur_abc-123");
  assert.equal(mockCheckoutUrl("https://app.test/", "pur_abc-123"), "https://app.test/api/mock-checkout?purchase=pur_abc-123");
  assert.deepEqual([...new URL(mockCheckoutUrl("http://localhost:3102", "p1")).searchParams.keys()], ["purchase"]);
});

test("mock session ids: mock_<purchaseId>, recognised by the prefix only", () => {
  assert.equal(MOCK_SESSION_PREFIX, "mock_");
  assert.equal(mockSessionId("pur_abc-123"), "mock_pur_abc-123");
  assert.equal(isMockSession("mock_pur_abc-123"), true);
  assert.equal(isMockSession(mockSessionId("x")), true);
  for (const id of ["cs_test_a1b2", "cs_live_a1b2", "", "xmock_x", "Mock_x", " mock_x"]) assert.equal(isMockSession(id), false, id);
});

test("buybookCheckoutExpiry: now + 31 minutes, above Stripe's 30-minute minimum, in UTC arithmetic (DST days included)", () => {
  assert.equal(buybookCheckoutExpiry(Date.parse("2026-10-21T10:00:00.000Z")).toISOString(), "2026-10-21T10:31:00.000Z");
  assert.equal(buybookCheckoutExpiry(Date.parse("2026-10-21T10:00:00.250Z")).toISOString(), "2026-10-21T10:31:00.250Z");
  // Paris ends summer time at 01:00 UTC on 2026-10-25, Los Angeles on 2026-11-01: 31 minutes stay 31 minutes
  assert.equal(buybookCheckoutExpiry(Date.parse("2026-10-25T00:45:00.000Z")).toISOString(), "2026-10-25T01:16:00.000Z");
  assert.equal(buybookCheckoutExpiry(Date.parse("2026-11-01T08:45:00.000Z")).toISOString(), "2026-11-01T09:16:00.000Z");
  const now = Date.parse("2026-03-29T00:50:00.000Z");
  assert.equal((buybookCheckoutExpiry(now).getTime() - now) / 60_000, 31);
});

test("closeOutcomeOf: open, expired and paid are named; anything else, no_payment_required included, is processing (COV-M2)", () => {
  assert.equal(closeOutcomeOf({ status: "open", payment_status: "unpaid" }), "open");
  assert.equal(closeOutcomeOf({ status: "open", payment_status: null }), "open");
  assert.equal(closeOutcomeOf({ status: "expired", payment_status: "unpaid" }), "already_expired");
  assert.equal(closeOutcomeOf({ status: "complete", payment_status: "paid" }), "paid");
  assert.equal(closeOutcomeOf({ status: "complete", payment_status: "unpaid" }), "processing");
  assert.equal(closeOutcomeOf({ status: "complete", payment_status: "no_payment_required" }), "processing");
  assert.equal(closeOutcomeOf({ status: "complete", payment_status: null }), "processing");
  assert.equal(closeOutcomeOf({ status: null, payment_status: null }), "processing");
  assert.equal(closeOutcomeOf({ status: "something_new", payment_status: "paid" }), "processing", "an unknown status is never a release");
});

test("paymentModeOf: mock without a key or when disabled, live for sk_live_ and rk_live_, test otherwise", () => {
  assert.equal(paymentModeOf(undefined, false), "mock");
  assert.equal(paymentModeOf("sk_test_x", false), "mock", "a disabled Stripe is mock whatever the key");
  assert.equal(paymentModeOf("sk_live_x", false), "mock");
  assert.equal(paymentModeOf(undefined, true), "mock");
  assert.equal(paymentModeOf("", true), "mock");
  assert.equal(paymentModeOf("sk_test_x", true), "test");
  assert.equal(paymentModeOf("rk_test_x", true), "test");
  assert.equal(paymentModeOf("sk_live_x", true), "live");
  assert.equal(paymentModeOf("rk_live_x", true), "live");
});

test("stripeMode is the one paymentModeOf rule (COV-M8): « Encaissé » and the test banner cannot disagree", () => {
  assert.equal(stripeMode, paymentModeOf);
});

test("S15: mockCheckoutAllowed only without Stripe AND outside production by APP_ENV and by VERCEL_ENV", () => {
  assert.equal(mockCheckoutAllowed({ STRIPE_ENABLED: false, APP_ENV: "development" }), true);
  assert.equal(mockCheckoutAllowed({ STRIPE_ENABLED: false, APP_ENV: "preview", VERCEL_ENV: "preview" }), true);
  assert.equal(mockCheckoutAllowed({ STRIPE_ENABLED: false, APP_ENV: "development", VERCEL_ENV: "development" }), true);
  assert.equal(mockCheckoutAllowed({ STRIPE_ENABLED: true, APP_ENV: "development" }), false, "Stripe on");
  assert.equal(mockCheckoutAllowed({ STRIPE_ENABLED: true, APP_ENV: "preview", VERCEL_ENV: "preview" }), false);
  assert.equal(mockCheckoutAllowed({ STRIPE_ENABLED: false, APP_ENV: "production" }), false, "APP_ENV production");
  // APP_ENV defaults to development when unset: a keyless Vercel production must still refuse (SEC-I5)
  assert.equal(mockCheckoutAllowed({ STRIPE_ENABLED: false, APP_ENV: "development", VERCEL_ENV: "production" }), false);
  assert.equal(mockCheckoutAllowed({ STRIPE_ENABLED: false, APP_ENV: "production", VERCEL_ENV: "production" }), false);
});

test("createRequestOptions: the Checkout create is bounded (15 s, one retry) and idempotent per purchase", () => {
  assert.deepEqual(CREATE_OPTIONS, { timeout: 15_000, maxNetworkRetries: 1 });
  assert.deepEqual(createRequestOptions("pur_abc-123"), {
    idempotencyKey: "checkout:pur_abc-123",
    timeout: 15_000,
    maxNetworkRetries: 1,
  });
  assert.notEqual(createRequestOptions("pur_a").idempotencyKey, createRequestOptions("pur_b").idempotencyKey);
});

test("the one retry keeps expires_at above Stripe's 30-minute minimum (31 minutes minus two 15 s tries and the back-off)", () => {
  const worstCaseMs = 2 * CREATE_OPTIONS.timeout + 5_000; // two tries plus a generous back-off
  const left = CHECKOUT_MINUTES * 60_000 - worstCaseMs;
  assert.ok(left > 30 * 60_000, `${left} ms left at the retry`);
});

test("the real gateway creates the session with createRequestOptions(req.purchaseId), never the client defaults (80 s, 2 retries)", () => {
  const source = readFileSync("src/lib/stripe.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(source, /sessions\.create\(stripeSessionParams\(req\), createRequestOptions\(req\.purchaseId\)\)/);
  assert.equal(source.match(/sessions\.create\(/g)?.length, 1, "one create call, with options");
});
