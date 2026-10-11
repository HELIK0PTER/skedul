import test from "node:test";
import assert from "node:assert/strict";

import {
  browserName,
  classifyDevice,
  classifyReferrer,
  isBot,
  isReservedSegment,
  isTrackedPath,
  normalizeSource,
  proSlugFromPath,
} from "./analytics";

const UA = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  firefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidPhone:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  googlebot:
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
};

test("isTrackedPath keeps public pages and drops back-office, admin and API", () => {
  for (const p of ["/", "/demo", "/sign-in", "/aide", "/altinha-paris", "/altinha-paris/book/abc", "/dashboardx"]) {
    assert.equal(isTrackedPath(p), true, p);
  }
  for (const p of ["/dashboard", "/dashboard/planning", "/onboarding", "/admin", "/admin/users", "/api/track", "/aide/demandes", "/aide/demandes/abc", "relative"]) {
    assert.equal(isTrackedPath(p), false, p);
  }
});

test("proSlugFromPath returns the pro slug of public pro pages only", () => {
  assert.equal(proSlugFromPath("/altinha-paris"), "altinha-paris");
  assert.equal(proSlugFromPath("/altinha-paris/book/abc"), "altinha-paris");
  for (const p of ["/", "/demo", "/sign-in", "/sign-up", "/Altinha"]) {
    assert.equal(proSlugFromPath(p), null, p);
  }
});

test("isReservedSegment flags app routes, never a pro slug", () => {
  for (const s of ["aide", "admin", "api", "dashboard", "demo", "forgot-password", "link-google", "onboarding", "reset-password", "sign-in", "sign-up", "_next"]) {
    assert.equal(isReservedSegment(s), true, s);
  }
  for (const s of ["altinha-paris", "admin-2", "administration", "aides", "dashboards", ""]) {
    assert.equal(isReservedSegment(s), false, s);
  }
});

test("isBot flags crawlers and scripts, not browsers", () => {
  assert.equal(isBot(UA.googlebot), true);
  assert.equal(isBot("curl/8.5.0"), true);
  assert.equal(isBot("Mozilla/5.0 HeadlessChrome/126.0"), true);
  assert.equal(isBot(UA.chromeWindows), false);
  assert.equal(isBot(UA.iphone), false);
});

test("classifyDevice tells phones, tablets and desktops apart", () => {
  assert.equal(classifyDevice(UA.iphone), "mobile");
  assert.equal(classifyDevice(UA.androidPhone), "mobile");
  assert.equal(classifyDevice(UA.ipad), "tablet");
  assert.equal(classifyDevice(UA.androidTablet), "tablet");
  assert.equal(classifyDevice(UA.chromeWindows), "desktop");
});

test("browserName recognises the main browsers", () => {
  assert.equal(browserName(UA.edge), "Edge");
  assert.equal(browserName(UA.chromeWindows), "Chrome");
  assert.equal(browserName(UA.firefox), "Firefox");
  assert.equal(browserName(UA.iphone), "Safari");
  assert.equal(browserName(null), "Navigateur inconnu");
});

test("classifyReferrer separates none, internal and external referrers", () => {
  assert.deepEqual(classifyReferrer(undefined, "skedul.app"), { kind: "none" });
  assert.deepEqual(classifyReferrer("", "skedul.app"), { kind: "none" });
  assert.deepEqual(classifyReferrer("not a url", "skedul.app"), { kind: "none" });
  assert.deepEqual(classifyReferrer("http://localhost:3100/demo", "localhost:3100"), { kind: "internal" });
  assert.deepEqual(classifyReferrer("https://www.skedul.app/x", "skedul.app"), { kind: "internal" });
  // returning from Stripe Checkout is a payment round-trip, not a traffic source
  assert.deepEqual(
    classifyReferrer("https://checkout.stripe.com/c/pay/cs_test_x", "skedul.app"),
    { kind: "internal" },
  );
  assert.deepEqual(
    classifyReferrer("https://stripe.com/docs", "skedul.app"),
    { kind: "external", host: "stripe.com" },
  );
  assert.deepEqual(
    classifyReferrer("https://www.google.com/search?q=x", "skedul.app"),
    { kind: "external", host: "google.com" },
  );
});

test("normalizeSource trims, lowercases and caps utm_source", () => {
  assert.equal(normalizeSource(" Newsletter "), "newsletter");
  assert.equal(normalizeSource(""), null);
  assert.equal(normalizeSource(undefined), null);
  assert.equal(normalizeSource("x".repeat(100))?.length, 64);
});
