import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CustomerSpace } from "@/lib/back-office/customer-space";

import { WalletPanel } from "./wallet-panel";

type Wallet = CustomerSpace["wallet"];

const entry = (over: Partial<Wallet[number]> = {}): Wallet[number] => ({
  ticketTypeId: "t1",
  name: "Cours collectif",
  color: "#6d5cf6",
  archived: false,
  typeClass: "ok",
  usable: 2,
  expiries: ["2 valables jusqu'au 30/11 inclus"],
  ...over,
});

const render = (wallet: Wallet, variant: "full" | "compact"): string =>
  renderToStaticMarkup(createElement(WalletPanel, { slug: "altinha-paris", businessName: "Altinha Paris", wallet, variant }));

/** The visible text of a markup string: tags dropped, the entities of apostrophes and ampersands decoded. */
function textOf(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

test("full variant, empty wallet: « Aucun ticket », the Boutique of this very page and « Mon espace »", () => {
  const markup = render([], "full");
  const text = textOf(markup);
  assert.ok(text.startsWith("Vos tickets"), text);
  assert.match(text, /Aucun ticket/);
  assert.match(markup, /<a[^>]*href="#boutique"[^>]*>Voir la boutique<\/a>/);
  assert.match(markup, /<a[^>]*href="\/altinha-paris\/espace"[^>]*>Mon espace<\/a>/);
});

test("full variant: one line per type with its count and its expiries, and no empty-state text", () => {
  const markup = render([entry(), entry({ ticketTypeId: "t2", name: "Cours d'essai", usable: 1, expiries: ["1 sans limite de validité"] })], "full");
  const text = textOf(markup);
  assert.match(text, /2 × Cours collectif/);
  assert.match(text, /2 valables jusqu'au 30\/11 inclus/);
  assert.match(text, /1 × Cours d'essai/);
  assert.match(text, /1 sans limite de validité/);
  assert.doesNotMatch(text, /Aucun ticket/);
  assert.doesNotMatch(text, /Voir la boutique/);
});

test("full variant: an archived type and a type no upcoming event accepts each carry their own note", () => {
  const text = textOf(
    render(
      [
        entry({ ticketTypeId: "t1", name: "Stage d'été", archived: true, typeClass: "archived" }),
        entry({ ticketTypeId: "t2", name: "Cours d'essai", typeClass: "orphan" }),
      ],
      "full",
    ),
  );
  assert.match(text, /Ce type n'est plus proposé par Altinha Paris\./);
  assert.match(text, /Aucune séance à venir n'accepte ce type pour le moment\./);
  assert.equal(text.split("Aucune séance à venir n'accepte ce type pour le moment.").length - 1, 1, "only the orphan type says it");
  assert.equal(text.split("Ce type n'est plus proposé par Altinha Paris.").length - 1, 1, "only the archived type says it");
});

test("compact variant: one line « Vos tickets : N × type » joined by a comma, then « Mon espace »", () => {
  const markup = render([entry(), entry({ ticketTypeId: "t2", name: "Cours d'essai", usable: 1 })], "compact");
  assert.equal(textOf(markup), "Vos tickets : 2 × Cours collectif, 1 × Cours d'essai Mon espace");
  assert.match(markup, /<a[^>]*href="\/altinha-paris\/espace"[^>]*>Mon espace<\/a>/);
});

test("compact variant renders nothing for an empty wallet", () => {
  assert.equal(render([], "compact"), "");
});

test("the names of the pro's types wrap anywhere (user-supplied text)", () => {
  const markup = render([entry({ name: "Cours".repeat(30) })], "full");
  assert.match(markup, /class="[^"]*wrap-anywhere[^"]*"[^>]*>2 × (Cours){30}</);
});
