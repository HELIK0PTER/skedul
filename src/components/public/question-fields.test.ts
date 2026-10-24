import assert from "node:assert/strict";
import test from "node:test";

import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { QuestionFieldDef } from "@/lib/public/occurrence-form";

import { QuestionFields } from "./question-fields";

const noop = () => {};
type Props = ComponentProps<typeof QuestionFields>;

const QUESTIONS: QuestionFieldDef[] = [
  { id: "q1", label: "Niveau", type: "text", options: null, required: true },
  { id: "q2", label: "Pied fort", type: "choice", options: ["Droit", "Gauche"], required: false },
  { id: "q3", label: "Première fois", type: "boolean", options: null, required: true },
];

const render = (over: Partial<Props> = {}): string =>
  renderToStaticMarkup(
    createElement(QuestionFields, { idPrefix: "t", questions: QUESTIONS, value: {}, onChange: noop, errors: {}, ...over }),
  );

/** The opening tag of the control with this id. */
function tagOf(markup: string, id: string): string {
  const found = new RegExp(`<(?:input|textarea|select)[^>]*\\bid="${id}"[^>]*>`).exec(markup);
  assert.ok(found, `no control with the id ${id}`);
  return found[0];
}

test("no question renders nothing", () => {
  assert.equal(render({ questions: [] }), "");
});

test("a text question is a labelled textarea bounded by the answer length, « (obligatoire) » when required", () => {
  const markup = render({ value: { q1: "Débutant" } });
  assert.match(markup, /<label[^>]*for="t-q-q1"[^>]*>Niveau \(obligatoire\)<\/label>/);
  const tag = tagOf(markup, "t-q-q1");
  assert.match(tag, /^<textarea/);
  assert.match(tag, /maxlength="2000"/i);
  assert.match(markup, /<textarea[^>]*>Débutant<\/textarea>/);
  assert.match(markup, /<label[^>]*for="t-q-q2"[^>]*>Pied fort<\/label>/, "an optional question has no suffix");
});

test("a choice question is a select that starts on « Choisir » and lists its options", () => {
  const markup = render({ value: { q2: "Gauche" } });
  assert.match(tagOf(markup, "t-q-q2"), /^<select/);
  const options = markup.match(/<option[^>]*>[^<]*<\/option>/g) ?? [];
  assert.equal(options.length, 3);
  assert.match(options[0], /value=""/);
  assert.match(options[0], />Choisir</);
  assert.equal(options.filter((option) => option.includes("selected")).length, 1);
  assert.ok(options[2].includes("selected") && options[2].includes(">Gauche<"));
});

test("a boolean question is a group of two radios « Oui » and « Non »", () => {
  const markup = render({ value: { q3: "Non" } });
  assert.match(markup, /<legend[^>]*>Première fois \(obligatoire\)<\/legend>/);
  const radios = markup.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
  assert.equal(radios.length, 2);
  for (const radio of radios) assert.match(radio, /name="t-q-q3"/);
  assert.ok(radios[0].includes('value="Oui"') && !radios[0].includes("checked"));
  assert.ok(radios[1].includes('value="Non"') && radios[1].includes("checked"));
  assert.match(markup, /<label[^>]*>[^<]*<input[^>]*value="Oui"[^>]*\/?>Oui<\/label>/);
});

test("an error is tied to its control and announced", () => {
  const markup = render({ errors: { q1: "Merci de répondre à : Niveau", q3: "Merci de répondre à : Première fois" } });
  const text = tagOf(markup, "t-q-q1");
  assert.match(text, /aria-invalid="true"/);
  assert.match(text, /aria-describedby="[^"]*t-q-q1-error/);
  assert.match(markup, /<p id="t-q-q1-error" role="alert"[^>]*>Merci de répondre à : Niveau<\/p>/);
  const firstRadio = (markup.match(/<input[^>]*type="radio"[^>]*>/g) ?? [])[0] ?? "";
  assert.match(firstRadio, /aria-invalid="true"/);
  assert.match(firstRadio, /aria-describedby="t-q-q3-error"/);
  assert.match(markup, /<p id="t-q-q3-error" role="alert"[^>]*>Merci de répondre à : Première fois<\/p>/);
});
