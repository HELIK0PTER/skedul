import assert from "node:assert/strict";
import test from "node:test";

import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { IdentityFields } from "./identity-fields";

const noop = () => {};
type Props = ComponentProps<typeof IdentityFields>;

const render = (over: Partial<Props> = {}): string =>
  renderToStaticMarkup(
    createElement(IdentityFields, {
      idPrefix: "t",
      value: { name: "Ana Souza", email: "ana@example.com", phone: "" },
      onChange: noop,
      emailLocked: false,
      errors: {},
      businessName: "Altinha Paris",
      website: "",
      onWebsite: noop,
      ...over,
    }),
  );

/** The visible text of a markup string: tags dropped, the entities of apostrophes and ampersands decoded. */
function textOf(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/** The opening tag of the control with this id. */
function tagOf(markup: string, id: string): string {
  const found = new RegExp(`<(?:input|textarea|select)[^>]*\\bid="${id}"[^>]*>`).exec(markup);
  assert.ok(found, `no control with the id ${id}`);
  return found[0];
}

test("the labels sit above the fields: « Prénom et nom », « Email », « Téléphone (facultatif) »", () => {
  const markup = render();
  const text = textOf(markup);
  assert.match(text, /Prénom et nom/);
  assert.match(text, /Email/);
  assert.match(text, /Téléphone \(facultatif\)/);
  assert.match(markup, /<label[^>]*for="t-name"/);
  assert.match(markup, /<label[^>]*for="t-email"/);
  assert.match(markup, /<label[^>]*for="t-phone"/);
  assert.match(tagOf(markup, "t-name"), /maxlength="80"/i);
  assert.match(tagOf(markup, "t-email"), /type="email"/);
  assert.match(tagOf(markup, "t-phone"), /type="tel"/);
  assert.match(tagOf(markup, "t-phone"), /maxlength="30"/i);
});

test("the data-use line names the pro and says why the details are kept", () => {
  assert.match(
    textOf(render()),
    /Vos coordonnées sont transmises à Altinha Paris pour gérer votre réservation\./,
  );
});

test("a locked e-mail is read-only and says whose address it is; an unlocked one is a normal field", () => {
  const locked = render({ emailLocked: true });
  const tag = tagOf(locked, "t-email");
  assert.match(tag, /readonly=""/i);
  assert.match(tag, /aria-describedby="t-email-help"/);
  assert.match(locked, /<p id="t-email-help"[^>]*>Adresse de votre compte\.<\/p>/);

  const open = render({ emailLocked: false });
  assert.doesNotMatch(tagOf(open, "t-email"), /readonly/i);
  assert.doesNotMatch(open, /Adresse de votre compte/);
});

test("each field error sits under its field and is tied to it (aria-describedby, aria-invalid, role alert)", () => {
  const markup = render({
    errors: {
      "identity.name": "Ce champ est obligatoire.",
      "identity.email": "Adresse email invalide.",
      "identity.phone": "30 caractères au maximum.",
    },
  });
  for (const field of ["name", "email", "phone"]) {
    const tag = tagOf(markup, `t-${field}`);
    assert.match(tag, /aria-invalid="true"/, field);
    assert.match(tag, new RegExp(`aria-describedby="[^"]*t-${field}-error`), field);
  }
  assert.match(markup, /<p id="t-name-error" role="alert"[^>]*>Ce champ est obligatoire\.<\/p>/);
  assert.match(markup, /<p id="t-email-error" role="alert"[^>]*>Adresse email invalide\.<\/p>/);
  assert.match(markup, /<p id="t-phone-error" role="alert"[^>]*>30 caractères au maximum\.<\/p>/);
  assert.doesNotMatch(tagOf(render(), "t-name"), /aria-invalid/);
});

test("the honeypot is an empty off-screen field hidden from assistive technology and from the tab order", () => {
  const markup = render();
  const wrapper = /<div[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/div>/.exec(markup);
  assert.ok(wrapper, "an aria-hidden wrapper");
  const tag = tagOf(wrapper[0], "t-website");
  assert.match(tag, /name="website"/);
  assert.match(tag, /tabindex="-1"/i);
  assert.match(tag, /autocomplete="off"/i);
  assert.match(wrapper[0], /Laissez ce champ vide/);
  assert.doesNotMatch(markup.replace(wrapper[0], ""), /name="website"/, "the honeypot is only in the hidden wrapper");
});
