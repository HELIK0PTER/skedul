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

test("the offer page reads the offer of the slug's pro and says so when it is no longer sold (L1458-1459)", () => {
  const page = source("src/app/[slug]/offre/[offerId]/page.tsx");
  assert.match(page, /getOfferPage\(resolved\.pro\.professionalId, offerId\)/);
  assert.match(page, /if \(!loaded\) notFound\(\);/);
  assert.match(page, /if \(!offer\) notFound\(\);/);
  assert.match(page, /offer\.kind === "unavailable"/);
  assert.match(page, /title=\{COPY\.OFFER_GONE\}/);
  assert.match(page, /href=\{boutiqueHref\(slug\)\}/);
  assert.match(page, /COPY\.SEE_SHOP/);
  assert.doesNotMatch(page, /\bgetSession\(/, "the fresh session through currentPublicVisitor only");
  assert.doesNotMatch(page, /unstable_cache|"use cache"|export const revalidate/);
});

test("the offer page shows a ?p= reference only on paiement=annule and only a shop purchase of this very offer", () => {
  const page = source("src/app/[slug]/offre/[offerId]/page.tsx");
  assert.match(page, /one\(query\.paiement\) === "annule" \? one\(query\.p\) : undefined/);
  assert.match(page, /getPurchaseReference\(pro\.professionalId, referenceId, now\)/);
  assert.match(page, /referenceForPage\(reference, \{ kind: "offer", offerId \}, visitor\.owner\)/);
  assert.match(page, /<CheckoutReturn key=\{checkout\.purchaseId\} \{\.\.\.checkout\} \/>/);
  assert.doesNotMatch(page, /\b(reference|refView)\??\.customerId/, "a page never reads the customer of a purchase");
});

test("the offer page passes the form what a visitor may know of themselves, formats money and never indexes the reference", () => {
  const page = source("src/app/[slug]/offre/[offerId]/page.tsx");
  assert.match(page, /visitor=\{\{ state: visitor\.state, email: visitor\.state === "verified" \? visitor\.email : null, name: visitor\.name \}\}/);
  assert.match(page, /formatMoney\(offer\.priceCents, pro\.currency\)/);
  assert.match(page, /const testMode = payment === "live" \? null : payment;/);
  assert.match(page, /referrer: "no-referrer"/, "the URL may carry p");
  assert.doesNotMatch(page, /\b(customerId|ownerUserId|userId)=\{/, "no identity in a prop");
});

test("the offer page mounts one VerifyEmailBanner for every signed-in visitor, above the checkout, so it survives a code being accepted (G1b carry)", () => {
  const page = source("src/app/[slug]/offre/[offerId]/page.tsx");
  assert.equal((page.match(/<VerifyEmailBanner/g) ?? []).length, 1, "one instance");
  assert.match(page, /\{visitor\.email !== null && <VerifyEmailBanner email=\{visitor\.email\} verified=\{visitor\.state === "verified"\} \/>\}/);
  assert.ok(page.indexOf("<VerifyEmailBanner") < page.indexOf("<OfferCheckoutForm"), "above the checkout form");
});

test("the offer page takes one clock per request: loadOffer reads it once and returns it, the page uses that one (G4a)", () => {
  const text = source("src/app/[slug]/offre/[offerId]/page.tsx");
  const start = text.indexOf("const loadOffer = cache(");
  const end = text.indexOf("export async function generateMetadata");
  assert.ok(start !== -1 && end > start, "the loader sits above generateMetadata");
  const loader = text.slice(start, end);
  assert.equal((loader.match(/new Date\(\)/g) ?? []).length, 1, "the loader reads the clock once");
  assert.match(loader, /return \{ \.\.\.resolved, offer, now \};/);
  const page = bodyOf(text, "OfferPage");
  assert.doesNotMatch(page, /new Date\(\)/, "the page never reads the clock itself");
  assert.match(page, /const \{ pro, branding, offer, now \} = loaded;/);
});

test("the séance page reads a ?p= reference only on paiement=annule, only through the slug's pro and referenceForPage (Decision 71)", () => {
  const page = source("src/app/[slug]/seance/[occurrenceId]/page.tsx");
  assert.match(page, /one\(query\.paiement\) === "annule" \? one\(query\.p\) : undefined/);
  assert.match(page, /getPurchaseReference\(pro\.professionalId, referenceId, now\)/);
  assert.equal(page.split("referenceForPage(").length - 1, 2, "the reference of the URL and the Owner's own pending purchase");
  assert.match(page, /seanceViewerOf\(\{ visitor, reference: refView \}\)/);
  assert.ok(page.indexOf("referenceForPage(") < page.indexOf("seanceViewerOf("), "the viewer is derived after the reference");
  assert.doesNotMatch(page, /\bgetSession\(/, "the fresh session through currentPublicVisitor only");
  assert.doesNotMatch(page, /\b(customerId|ownerUserId|userId|bookingId|owner)=\{/, "no identity, no booking id and no row in a prop");
  assert.doesNotMatch(page, /\b(reference|returnView|refView)\??\.customerId/, "a page never reads the customer of a purchase");
});

test("a private séance is also shown to the reference whose booking is on it, through the same gate", () => {
  const page = source("src/app/[slug]/seance/[occurrenceId]/page.tsx");
  assert.match(
    page,
    /canSeePrivateSeance\(\{ isPageOwner: visitor\.isPageOwner, viewer, customerHasActiveBooking: facts\?\.booking != null \}\)/,
  );
  assert.match(page, /referrer: "no-referrer"/, "the URL may carry p");
  assert.match(page, /robots: \{ index: false \}/, "a private, archived or foreign séance is never indexed");
});

test("the séance page mounts the payment block for the reference or the Owner's pending purchase, and the holds for an Owner only", () => {
  const page = source("src/app/[slug]/seance/[occurrenceId]/page.tsx");
  assert.match(page, /<CheckoutReturn key=\{checkout\.purchaseId\} \{\.\.\.checkout\} \/>/);
  assert.match(page, /\{visitor\.owner && \(\s*<div[^>]*>\s*<PendingHolds slug=\{pro\.slug\} holds=\{holdRows\} \/>/);
  assert.match(page, /\.filter\(\(h\) => h\.purchaseId !== returnView\?\.purchaseId\)/, "the purchase shown by the block is not listed twice");
  assert.match(page, /merciHref: `\/\$\{pro\.slug\}\/merci\?p=\$\{encodeURIComponent\(returnView\.purchaseId\)\}`/);
  assert.match(page, /getLivePendingHolds\(pro\.professionalId, owner\.customerId, now\)/, "the holds of the Owner's own customer at this pro");
});

test("the séance page never lets a personal-link cookie hide the form or receive a purchase", () => {
  const page = source("src/app/[slug]/seance/[occurrenceId]/page.tsx");
  assert.match(page, /const guestBooked = customerViewer\?\.source === "guest" && facts\?\.booking != null;/);
  assert.match(page, /\{guestBooked && <Notice>\{COPY\.GUEST_BOOKING_EXISTS\}<\/Notice>\}/);
  assert.match(page, /const ownerFacts = customerViewer\?\.source === "owner" \? facts : null;/);
  assert.match(page, /if \(ownerFacts\?\.booking\) booked = \{ status: ownerFacts\.booking\.status, via: "owner" \};/, "a guest fact never becomes a booked state");
});

const HOME = source("src/app/[slug]/page.tsx");

test("the séance page never promises a seat that is gone: seatGoneOf decides, a cancelled booking leaves no block (Task 28 review)", () => {
  const page = source("src/app/[slug]/seance/[occurrenceId]/page.tsx");
  assert.match(page, /const seatGone = returnView === null \? null : seatGoneOf\(returnView, now\);/);
  assert.match(page, /if \(returnView !== null && seatGone !== "cancelled"\) \{/, "a cancelled booking leaves the Notice, not a block that says « réserver à nouveau »");
  assert.match(page, /const status = seatGone === "expired" \? "expired" : returnView\.status;/);
  assert.doesNotMatch(page, /\blapsed\b/, "one rule, in visibility.ts, not a second copy on the page");
  assert.match(page, /\{checkout === null && ended === "cancelled" && <Notice>\{COPY\.ENDED_CANCELLED\}<\/Notice>\}/);
  // Whatever the purchase status says (pending, or expired once the webhook ran), a cancelled booking is « cancelled ».
  assert.match(page, /refView\.booking\.status === "cancelled"\s*\? "cancelled"/);
});

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

/* ───────────────────────── /[slug]/seance/[occurrenceId] ───────────────────────── */

test("the séance page passes the picked fields of the offers and the test mode of the payment gateway", () => {
  const text = source("src/app/[slug]/seance/[occurrenceId]/page.tsx");
  assert.match(text, /const payment = paymentMode\(\);/);
  assert.match(text, /const testMode = payment === "live" \? null : payment;/);
  assert.match(text, /testMode=\{testMode\}/);
  const at = text.indexOf("offers={detail.offers.map(");
  assert.notEqual(at, -1);
  const picked = text.slice(at, text.indexOf("}))}", at));
  for (const key of ["offerId", "label", "priceCents", "validityText", "covers"]) assert.match(picked, new RegExp(`${key}: o\\.${key}`));
  assert.doesNotMatch(picked, /ticketType|quantity/, "the type and the quantity of an offer stay on the server");
});

const seance = (): string => source("src/app/[slug]/seance/[occurrenceId]/page.tsx");
/** The default export of the séance page, without generateMetadata above it (the shared `bodyOf`, G3b). */
const seancePage = (): string => bodyOf(seance(), "SeancePage");

test("the séance page reads the visitor fresh through currentPublicVisitor, never the cached session, and is never cached", () => {
  const text = seance();
  assert.match(seancePage(), /currentPublicVisitor\(pro\.professionalId, pro\.ownerUserId\)/);
  assert.doesNotMatch(text, /\bgetSession\(/);
  assert.doesNotMatch(text, /unstable_cache|"use cache"|export const revalidate/);
});

test("an unknown séance is a 404 and an RDV goes to the espace", () => {
  const page = seancePage();
  assert.match(page, /if \(!detail\) notFound\(\);/);
  assert.match(page, /if \(detail\.kind === "rdv"\) redirect\(`\/\$\{(?:pro\.)?slug\}\/espace`\);/);
});

test("a private séance is a 404 unless canSeePrivateSeance allows it, before the booking block", () => {
  const page = seancePage();
  const gate = page.indexOf("canSeePrivateSeance(");
  assert.notEqual(gate, -1);
  assert.match(page.slice(gate, gate + 400), /notFound\(\)/);
  assert.ok(gate < page.indexOf("<OccurrenceBooking"), "the gate comes first");
  assert.match(page, /detail\.isPrivate && !canSeePrivateSeance\(/);
});

test("the visitor facts are read for a customer viewer only (an Owner or a guest cookie), never for a typed address", () => {
  assert.match(seancePage(), /(?:kind === "customer"|customerViewer) \? (?:await )?getSeanceVisitorFacts\(/);
});

test("a guest cookie never makes a booking « booked » and never hides the form: a notice shows above it instead (Decision 63)", () => {
  const page = seancePage();
  assert.match(page, /source === "guest"/);
  assert.match(page, /source === "owner"/, "a booked state comes from the Owner's own facts");
  assert.match(page, /COPY\.GUEST_BOOKING_EXISTS/);
});

test("the séance metadata never reads the viewer: a private, archived or RDV séance carries the business name only (SEC-M10)", () => {
  const text = seance();
  const metadata = bodyOf(text, "generateMetadata");
  assert.doesNotMatch(metadata, /currentPublicVisitor|cookies\(|headers\(/);
  assert.match(metadata, /detail\.isPrivate/);
  assert.match(metadata, /detail\.archived/);
  assert.match(metadata, /referrer: "no-referrer"/);
  assert.match(metadata, /robots: \{ index: false \}/);
  assert.match(metadata, /title: `\$\{detail\.title\} · \$\{pro\.businessName\}`/);
});

test("no row, user or customer identifier reaches a client prop, and the séance start travels as an ISO string", () => {
  const page = seancePage();
  assert.doesNotMatch(page, /\b(ownerUserId|userId|customerId|bookingId|owner)=\{/, "no identity, no booking id and no row in a prop");
  assert.match(page, /seenStartsAt=\{detail\.startsAt\.toISOString\(\)\}/);
  assert.match(page, /returnTo=\{`\/\$\{(?:pro\.)?slug\}\/seance\/\$\{(?:detail\.)?occurrenceId\}`\}/);
});

test("the séance page mounts one VerifyEmailBanner for every signed-in visitor, so it survives a code being accepted (Task 25b lesson)", () => {
  const page = seancePage();
  assert.equal((page.match(/<VerifyEmailBanner/g) ?? []).length, 1, "one instance");
  assert.match(page, /\{visitor\.email !== null && <VerifyEmailBanner email=\{visitor\.email\} verified=\{visitor\.state === "verified"\} \/>\}/);
  assert.ok(page.indexOf("<VerifyEmailBanner") < page.indexOf("<OccurrenceBooking"), "above the booking card the refresh may swap");
});

test("the séance heading can take the focus a successful booking hands it (the id of SEANCE_HEADING_ID, tabIndex -1)", () => {
  assert.match(seancePage(), /<h2\s+id="seance-title"\s+tabIndex=\{-1\}/);
});

test("the séance page takes one clock per request: loadSeance reads it once and returns it, the page uses that one (G4a)", () => {
  const text = seance();
  const start = text.indexOf("const loadSeance = cache(");
  const end = text.indexOf("export async function generateMetadata");
  assert.ok(start !== -1 && end > start, "the loader sits above generateMetadata");
  const loader = text.slice(start, end);
  assert.equal((loader.match(/new Date\(\)/g) ?? []).length, 1, "the loader reads the clock once");
  assert.match(loader, /getSeancePage\(resolved\.pro, occurrenceId, now\)/);
  assert.match(loader, /return \{ \.\.\.resolved, detail, now \};/);
  const page = seancePage();
  assert.doesNotMatch(page, /new Date\(\)/, "the page never reads the clock itself");
  assert.match(page, /const \{ pro, branding, detail, now \} = loaded;/);
  assert.match(page, /getSeanceVisitorFacts\(pro\.professionalId, detail\.occurrenceId, customerViewer, now\)/);
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
