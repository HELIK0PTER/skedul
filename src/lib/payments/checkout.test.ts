import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Stripe from "stripe";

import { stripeMode } from "@/lib/admin-metrics";
import { CHECKOUT_MINUTES } from "@/lib/tickets-vocab";
import { bodyOf, codeView } from "@/test/source-guards";

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

test("the stalled worst case of the create is 90 s (the timeout is an idle timeout, not a wall-clock cap); its retry stays inside the 31-minute margin for a Retry-After up to 45 s, a longer one fails the retry cleanly", () => {
  // stripe 22.2.2: `timeout` is a socket idle timeout (req.setTimeout), so 90 s is what a visitor waits when EACH try
  // stalls in silence; a response that keeps trickling bytes is not cut by it. If the SDK ever makes it a wall-clock
  // cap, or stops using the socket timeout, the model below has to be looked at again.
  const http = readFileSync("node_modules/stripe/cjs/net/NodeHttpClient.js", "utf8");
  assert.match(http, /req\.setTimeout\(timeout,/, "the SDK timeout is a socket idle timeout");
  // stripe 22.2.2 (node_modules/stripe/cjs/RequestSender.js): before its retry the SDK sleeps the Retry-After of the
  // answer when it is at most MAX_RETRY_AFTER_WAIT seconds (a longer one is ignored), else its own back-off.
  const sdk = readFileSync("node_modules/stripe/cjs/RequestSender.js", "utf8");
  const maxRetryAfterMs = Number(sdk.match(/const MAX_RETRY_AFTER_WAIT = (\d+);/)?.[1]) * 1000;
  assert.equal(maxRetryAfterMs, 60_000, "the SDK still waits up to 60 s for a Retry-After: re-model the margin if it changed");
  const backoffMs = new Stripe("sk_test_unit").getMaxNetworkRetryDelay() * 1000;
  assert.ok(backoffMs < maxRetryAfterMs, "the longest wait is a Retry-After, not the back-off");

  // With a stalled first try, the retry is SENT this long after the create began: the first try is cut after its idle
  // timeout, then the SDK sleeps.
  const retrySentMs = CREATE_OPTIONS.timeout + maxRetryAfterMs;
  assert.equal(retrySentMs, 75_000);
  // Plus the retry's own stalled try: the worst case a visitor waits for the whole create (not a hard cap).
  assert.equal(retrySentMs + CREATE_OPTIONS.timeout, 90_000);

  // expires_at is stamped CHECKOUT_MINUTES ahead before the call and Stripe wants 30 minutes at least when the retry
  // arrives: the margin absorbs a retry sent up to 60 s late, i.e. a Retry-After up to 45 s (a back-off retry, at
  // most timeout + back-off, always fits). A longer Retry-After is not absorbed: Stripe refuses the retry, the
  // gateway throws and createCheckoutAndAttach releases the hold with COPY.CHECKOUT_FAILED (booking-actions.db.test.ts,
  // « a gateway failure releases the seat at once »).
  const marginMs = (CHECKOUT_MINUTES - 30) * 60_000;
  assert.ok(CREATE_OPTIONS.timeout + backoffMs <= marginMs, "a retry after a network error or a 5xx always fits");
  assert.equal(marginMs - CREATE_OPTIONS.timeout, 45_000, "the longest Retry-After the margin absorbs");
});

test("the real gateway creates the session with createRequestOptions(req.purchaseId), never the client defaults (80 s, 2 retries)", () => {
  const source = readFileSync("src/lib/stripe.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(source, /sessions\.create\(stripeSessionParams\(req\), createRequestOptions\(req\.purchaseId\)\)/);
  assert.equal(source.match(/sessions\.create\(/g)?.length, 1, "one create call, with options");
});

/** The top-level arguments, trimmed, of every call `callee` (a global regex ending in its open paren) finds in `code`, a codeView (comments and string text blanked). */
function callArgsOf(code: string, callee: RegExp): string[][] {
  return [...code.matchAll(callee)].map((m) => {
    const args: string[] = [];
    let depth = 0;
    let arg = "";
    for (let i = (m.index ?? 0) + m[0].length; i < code.length; i++) {
      const c = code[i];
      if (c === ")" && depth === 0) break;
      if (c === "(" || c === "{" || c === "[") depth++;
      if (c === ")" || c === "}" || c === "]") depth--;
      if (c === "," && depth === 0) {
        args.push(arg.trim());
        arg = "";
      } else {
        arg += c;
      }
    }
    args.push(arg.trim());
    return args;
  });
}

test("every Stripe call of the real gateway passes bounded per-request options, never the client defaults (80 s, 2 retries): each method runs inside a visitor's Server Action (P4 final review PAY-1)", () => {
  const code = codeView(readFileSync("src/lib/stripe.ts", "utf8"));
  // The release bound: one 10 s try and one retry, a visitor is waiting.
  assert.match(code, /const RELEASE_OPTIONS = \{ timeout: 10_000, maxNetworkRetries: 1 \} as const;/);

  const start = code.indexOf("function stripeGateway(");
  const end = code.indexOf("const mockGateway");
  assert.ok(start !== -1 && end > start, "the gateway factory precedes the mock gateway");
  const gateway = code.slice(start, end);
  const sdkCalls = callArgsOf(gateway, /\bclient\.[\w.]+\(/g);
  const helperCalls = callArgsOf(gateway, /\bexpireCheckoutSession\(/g);
  assert.equal(sdkCalls.length, 3, "create, then the retrieve and the expire of closeForRelease");
  assert.equal(helperCalls.length, 1, "the gateway's expire");
  assert.equal(callArgsOf(gateway, /\bstripe\.[\w.]+\(/g).length, 0, "the gateway calls Stripe through its own client only");
  const bounded = ["RELEASE_OPTIONS", "createRequestOptions(req.purchaseId)"];
  for (const args of [...sdkCalls, ...helperCalls]) {
    const options = args[args.length - 1];
    assert.ok(bounded.includes(options), `a gateway call ends with ${JSON.stringify(options)}, not bounded options`);
  }

  // expireCheckoutSession hands the options it is given to both of its Stripe calls.
  const helperSdk = callArgsOf(bodyOf(code, "expireCheckoutSession"), /\bstripe\.[\w.]+\(/g);
  assert.equal(helperSdk.length, 2, "retrieve, then expire");
  for (const args of helperSdk) assert.equal(args[args.length - 1], "options");
});
