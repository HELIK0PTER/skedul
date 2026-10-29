/**
 * FormError: the one failure line of a form (G4c, Item 3). The dashboard forms mount it with their text; the public
 * forms keep it mounted all the time (`alwaysMounted`), so a screen reader announces the text when it comes. Run from the
 * repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FormError } from "./form-error";

type Props = { message: string | null | undefined; alwaysMounted?: boolean; tabIndex?: number };
const render = (props: Props) => renderToStaticMarkup(createElement(FormError, props));

test("without the option, an empty message renders nothing and a message renders an alert", () => {
  for (const message of [null, undefined, ""]) assert.equal(render({ message }), "", `message ${JSON.stringify(message)}`);
  const shown = render({ message: "Quelque chose a échoué." });
  assert.match(shown, /^<p[^>]*\brole="alert"[^>]*>Quelque chose a échoué\.<\/p>$/);
  assert.match(shown, /\bbg-destructive\/10\b/);
  assert.match(shown, /\btext-rose-700\b/, "AA on the tinted background");
});

test("alwaysMounted keeps the alert in the page when there is nothing to say: empty, read by nobody, still an alert", () => {
  for (const message of [null, undefined, ""]) {
    const idle = render({ message, alwaysMounted: true });
    assert.match(idle, /^<p[^>]*\brole="alert"[^>]*><\/p>$/, `message ${JSON.stringify(message)}: the region is there with nothing in it`);
    assert.match(idle, /\bsr-only\b/);
    assert.doesNotMatch(idle, /bg-destructive/, "no empty coloured box");
  }
});

test("alwaysMounted with a message is the very line the option-less one renders", () => {
  const plain = render({ message: "Refusé.", tabIndex: -1 });
  const mounted = render({ message: "Refusé.", tabIndex: -1, alwaysMounted: true });
  assert.equal(mounted, plain);
  assert.match(mounted, /\btabindex="-1"/);
  assert.doesNotMatch(mounted, /\bsr-only\b/);
});

test("the failure line has one source: the three forms that used to repeat its class string render FormError", () => {
  const classString = /bg-destructive\/10 px-3 py-2 text-sm text-rose-700/;
  assert.match(readFileSync("src/components/dashboard/form-error.tsx", "utf8"), classString, "defined here");
  for (const path of ["src/components/public/offer-checkout-form.tsx", "src/components/public/occurrence-booking.tsx"]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, classString, `${path}: no copy of the class string`);
    assert.doesNotMatch(source, /\bERROR_CLASS\b/, `${path}: no local class constant`);
    assert.match(source, /import \{ FormError \} from "@\/components\/dashboard\/form-error";/, path);
    assert.match(source, /<FormError\b[^>]*\balwaysMounted\b/, `${path}: its line stays mounted`);
  }
});
