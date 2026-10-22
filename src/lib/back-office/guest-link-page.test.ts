import assert from "node:assert/strict";
import test from "node:test";

import { GUEST_LINK_PAGE_HEADERS, guestLinkPageHtml } from "./guest-link-page";

const DASHES = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
const PAGE = guestLinkPageHtml({ businessName: "Altinha Paris", actionPath: "/api/c/abc.1.def" });

test("the page is French, titled, and carries the exact copy", () => {
  assert.match(PAGE, /^<!doctype html>\s*<html lang="fr">/i);
  assert.equal((PAGE.match(/<html\b/g) ?? []).length, 1);
  assert.match(PAGE, /<title>Ouvrir mon espace<\/title>/);
  assert.match(PAGE, /<h1>Ouvrir mon espace chez Altinha Paris<\/h1>/);
  assert.ok(PAGE.includes("Ce lien personnel donne accès à vos réservations et à vos tickets chez Altinha Paris."));
  assert.match(PAGE, /<button type="submit">Ouvrir mon espace<\/button>/);
  assert.ok(PAGE.includes("Vous n'attendiez pas ce lien ? Fermez simplement cette page."));
});

test("one POST form to the action path, no script, no inline handler, no link out", () => {
  assert.equal((PAGE.match(/<form\b/g) ?? []).length, 1);
  assert.equal((PAGE.match(/method="post"/g) ?? []).length, 1);
  assert.ok(PAGE.includes('action="/api/c/abc.1.def"'));
  assert.doesNotMatch(PAGE, /<script/i);
  assert.doesNotMatch(PAGE, /\son[a-z]+\s*=/i, "no inline event handler");
  assert.doesNotMatch(PAGE, /javascript:/i);
  assert.doesNotMatch(PAGE, /<a\b/i, "the page links nowhere: the only way forward is the button");
  assert.doesNotMatch(PAGE, /<input/i, "the token travels in the path, never in a field");
});

test("every value is escaped: the business name (twice) and the action path", () => {
  const hostile = guestLinkPageHtml({
    businessName: `<script>alert("x")</script> & O'Neil`,
    actionPath: `/api/c/a"b<c>`,
  });
  assert.doesNotMatch(hostile, /<script/i);
  assert.ok(hostile.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; O&#39;Neil"));
  assert.equal((hostile.match(/&lt;script&gt;/g) ?? []).length, 2, "the h1 and the sentence");
  assert.ok(hostile.includes('action="/api/c/a&quot;b&lt;c&gt;"'));
  assert.equal((hostile.match(/<form\b/g) ?? []).length, 1, "a hostile name cannot add a form");
  // The title is static: the business name never reaches it.
  assert.match(hostile, /<title>Ouvrir mon espace<\/title>/);
});

test("a single centred column, button full width below 640 px, not indexed, no dash", () => {
  assert.match(PAGE, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(PAGE, /<meta name="robots" content="noindex">/);
  assert.ok(PAGE.includes("@media (max-width:640px){button{width:100%}}"));
  assert.ok(PAGE.includes("max-width:28rem"));
  assert.doesNotMatch(PAGE, DASHES);
});

test("the headers: HTML, never stored, no script, no framing, no indexing, and a referrer policy that keeps Origin", () => {
  assert.deepEqual({ ...GUEST_LINK_PAGE_HEADERS }, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "strict-origin",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex",
  });
  // `no-referrer` would make the browser send `Origin: null` on the page's own POST, which the route refuses.
  assert.notEqual(GUEST_LINK_PAGE_HEADERS["Referrer-Policy"], "no-referrer");
});
