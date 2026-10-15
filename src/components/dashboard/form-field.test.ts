import assert from "node:assert/strict";
import test from "node:test";

import { createElement, Fragment, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FormField } from "./form-field";

function render(props: { help?: string; error?: string | null }, child: ReactNode): string {
  const fieldProps: ComponentProps<typeof FormField> = { label: "Nom", htmlFor: "name", ...props, children: child };
  return renderToStaticMarkup(createElement(FormField, fieldProps));
}

/** The opening tag of the first <input>, to assert on its attributes only. */
function inputTag(markup: string): string {
  const match = /<input[^>]*>/.exec(markup);
  assert.ok(match, markup);
  return match[0];
}

const input = () => createElement("input", { id: "name" });

test("a help text is referenced by the control", () => {
  const tag = inputTag(render({ help: "Aide" }, input()));
  assert.match(tag, /aria-describedby="name-help"/);
  assert.doesNotMatch(tag, /aria-invalid/);
});

test("an error is referenced by the control and marks it invalid", () => {
  const markup = render({ error: "Trop court" }, input());
  const tag = inputTag(markup);
  assert.match(tag, /aria-describedby="name-error"/);
  assert.match(tag, /aria-invalid="true"/);
  assert.match(markup, /<p id="name-error" role="alert"/);
});

test("help and error are both referenced, help first", () => {
  const tag = inputTag(render({ help: "Aide", error: "Trop court" }, input()));
  assert.match(tag, /aria-describedby="name-help name-error"/);
  assert.match(tag, /aria-invalid="true"/);
});

test("without help or error the control is left untouched", () => {
  const tag = inputTag(render({}, input()));
  assert.doesNotMatch(tag, /aria-describedby/);
  assert.doesNotMatch(tag, /aria-invalid/);
});

test("an existing aria-describedby is kept and extended", () => {
  const tag = inputTag(render({ help: "Aide" }, createElement("input", { id: "name", "aria-describedby": "autre" })));
  assert.match(tag, /aria-describedby="autre name-help"/);
});

test("a null error and an empty help inject nothing", () => {
  const tag = inputTag(render({ help: "", error: null }, input()));
  assert.doesNotMatch(tag, /aria-describedby/);
  assert.doesNotMatch(tag, /aria-invalid/);
});

test("a child that is not a single element is rendered as is", () => {
  const twoInputs = render({ help: "Aide", error: "Oups" }, [
    createElement("input", { key: "a", id: "name" }),
    createElement("input", { key: "b", id: "other" }),
  ]);
  assert.doesNotMatch(twoInputs, /aria-describedby="name-/);
  assert.doesNotMatch(twoInputs, /aria-invalid/);

  const fragment = render({ help: "Aide", error: "Oups" }, createElement(Fragment, null, input()));
  assert.doesNotMatch(fragment, /aria-describedby="name-/);
  assert.doesNotMatch(fragment, /aria-invalid/);

  const text = render({ help: "Aide" }, "texte");
  assert.match(text, /texte/);
});
