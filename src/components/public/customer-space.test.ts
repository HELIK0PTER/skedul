import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CustomerSpace } from "@/lib/back-office/customer-space";

import { CustomerSpaceView } from "./customer-space";

const space = (over: Partial<CustomerSpace> = {}): CustomerSpace => ({
  businessName: "Altinha Paris",
  customer: { id: "c1", name: "Beatriz Almeida", email: "beatriz@example.com" },
  upcoming: [],
  wallet: [],
  ...over,
});

const render = (s: CustomerSpace) =>
  renderToStaticMarkup(createElement(CustomerSpaceView, { businessName: "Altinha Paris", slug: "altinha-paris", space: s }));

test("an empty wallet leads to the Boutique of the pro's page, not to the page in general (final review UI-14)", () => {
  const markup = render(space());
  assert.match(markup, /Aucun ticket/);
  assert.match(markup, /<a[^>]*href="\/altinha-paris#boutique"[^>]*>Voir la boutique<\/a>/);
});

test("a wallet with tickets has no Boutique call to action", () => {
  const markup = render(
    space({
      wallet: [
        { ticketTypeId: "t1", name: "Cours collectif", color: "#6d5cf6", archived: false, typeClass: "ok", usable: 2, expiries: [] },
      ],
    }),
  );
  assert.doesNotMatch(markup, /Voir la boutique/);
});
