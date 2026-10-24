/**
 * Wiring guards for the public pages (P4 Tasks 25b, 26, 27). The pages import server-only modules and next/*, which
 * the node:test runner cannot load, so what they must keep is pinned on their source: the decisions themselves (who
 * the visitor is, what a page may show) have their own pure and DB tests. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bodyOf, rawErrorLogs } from "@/test/source-guards";

const source = (path: string): string => readFileSync(path, "utf8");

const HOME = source("src/app/[slug]/page.tsx");

test("/[slug] reads the visitor through currentPublicVisitor (fresh session), never the cached session, and is never cached", () => {
  assert.match(HOME, /currentPublicVisitor\(pro\.professionalId, pro\.ownerUserId\)/);
  assert.doesNotMatch(HOME, /\bgetSession\(/);
  assert.doesNotMatch(HOME, /unstable_cache|"use cache"|export const revalidate/);
});

test("/[slug]: the wallet is the Owner's, everybody else gets the bar, and no row or id reaches a client prop", () => {
  const wallet = HOME.indexOf("<WalletPanel");
  assert.notEqual(wallet, -1, "the wallet panel is rendered");
  assert.match(HOME.slice(Math.max(0, wallet - 160), wallet), /visitor\.owner && space/, "only for an Owner with a space");
  assert.match(HOME, /<VisitorBar[\s\S]*?hasGuestSpace=\{visitor\.guestCustomerId !== null\}/);
  assert.doesNotMatch(HOME, /<VisitorBar[^>]*\bemail=/, "the bar gets no address: the confirmation banner is the page's");
  assert.doesNotMatch(HOME, /\b(ownerUserId|userId|customerId|stripeAccountId|owner)=\{/, "no identity or row in a prop");
});

test("/[slug] mounts the confirmation banner once, outside the wallet / bar switch, for every signed-in visitor (WCAG 2.4.3)", () => {
  // Deviation from the brief (Task 25b report): the bar used to hold the banner for an unverified visitor only, so the
  // refresh after a code was accepted unmounted it and « Adresse confirmée. » was never announced (G1b carry, Task 22
  // pattern). One instance at a stable position keeps its state across the unverified -> verified flip, an Owner swap included.
  assert.equal((HOME.match(/<VerifyEmailBanner/g) ?? []).length, 1, "one banner");
  assert.match(
    HOME,
    /\{visitor\.email !== null && <VerifyEmailBanner email=\{visitor\.email\} verified=\{visitor\.state === "verified"\} \/>\}/,
  );
  assert.match(HOME, /^import \{ VerifyEmailBanner \} from "@\/components\/dashboard\/verify-email-banner";\r?$/m);
  const banner = HOME.indexOf("<VerifyEmailBanner");
  assert.ok(banner < HOME.indexOf("visitor.owner && space"), "above the switch the refresh may swap");
  assert.ok(banner > HOME.indexOf("<PublicShell"), "inside the shell");
});

test("/[slug] refreshes the horizon after the response, behind its per-pro key, only when a series needs it (SEC-M13)", () => {
  const need = HOME.indexOf("getHorizonNeed(");
  const afterAt = HOME.indexOf("after(async", need);
  const consumeAt = HOME.indexOf("consumeThrottle(", afterAt);
  const ensureAt = HOME.indexOf("ensureHorizon(db, pro.professionalId)", consumeAt);
  assert.ok(need !== -1 && afterAt > need && consumeAt > afterAt && ensureAt > consumeAt, "need, then after(), then the key, then the write");
  assert.match(HOME, /`t:horizon:p:\$\{pro\.professionalId\}`, \{ limit: 1, windowSec: 300 \}/);
  assert.equal(HOME.split("consumeThrottle(").length - 1, 1, "the key is consumed in one place only");
  assert.match(HOME, /logSafeMessage\(err\)/);
  assert.deepEqual(rawErrorLogs(HOME), [], "never a raw error in a console call (the shared guard of src/test/source-guards.ts)");
});

test("/[slug] shows the test-payments banner above the Boutique whenever the payment mode is not live", () => {
  assert.match(HOME, /const payment = paymentMode\(\);/);
  assert.match(HOME, /const testMode = payment === "live" \? null : payment;/);
  assert.match(HOME, /\{testMode && <TestPaymentsBanner mode=\{testMode\} \/>\}/);
});

test("/[slug] warns the owner of the page", () => {
  assert.match(HOME, /\{visitor\.isPageOwner && <OwnerPreviewBanner \/>\}/);
});

test("/[slug] holds the public projection of the pro, never the professional row (G4a)", () => {
  assert.match(HOME, /const profile = await getPublicPageProfile\(slug\);/);
  assert.match(HOME, /const \{ pro, branding, bio \} = profile;/);
  assert.match(HOME, /<PublicShell branding=\{branding\}>/, "the shell gets the nine branding fields, not the row");
  assert.match(HOME, /\{bio && <p /, "the presentation text comes from the projection");
  assert.doesNotMatch(HOME, /publicProOfRow|profile\.pro\.(?:bio|headline)|branding=\{profile\.pro\}|\.\.\.profile\.pro/, "the row mapper and the row spread are gone from the page");
  const metadata = bodyOf(HOME, "generateMetadata");
  assert.match(metadata, /title: profile\.pro\.businessName/);
  assert.match(metadata, /description: profile\.branding\.headline \?\? undefined/);
});

test("/[slug] takes one clock per request and hands it to every read and every view function (G4a)", () => {
  const body = bodyOf(HOME, "PublicProfilePage");
  const inAfter = body.slice(body.indexOf("after(async"));
  const outside = body.slice(0, body.indexOf("after(async"));
  assert.equal((outside.match(/new Date\(\)/g) ?? []).length, 1, "one request clock before the after() block");
  assert.equal((inAfter.match(/new Date\(\)/g) ?? []).length, 1, "the throttle key inside after() reads the clock of that later moment");
  assert.match(body, /const now = new Date\(\);/);
  assert.match(body, /getPlanningPage\(pro, range, now\)/);
  assert.match(body, /getHorizonNeed\(pro, now\)/);
  assert.match(body, /getNextSeanceStart\(pro, range\.end, now\)/);
  assert.match(body, /getNextSeanceStart\(pro, now, now\)/);
  assert.match(body, /toPublicSeanceVM\(s, pro\.slug, now, tz\)/);
  assert.match(body, /todayKey: todayKey\(now, tz\)/);
});
