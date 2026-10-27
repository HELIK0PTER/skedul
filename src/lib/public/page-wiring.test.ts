/**
 * Wiring guards for the public pages (P4 Tasks 25b, 26, 27). The pages import server-only modules and next/*, which
 * the node:test runner cannot load, so what they must keep is pinned on their source: the decisions themselves (who
 * the visitor is, what a page may show) have their own pure and DB tests. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bodyOf, codeView, openingTags, rawErrorLogs } from "@/test/source-guards";

const source = (path: string): string => readFileSync(path, "utf8");

/** The matches of `re` (global) in `text` that start in code: one in a comment or inside a string literal is not counted (G4b). */
function inCode(text: string, re: RegExp): string[] {
  const code = codeView(text);
  return [...text.matchAll(re)].filter((m) => code[m.index ?? 0] !== " ").map((m) => m[0]);
}

test("inCode counts code only: a comment or a string that spells the rule is not the rule (G4b)", () => {
  const text = 'const a = x.source === "owner";\n// x.source === "owner"\nconst s = "source === owner";';
  assert.deepEqual(inCode(text, /source === "owner"/g), ['source === "owner"']);
  assert.deepEqual(inCode(text, /source === owner/g), [], "inside a string literal");
});

test("the merci page shows the purchase its ?p= names at this pro, even for a suspended pro, and nothing about its customer", () => {
  const page = source("src/app/[slug]/merci/page.tsx");
  assert.equal(page.split('resolvePublicPro(slug, { includeSuspended: true })').length - 1, 2, "the title and the page");
  assert.match(page, /getPurchaseReference\(pro\.professionalId, p, now\)/);
  assert.match(page, /if \(reference === null\) notFound\(\);/);
  assert.match(page, /merciStateOf\(reference, pro\.timezone\)/);
  assert.doesNotMatch(page, /currentPublicVisitor|\bgetSession\(|cookies\(/, "no identity is read: the reference is the capability");
  assert.doesNotMatch(page, /\bcustomerId\b|reference\.customerId/, "a page never reads the customer of a purchase");
  assert.doesNotMatch(page, /unstable_cache|"use cache"|export const revalidate/);
});

test("the merci page is noindex, sends no referrer, titles itself without personal data and refreshes only a pending state", () => {
  const page = source("src/app/[slug]/merci/page.tsx");
  assert.match(page, /title: `Confirmation · \$\{resolved\.pro\.businessName\}`, robots: \{ index: false \}, referrer: "no-referrer"/);
  assert.match(page, /<MerciRefresher key=\{state\.kind\} active=\{state\.kind === "pending"\} \/>/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /const testLine = paid && !reference\.livemode;/);
  assert.match(page, /COPY\.TEST_PAYMENT_LINE/);
});

test("the merci page counts every paid state as paid: the green icon and the test-payment line, the cancelled booking included (G4c)", () => {
  const page = source("src/app/[slug]/merci/page.tsx");
  assert.match(
    page,
    /const paid = state\.kind === "booked" \|\| state\.kind === "paid_shop" \|\| state\.kind === "paid_late" \|\| state\.kind === "paid_cancelled";/,
  );
  assert.match(page, /const testLine = paid && !reference\.livemode;/);
});

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
  assert.match(
    page,
    /visitor=\{\{\s*state: visitor\.state,\s*email: visitor\.state === "verified" \? visitor\.email : null,\s*name: visitor\.state === "verified" \? visitor\.name : null,?\s*\}\}/,
    "the session name prefills a field only for a verified visitor, like the address (G4c)",
  );
  assert.match(page, /formatMoney\(offer\.priceCents, pro\.currency\)/);
  assert.match(page, /const testMode = payment === "live" \? null : payment;/);
  assert.match(page, /return offerMetadata\(loaded\);/, "the URL may carry p: offerMetadata never sends the referrer (page-metadata.test.ts)");
  assert.doesNotMatch(page, /\b(customerId|ownerUserId|userId)=\{/, "no identity in a prop");
});

test("both public forms prefill the name by one rule: the session name for a verified visitor only, never an unverified or impersonated one (G4c)", () => {
  const rule = /name: visitor\.state === "verified" \? visitor\.name : null/g;
  for (const path of ["src/app/[slug]/seance/[occurrenceId]/page.tsx", "src/app/[slug]/offre/[offerId]/page.tsx"]) {
    assert.equal(inCode(source(path), rule).length, 1, path);
    assert.doesNotMatch(codeView(source(path)), /name: visitor\.name\b/, `${path}: no other way to prefill a name`);
  }
});

test("the offer page mounts one VerifyEmailBanner for every signed-in visitor, above the checkout, so it survives a code being accepted (G1b carry)", () => {
  const page = source("src/app/[slug]/offre/[offerId]/page.tsx");
  assert.equal((page.match(/<VerifyEmailBanner/g) ?? []).length, 1, "one instance");
  assert.match(page, /\{visitor\.email !== null && <VerifyEmailBanner email=\{visitor\.email\} verified=\{visitor\.state === "verified"\} \/>\}/);
  assert.ok(page.indexOf("<VerifyEmailBanner") < page.indexOf("<OfferCheckoutForm"), "above the checkout form");
});

test("the offer form is keyed on the visitor state, so a code accepted under the banner remounts it on the session's e-mail (review round 1)", () => {
  const page = source("src/app/[slug]/offre/[offerId]/page.tsx");
  assert.match(page, /<OfferCheckoutForm\s+key=\{visitor\.state\}\s/);
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
  assert.match(page, /<CheckoutReturn key=\{paymentReturn\.block\.purchaseId\} \{\.\.\.paymentReturn\.block\} \/>/);
  assert.match(page, /\{visitor\.owner && \(\s*<div[^>]*>\s*<PendingHolds slug=\{pro\.slug\} holds=\{holdRows\} \/>/);
  assert.match(page, /\.filter\(\(h\) => h\.purchaseId !== paymentReturn\.shownPurchaseId\)/, "the purchase shown by the block is not listed twice");
  assert.equal(inCode(page, /\bpaymentReturnOf\(/g).length, 1, "the block, the booked state and the ended line come from one derivation (G4c)");
  assert.match(
    page,
    /paymentReturnOf\(\{ slug: pro\.slug, tz: pro\.timezone, now, readOnly, reference: refView, ownerFacts, ownerPending \}\)/,
    "the pro's zone and the request's one clock",
  );
  assert.match(
    page,
    /ownerPurchaseId === null \|\| ownerPurchaseId === refView\?\.purchaseId\s*\? null\s*: referenceForPage\(await getPurchaseReference\(pro\.professionalId, ownerPurchaseId, now\), seancePage, owner\)/,
    "the Owner's own pending purchase, read by the id of her own booking, only when the URL names another one",
  );
  assert.match(page, /getLivePendingHolds\(pro\.professionalId, owner\.customerId, now\)/, "the holds of the Owner's own customer at this pro");
});

test("the séance page mounts the release status once, outside every condition, above the payment block (G4c)", () => {
  const page = seancePage();
  assert.equal(inCode(page, /<ReleaseStatus \/>/g).length, 1);
  assert.match(page, /^\s*<ReleaseStatus \/>\r?$/m, "on its own line, with no && or ternary around it: it must survive the revalidation that removes the block");
  assert.ok(page.indexOf("<ReleaseStatus />") < page.indexOf("<CheckoutReturn"), "mounted before the block it speaks for");
  assert.match(seance(), /import \{ ReleaseStatus \} from "@\/components\/public\/release-status";/);
});

test("the booking form starts over when the page's reference changes, so an old refusal never sits beside a new payment block (G4c)", () => {
  const page = seancePage();
  assert.match(
    page,
    /<OccurrenceBooking\s+key=\{`\$\{visitor\.state\}:\$\{usable !== null \? "spend" : "buy"\}:\$\{refView\?\.purchaseId \?\? ""\}`\}/,
    "the visitor, the mode and the reference the URL names (the validated one, so a junk p changes nothing)",
  );
});

test("an impersonating admin sees the payment block read-only and no Checkout URL on the séance and offer pages; merci has no payment control (G4b, G4c)", () => {
  // The holds list is already out of reach: it mounts under `visitor.owner &&` (pinned above) and an impersonated session
  // has no Owner (identity.db.test.ts, « resolveVisitor (S2, S42): an impersonated session has no owner… »).
  for (const [page, call] of [
    [seancePage(), /paymentReturnOf\(\{ slug: pro\.slug, tz: pro\.timezone, now, readOnly, reference: refView, ownerFacts, ownerPending \}\)/],
    [bodyOf(source("src/app/[slug]/offre/[offerId]/page.tsx"), "OfferPage"), /checkoutBlockOf\(refView, \{ slug, tz: pro\.timezone, now, readOnly \}\)/],
  ] as const) {
    assert.equal(inCode(page, /const readOnly = visitor\.state === "impersonating";/g).length, 1);
    assert.match(page, call, "the block is told");
    assert.deepEqual(inCode(page, /\.resumeUrl\b/g), [], "a page never reads the Checkout URL: the pure module hands it over, gated");
  }
  // The one read of the Checkout URL, in the module, is the gated one (checkout-return-view.test.ts runs it both ways).
  const blockModule = source("src/lib/public/checkout-return-view.ts");
  assert.equal(inCode(blockModule, /\bview\.resumeUrl\b/g).length, 1, "the only read of the purchase's Checkout URL");
  assert.match(blockModule, /resumeUrl: !ctx\.readOnly && status === "pending" \? view\.resumeUrl : null,/, "never to an impersonating admin's browser");
  const merci = source("src/app/[slug]/merci/page.tsx");
  assert.doesNotMatch(merci, /resumeUrl|abandonCheckoutAction|CheckoutReturn|PendingHolds|Reprendre le paiement|Libérer/, "merci only links to the espace and the page");
});

test("the séance page never lets a personal-link cookie hide the form or receive a purchase", () => {
  const page = source("src/app/[slug]/seance/[occurrenceId]/page.tsx");
  assert.match(page, /const guestBooked = customerViewer\?\.source === "guest" && facts\?\.booking != null;/);
  assert.match(page, /\{guestBooked && <Notice>\{COPY\.GUEST_BOOKING_EXISTS\}<\/Notice>\}/);
  assert.match(page, /const ownerFacts = customerViewer\?\.source === "owner" \? facts : null;/);
  // A guest fact never becomes a booked state: pinned where `booked` is built, with the guest-cookie case below.
});

const HOME = source("src/app/[slug]/page.tsx");

test("the séance page never promises a seat that is gone: seatGoneOf decides, in the pure module, for the block AND the line above the form (Task 28 review, G4c)", () => {
  const page = seancePage();
  // The page holds no copy of the seat or hold rules: no hold test, no `lapsed`, no second reading of a booking's status.
  assert.deepEqual(inCode(page, /\b(?:seatGoneOf|liveHoldEnd|holdLive|refEnded|lapsed|returnView|PageBooking)\b/g), [], "one rule, in visibility.ts");
  assert.deepEqual(inCode(page, /\bnew Date\(/g), [], "the clock is the loader's");
  assert.deepEqual(inCode(page, /\bbooking\.status\b/g), []);
  // A cancelled booking leaves the line, not a block that says « réserver à nouveau »; an expired one the block's own words.
  assert.match(page, /\{paymentReturn\.ended === "cancelled" && <Notice>\{COPY\.ENDED_CANCELLED\}<\/Notice>\}/);
  assert.match(page, /\{paymentReturn\.ended === "expired" && <Notice>\{COPY\.ENDED_EXPIRED\}<\/Notice>\}/);
  // The module asks the seat rule twice (the block, and the reason the block is absent) and the hold rule twice (the end time
  // of the block, and the booked state of a reference); neither is written again with a clock.
  const derivation = source("src/lib/public/checkout-return-view.ts");
  assert.equal(inCode(derivation, /\bseatGoneOf\(/g).length, 2);
  assert.equal(inCode(derivation, /\bliveHoldEnd\(/g).length, 2);
  assert.deepEqual(inCode(derivation, /\bnew Date\(/g), [], "the hold rule is written in visibility.ts only");
  assert.deepEqual(inCode(derivation, /\bbooking\.status === "cancelled"/g), [], "the cancelled seat is seatGoneOf's alone");
  const hold = source("src/lib/public/visibility.ts");
  assert.equal(inCode(hold, /\.getTime\(\) > now\.getTime\(\)/g).length, 1, "the hold rule, once");
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
  // The whole tag, read with the brace-aware scan: an arrow function in an earlier prop never ends it early (G4b).
  const bars = openingTags(HOME, "VisitorBar");
  assert.equal(bars.length, 1, "one bar");
  assert.match(bars[0].text, /\shasGuestSpace=\{visitor\.guestCustomerId !== null\}/);
  assert.doesNotMatch(bars[0].text, /\b(?:email|name)=/, "the bar gets no address and no name: the confirmation banner is the page's");
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
  // Each source test is counted in code, once, on the line that gives it its meaning (a comment that spells it is not it, G4b).
  assert.equal(inCode(page, /const ownerFacts = customerViewer\?\.source === "owner" \? facts : null;/g).length, 1);
  assert.equal(inCode(page, /\bsource === "owner"/g).length, 1, "the Owner's facts are told apart once");
  assert.equal(inCode(page, /const guestBooked = customerViewer\?\.source === "guest" && facts\?\.booking != null;/g).length, 1);
  assert.equal(inCode(page, /\bsource === "guest"/g).length, 1);
  assert.equal(inCode(page, /\bguestBooked\b/g).length, 2, "defined, then read by the notice only");
  assert.match(page, /\{guestBooked && <Notice>\{COPY\.GUEST_BOOKING_EXISTS\}<\/Notice>\}/);
  // The derivation gets the Owner's facts and the reference, never `facts` itself (a guest fact may be among them) ...
  const at = page.indexOf("paymentReturnOf({");
  assert.notEqual(at, -1);
  const call = page.slice(at, page.indexOf("});", at));
  assert.deepEqual(inCode(call, /\bfacts\b/g), [], "no guest fact reaches the derivation");
  assert.match(call, /\bownerFacts\b/);
  assert.deepEqual(inCode(page, /\bbooked = /g), [], "the page assigns no booked state");
  // ... and `booked` is built there from them alone: three assignments (the Owner's booking, a confirmed reference, a live pending one).
  const text = source("src/lib/public/checkout-return-view.ts");
  const start = text.indexOf("let booked: PageBooking = null;");
  const end = text.indexOf("const block =", start);
  assert.ok(start !== -1 && end > start, "the derivation sits between its declaration and the block");
  const derivation = text.slice(start, end);
  assert.equal(inCode(derivation, /\bbooked = \{/g).length, 3);
  assert.equal(inCode(text, /\bbooked = /g).length, 3, "and nowhere else");
  assert.equal(inCode(derivation, /\bvia: "owner"/g).length, 1);
  assert.match(derivation, /if \(active !== null\) booked = \{ status: active\.status, via: "owner" \};/);
  assert.match(derivation, /else if \(a\.reference\?\.booking\)/, "a reference only: no other source");
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

test("a state label has one colour: the planning row and the séance page both read stateBadgeVariant of the state's kind (G4c)", () => {
  const planning = source("src/components/public/public-planning.tsx");
  const page = seancePage();
  assert.equal(inCode(planning, /<Badge variant=\{stateBadgeVariant\(vm\.stateKind\)\}>/g).length, 1, "the row");
  assert.equal(inCode(page, /<Badge variant=\{stateBadgeVariant\(state\.kind\)\}>/g).length, 1, "the séance page");
  assert.match(planning, /import \{[^}]*\bstateBadgeVariant\b[^}]*\} from "@\/lib\/public\/planning-view";/);
  assert.match(seance(), /import \{[^}]*\bstateBadgeVariant\b[^}]*\} from "@\/lib\/public\/planning-view";/);
  for (const [name, text] of [["planning", planning], ["séance page", seance()]] as const) {
    const code = codeView(text);
    assert.doesNotMatch(code, /function stateBadgeVariant\b|const stateBadgeVariant\b/, `${name}: no local copy of the mapping`);
    assert.doesNotMatch(code, /variant=\{[^}]*(?:"destructive"|"success"|"default")/, `${name}: a badge colour is never chosen inline`);
    assert.doesNotMatch(code, /stateText\s*===|PUBLIC_STATE_LABELS/, `${name}: no decision keyed on the wording of a label`);
  }
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

test("/[slug] holds the public projection of the pro, never the professional row (G4a), through the one cached read of the layout (G4b)", () => {
  const page = bodyOf(HOME, "PublicProfilePage");
  assert.match(page, /const page = await getPublicPage\(slug\);\s*if \(!page \|\| page\.suspended\) notFound\(\);\s*const \{ pro, branding, bio \} = page;/, "a suspended pro is offline here");
  assert.match(HOME, /<PublicShell branding=\{branding\}>/, "the shell gets the nine branding fields, not the row");
  assert.match(HOME, /\{bio && <p /, "the presentation text comes from the projection");
  assert.doesNotMatch(HOME, /publicProOfRow|page\.pro\.(?:bio|headline)|branding=\{page\.pro\}|\.\.\.page\.pro/, "the row mapper and the row spread are gone from the page");
  const metadata = bodyOf(HOME, "generateMetadata");
  assert.match(metadata, /const page = await getPublicPage\(slug\);\s*if \(!page \|\| page\.suspended\) return \{ title: "Page introuvable" \};/);
  assert.match(metadata, /title: page\.pro\.businessName/);
  assert.match(metadata, /description: page\.branding\.headline \?\? undefined/);
  // The layout, generateMetadata and the page share the request-cached getPublicPage: one professional query per render.
  assert.equal(inCode(HOME, /\bgetPublicPage\(/g).length, 2, "generateMetadata and the page, nothing else");
  assert.deepEqual(inCode(HOME, /\b(?:getPublicPageProfile|publicPageExists|getPublicProfile|readPublicProfile|resolvePublicPro)\b/g), [], "no second read of the pro");
});

test("the [slug] layout refuses a segment that is no slug before any read, then reads the pro through the page's cached read (G4b)", () => {
  const layout = source("src/app/[slug]/layout.tsx");
  assert.match(layout, /^import \{ SLUG_PARAM_RE \} from "@\/lib\/public\/context";\r?$/m);
  assert.match(layout, /^import \{ getPublicPage \} from "@\/server\/public-queries";\r?$/m);
  const body = codeView(bodyOf(layout, "SlugLayout"));
  const shape = body.indexOf("if (!SLUG_PARAM_RE.test(slug)) notFound();");
  const read = body.indexOf("if (!(await getPublicPage(slug))) notFound();");
  assert.ok(shape !== -1, "the shape check is in the layout");
  assert.ok(read > shape, "and runs before the read: /.env or /wp-login.php costs no query");
  assert.equal(body.slice(0, shape).split("await").length - 1, 1, "only the params are awaited before the shape check");
  assert.equal(body.split("await").length - 1, 2, "the params, then the one read");
  assert.doesNotMatch(body, /\.suspended|publicPageExists|getPublicProfile|resolvePublicPro/, "a suspended pro still exists here (merci keeps working)");
});

test("the offer metadata comes from offerMetadata: a page that 404s or whose offer is no longer sold is titled as the 404 (G4b)", () => {
  const metadata = bodyOf(source("src/app/[slug]/offre/[offerId]/page.tsx"), "generateMetadata");
  assert.match(metadata, /const loaded = await loadOffer\(slug, offerId\);\s*return offerMetadata\(loaded\);/);
  assert.doesNotMatch(codeView(metadata), /businessName|title:/, "no title is built here");
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

/** The props on a JSX element that would hand it the pro's projection or row whole: `pro=`, `profile=`, or a spread of them. */
const WHOLE_PRO = /\b(?:pro|profile)=\{|\{\s*\.\.\.\s*(?:pro|profile|page|loaded|resolved)\b/;

/** Every opening tag of a JSX source, whatever its name (the brace-aware scan of `openingTags`, G4b). */
function allTags(text: string): { name: string; text: string }[] {
  const names = new Set([...codeView(text).matchAll(/<([A-Za-z][\w.]*)(?=[\s/>])/g)].map((m) => m[1]));
  return [...names].flatMap((name) => openingTags(text, name).map((t) => ({ name, text: t.text })));
}

test("the pro-detecting scan sees a whole-pro prop on any element, after an arrow function too, and lets picked props through (G4b)", () => {
  const leaks = (jsx: string) => allTags(jsx).filter((t) => WHOLE_PRO.test(t.text)).map((t) => t.name);
  assert.deepEqual(leaks("<A onX={() => 1} pro={pro} />"), ["A"]);
  assert.deepEqual(leaks("<B.C profile={profile.pro} />"), ["B.C"]);
  assert.deepEqual(leaks("<D {...pro} />\n<E { ...profile } />\n<F {...loaded} />\n<J {...page} />"), ["D", "E", "F", "J"], "page: the cached read of /[slug] (G4b)");
  assert.deepEqual(leaks('<G slug={pro.slug} businessName={pro.businessName} branding={branding} {...checkout} />'), []);
  assert.deepEqual(leaks("// <H pro={pro} />\nconst s = '<I pro={pro} />';"), [], "a comment or a string is not markup");
});

test("no element of the public pages receives the pro whole: pro=, profile= and their spreads are refused (G4b)", () => {
  // The [slug] layout renders no markup (it returns its children), so it has nothing to scan.
  for (const path of [
    "src/app/[slug]/page.tsx",
    "src/app/[slug]/seance/[occurrenceId]/page.tsx",
    "src/app/[slug]/offre/[offerId]/page.tsx",
    "src/app/[slug]/merci/page.tsx",
  ]) {
    const tags = allTags(source(path));
    assert.ok(tags.length > 0, `${path}: the scan reads its markup`);
    assert.deepEqual(
      tags.filter((t) => WHOLE_PRO.test(t.text)).map((t) => t.text),
      [],
      `${path} hands the pro whole to an element`,
    );
  }
});

test("the espace wrappers take the page's clock as their last parameter and never read their own; every page hands them its one instant (G4c)", () => {
  const queries = source("src/server/client-queries.ts");
  for (const [name, signature] of [
    ["getCustomerSpacePage", /export function getCustomerSpacePage\(professionalId: string, customerId: string, now: Date\)/],
    ["getSpendableSeances", /export function getSpendableSeances\(professionalId: string, customerId: string, now: Date\)/],
    ["getMySpacePage", /export function getMySpacePage\(session: SessionFacts \| null, now: Date\)/],
  ] as const) {
    assert.match(queries, signature, `${name} takes the instant last`);
    assert.doesNotMatch(codeView(bodyOf(queries, name)), /new Date\(/, `${name} never reads the clock itself`);
  }
  // /[slug] and the séance page already hold their one clock; the espace and /mon-espace pages read theirs once.
  assert.match(HOME, /getCustomerSpacePage\(pro\.professionalId, visitor\.owner\.customerId, now\)/);
  assert.match(seancePage(), /getCustomerSpacePage\(pro\.professionalId, owner\.customerId, now\)/);
  const espace = source("src/app/[slug]/espace/page.tsx");
  assert.equal(inCode(espace, /new Date\(\)/g).length, 1, "the espace page reads the clock once");
  assert.match(espace, /getCustomerSpacePage\(pro\.id, shownCustomerId, now\)/);
  assert.match(espace, /getSpendableSeances\(pro\.id, shownCustomerId, now\)/);
  const mine = source("src/app/mon-espace/page.tsx");
  assert.equal(inCode(mine, /new Date\(\)/g).length, 1, "/mon-espace reads the clock once");
  assert.match(mine, /getMySpacePage\(session, new Date\(\)\)/, "its one read takes the instant it reads once");
});
