/**
 * Wiring guard for the espace view. CustomerSpaceView renders client leaves that import Server Actions (cancel, spend),
 * which node:test cannot load (server-only, the process db), so what the view must keep is pinned on its source, the
 * pattern of final-review-ui.test.ts. The texts it uses have their own pure tests (messages.test.ts, space-view.test.ts).
 * Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE = readFileSync("src/components/public/customer-space.tsx", "utf8");

test("an empty wallet leads to the Boutique of the pro's page, not to the page in general (final review UI-14)", () => {
  const empty = SOURCE.indexOf("space.wallet.length === 0");
  const list = SOURCE.indexOf("space.wallet.map(");
  const shop = SOURCE.indexOf("<Link href={boutiqueHref(slug)}>{COPY.SEE_SHOP}</Link>");
  assert.ok(empty !== -1 && shop > empty && shop < list, "the call to action sits in the empty branch only");
  assert.match(SOURCE, /\{COPY\.NO_TICKET\}/);
  assert.doesNotMatch(SOURCE, /Voir la boutique|Aucun ticket</, "the labels come from COPY, one source");
});

test("a booking offers « Annuler » only when it can be cancelled, and always says why or until when", () => {
  assert.match(SOURCE, /\{b\.cancellable && \(\s*<CancelBookingButton/);
  assert.match(SOURCE, /\{b\.cancelText\}/);
  assert.match(SOURCE, /coverage=\{b\.coverage\}/);
  assert.match(SOURCE, /\{COPY\.NO_UPCOMING\}/);
  assert.match(SOURCE, /`Voir la page de \$\{businessName\}`/, "the empty state has an action");
});

test("the « Utiliser vos tickets » section exists only when a séance can be spent, and carries the visitor's state to its buttons", () => {
  assert.match(SOURCE, /spend && spend\.seances\.length > 0 && \(/);
  assert.match(SOURCE, /`1 ticket « \$\{s\.ticketTypeName\} »`/, "each row names the type its one ticket is taken from");
  assert.match(SOURCE, /canSpend=\{spend\.canSpend\}/);
  assert.match(SOURCE, /visitorState=\{spend\.visitorState\}/);
  assert.match(SOURCE, /returnTo=\{spend\.returnTo\}/);
});

test("the wallet says when a type is archived and when no upcoming séance accepts it (COV-I2)", () => {
  assert.match(SOURCE, /w\.archived && /);
  assert.match(SOURCE, /Ce type n'est plus proposé par \$\{businessName\}\./);
  assert.match(SOURCE, /w\.typeClass === "orphan" && /);
  assert.match(SOURCE, /\{COPY\.ORPHAN_TYPE\}/);
});

test("a ticket of a bookable paid RDV type links to its RDV page with « Réserver un rendez-vous », named after the type (P5 § 3.13)", () => {
  assert.match(SOURCE, /\{w\.rdvBookable && \(/);
  assert.match(SOURCE, /<Link href=\{rdvPagePath\(slug, w\.ticketTypeId\)\} aria-label=\{`\$\{COPY\.RDV_CARD_CTA\} : \$\{w\.name\}`\}>/);
  assert.match(SOURCE, /\{COPY\.RDV_CARD_CTA\}/);
  assert.doesNotMatch(SOURCE, /Réserver un rendez-vous/, "the label comes from COPY, one source");
});

test("an RDV row's « Annuler » is told it is an RDV, so its dialog and its success line say « rendez-vous »", () => {
  assert.match(SOURCE, /kind=\{b\.kind\}/);
});

test("the « Vos prochaines réservations » heading can take the focus after a success removes the control that held it (WCAG 2.4.3)", () => {
  assert.match(SOURCE, /<CardTitle[^>]*id=\{UPCOMING_HEADING_ID\}/);
  assert.match(SOURCE, /<CardTitle[^>]*tabIndex=\{-1\}/);
});

test("one shared, always-mounted status line, above the cards", () => {
  assert.equal((SOURCE.match(/<SpaceStatusProvider>/g) ?? []).length, 1);
  assert.equal((SOURCE.match(/<SpaceStatusLine \/>/g) ?? []).length, 1);
  assert.ok(SOURCE.indexOf("<SpaceStatusLine />") < SOURCE.indexOf("<CardTitle"), "the line comes before the first card");
});

test("the view is a server component: no hook, no router, no browser API, no Date (props are strings)", () => {
  assert.doesNotMatch(SOURCE, /^"use client"/);
  assert.doesNotMatch(SOURCE, /\buse(State|Effect|Router|Transition|Ref)\b|window\.|document\.|new Date\(/);
});
