import assert from "node:assert/strict";
import test from "node:test";

import { sameOrigin } from "./same-origin";

const APP = "https://myskedul.com";

test("sameOrigin: the app's own origin is accepted, whatever the shape of the configured URL", () => {
  assert.equal(sameOrigin("https://myskedul.com", APP), true);
  assert.equal(sameOrigin("https://myskedul.com", "https://myskedul.com/"), true, "trailing slash");
  assert.equal(sameOrigin("https://myskedul.com", "https://myskedul.com/app/x?y=1"), true, "path and query");
  assert.equal(sameOrigin("https://myskedul.com", "https://myskedul.com:443"), true, "default port");
  assert.equal(sameOrigin("http://localhost:3102", "http://localhost:3102"), true, "the dev server");
});

test("sameOrigin: another host, a subdomain or a lookalike is refused", () => {
  assert.equal(sameOrigin("https://evil.example", APP), false);
  assert.equal(sameOrigin("https://www.myskedul.com", APP), false);
  assert.equal(sameOrigin("https://myskedul.com.evil.example", APP), false);
  assert.equal(sameOrigin("https://evilmyskedul.com", APP), false);
});

test("sameOrigin: another scheme or another port is refused", () => {
  assert.equal(sameOrigin("http://myskedul.com", APP), false);
  assert.equal(sameOrigin("https://myskedul.com:8443", APP), false);
  assert.equal(sameOrigin("http://localhost:3000", "http://localhost:3102"), false);
});

test("sameOrigin: no header, the opaque origin and anything that is not an origin are refused", () => {
  assert.equal(sameOrigin(null, APP), false);
  assert.equal(sameOrigin("null", APP), false);
  assert.equal(sameOrigin("", APP), false);
  assert.equal(sameOrigin("https://myskedul.com/", APP), false, "an Origin header never ends with a slash");
  assert.equal(sameOrigin("https://myskedul.com/path", APP), false);
  assert.equal(sameOrigin("HTTPS://MYSKEDUL.COM", APP), false, "browsers send the lower-case serialisation");
  assert.equal(sameOrigin("myskedul.com", APP), false);
});

test("sameOrigin: a malformed or opaque configured URL accepts nothing", () => {
  assert.equal(sameOrigin("https://myskedul.com", "not a url"), false);
  assert.equal(sameOrigin("https://myskedul.com", ""), false);
  assert.equal(sameOrigin("https://myskedul.com", "myskedul.com"), false);
  assert.equal(sameOrigin("null", "data:,x"), false, "an opaque app URL has the origin \"null\", which is never a match");
});
