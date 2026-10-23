import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { COPY } from "@/lib/public/messages";
import { bodyOf, rawErrorLogs } from "@/test/source-guards";

import { mockCancelPath, mockCheckoutHtml, type MockCheckoutView } from "./mock-checkout";

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

const VIEW: MockCheckoutView = {
  purchaseId: "p_abc-123",
  businessName: "Studio <script>alert(1)</script> & Fils",
  productLabel: 'Altinha "débutants" · Carnet de 4 <script>alert(2)</script><img src=x onerror=alert(1)>',
  amountLabel: "85 €",
  cancelPath: "/altinha-paris/seance/o1?paiement=annule&p=p_abc-123",
};

test("mockCheckoutHtml escapes every value: no markup of the business name, the label or the amount survives", () => {
  const html = mockCheckoutHtml(VIEW);
  assert.equal(html.includes("<script"), false, "a <script> in the business name or the label stays text");
  assert.equal(html.includes("<img"), false);
  assert.ok(html.includes("Studio &lt;script&gt;alert(1)&lt;/script&gt; &amp; Fils"));
  assert.ok(
    html.includes(
      "Altinha &quot;débutants&quot; · Carnet de 4 &lt;script&gt;alert(2)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;",
    ),
  );
  assert.ok(html.includes("85 €"));
});

test("mockCheckoutHtml: the exact copy, one form posting the purchase to the mock route, a link back", () => {
  const html = mockCheckoutHtml(VIEW);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes('<html lang="fr">'));
  assert.ok(html.includes("<title>Paiement simulé</title>"));
  assert.ok(html.includes("<h1>Paiement simulé</h1>"));
  assert.equal(COPY.PAYMENTS_TEST_MOCK, "Aucun paiement réel : le paiement est simulé.");
  assert.ok(html.includes(COPY.PAYMENTS_TEST_MOCK));
  assert.ok(html.includes('<form method="post" action="/api/mock-checkout">'));
  assert.ok(html.includes('<input type="hidden" name="purchase" value="p_abc-123">'));
  assert.ok(html.includes(">Payer (simulation)</button>"));
  assert.ok(html.includes('href="/altinha-paris/seance/o1?paiement=annule&amp;p=p_abc-123"'), "the cancel path, escaped in the attribute");
  assert.ok(html.includes(">Annuler et revenir</a>"));
});

test("mockCheckoutHtml: one centred column of 28rem, the button full width below 640 px, nothing loaded from elsewhere", () => {
  const html = mockCheckoutHtml({ ...VIEW, businessName: "Altinha Paris", productLabel: "Cours collectif · Carnet de 4" });
  assert.ok(html.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'));
  assert.ok(html.includes("max-width: 28rem"));
  const phone = html.slice(html.indexOf("@media (max-width: 640px)"));
  assert.ok(phone.startsWith("@media (max-width: 640px)"), "a phone rule exists");
  assert.ok(phone.includes("button { width: 100%; }"), "the button spans the column on a phone");
  assert.equal(html.includes("<script"), false, "no script");
  assert.equal(/<link|<iframe|<object|<embed|src=|https?:\/\//.test(html), false, "no external resource");
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  // strict-origin, not no-referrer: a no-referrer document makes the browser send `Origin: null` on its own form POST,
  // which the route's same-origin check refuses (Fetch spec, append a request Origin header).
  assert.ok(html.includes('<meta name="referrer" content="strict-origin">'));
});

test("mockCheckoutHtml: no em dash and no en dash", () => {
  assert.equal(DASH.test(mockCheckoutHtml(VIEW)), false);
});

test("mockCheckoutHtml: a hostile purchase id or cancel path cannot break out of its attribute", () => {
  const html = mockCheckoutHtml({
    ...VIEW,
    purchaseId: 'x" onfocus="alert(1)',
    cancelPath: '/a" onclick="alert(1)',
  });
  assert.ok(html.includes('value="x&quot; onfocus=&quot;alert(1)"'));
  assert.ok(html.includes('href="/a&quot; onclick=&quot;alert(1)"'));
  assert.equal(html.includes('" onfocus="'), false);
  assert.equal(html.includes('" onclick="'), false);
});

test("mockCancelPath: the séance of a buy + book, else the offer of the shop, else the page", () => {
  const base = { slug: "altinha-paris", purchaseId: "p1" };
  assert.equal(
    mockCancelPath({ ...base, occurrenceId: "o1", offerId: "of1" }),
    "/altinha-paris/seance/o1?paiement=annule&p=p1",
  );
  assert.equal(
    mockCancelPath({ ...base, occurrenceId: null, offerId: "of1" }),
    "/altinha-paris/offre/of1?paiement=annule&p=p1",
  );
  assert.equal(mockCancelPath({ ...base, occurrenceId: null, offerId: null }), "/altinha-paris");
});

// The route handler imports next/server, which node:test cannot load: its wiring is pinned on the source.
const ROUTE = readFileSync("src/app/api/mock-checkout/route.ts", "utf8");

test("the mock route runs its effects with the budget none and logs no raw error (Decision 74, S49, S31)", () => {
  assert.match(ROUTE, /runEffects\(effects, "none"\)/);
  assert.doesNotMatch(ROUTE, /runEffects\([^)]*"pro"/);
  assert.deepEqual(rawErrorLogs(ROUTE), [], "no console call receives a raw error object");
});

test("the mock route: both verbs answer 404 unless the simulation is enabled, the GET writes nothing and takes no redirect parameter (S15)", () => {
  for (const verb of ["GET", "POST"] as const) {
    const body = bodyOf(ROUTE, verb);
    assert.ok(body.indexOf("mockCheckoutEnabled()") !== -1, `${verb} checks the one availability rule`);
    assert.ok(body.indexOf("mockCheckoutEnabled()") < body.indexOf("isReferenceId("), `${verb} checks it before anything else`);
  }
  assert.doesNotMatch(bodyOf(ROUTE, "GET"), /mockPay|fulfillPurchase|runEffects|after\(|formData/, "a GET never pays");
  assert.match(bodyOf(ROUTE, "GET"), /searchParams\.get\("purchase"\)/);
  assert.doesNotMatch(ROUTE, /searchParams\.get\("(redirect|next|returnTo|success|url)"\)/, "no redirect parameter (L1146-1147)");
  assert.match(ROUTE, /new URL\(path, env\.APP_URL\)/, "the way back is built from the trusted app URL");
});

test("the mock route's POST checks the origin before it reads the body and before it pays", () => {
  const body = bodyOf(ROUTE, "POST");
  const at = (needle: string) => {
    const index = body.indexOf(needle);
    assert.notEqual(index, -1, `${needle} is in the POST`);
    return index;
  };
  assert.ok(at("mockCheckoutEnabled()") < at("sameOrigin("));
  assert.ok(at("sameOrigin(") < at("formData()"));
  assert.ok(at("formData()") < at("isReferenceId("));
  assert.ok(at("isReferenceId(") < at("mockPay("));
  assert.match(body, /sameOrigin\(request\.headers\.get\("origin"\), env\.APP_URL\)/);
  assert.match(body, /status: 403/);
});

test("the mock route catches a throw from the state read and from the payment: a log through logSafeMessage, a 500, the same headers (G2b)", () => {
  assert.match(ROUTE, /import \{ logSafeMessage \} from "@\/lib\/log-safe"/);
  for (const [verb, call] of [
    ["GET", "mockCheckoutState("],
    ["POST", "mockPay("],
  ] as const) {
    const body = bodyOf(ROUTE, verb);
    const callAt = body.indexOf(call);
    assert.notEqual(callAt, -1, `${verb} calls ${call}`);
    const tryAt = body.lastIndexOf("try {", callAt);
    assert.notEqual(tryAt, -1, `${verb}: the call sits in a try`);
    assert.equal(body.slice(tryAt, callAt).includes("}"), false, `${verb}: the call is directly inside that try, not after it`);
    const catchAt = body.indexOf("} catch", callAt);
    assert.notEqual(catchAt, -1, `${verb}: the try has a catch`);
    const handler = body.slice(catchAt, body.indexOf("\n  }", catchAt));
    assert.ok(handler.includes('console.error("[mock-checkout] " + logSafeMessage(err))'), `${verb}: the log goes through logSafeMessage`);
    assert.ok(handler.includes("return serverError()"), `${verb}: the catch answers the 500`);
  }
  assert.match(ROUTE, /function serverError\(\): Response \{\s*return new Response\("Error", \{ status: 500, headers: \{ \.\.\.HEADERS \} \}\);/);
});

test("the mock route's every response refuses caching, framing and referrers (SEC-M11, S47)", () => {
  assert.match(ROUTE, /"Cache-Control": "no-store"/);
  assert.match(
    ROUTE,
    /"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"/,
    "the page loads nothing but its inline style and posts only to itself (the /api/c pattern)",
  );
  assert.match(ROUTE, /"X-Frame-Options": "DENY"/);
  assert.match(ROUTE, /"Referrer-Policy": "strict-origin"/);
  assert.doesNotMatch(ROUTE, /"Referrer-Policy": "no-referrer"/, "no-referrer would send Origin: null on the page's own POST");
  assert.match(ROUTE, /export const dynamic = "force-dynamic"/);
  assert.equal((ROUTE.match(/new Response\(/g) ?? []).length, (ROUTE.match(/\.\.\.HEADERS/g) ?? []).length, "every response spreads the same headers");
});
