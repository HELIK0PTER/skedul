import assert from "node:assert/strict";
import test from "node:test";

import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Dialog } from "@/components/ui/dialog";

import { ConfirmDialog } from "./confirm-dialog";

const noop = () => {};
const copy = { title: "Archiver « Cours » ?", body: "Les tickets restent dans les portefeuilles.", confirm: "Archiver" };

function confirmMarkup(over: { open?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(ConfirmDialog, { open: over.open ?? true, copy, pending: false, error: null, onConfirm: noop, onClose: noop }),
  );
}

/** The value of `attr` on the first element whose opening tag matches `tagPattern`. */
function attr(markup: string, tagPattern: RegExp, name: string): string | null {
  const tag = tagPattern.exec(markup)?.[0];
  if (!tag) return null;
  const value = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return value ? value[1] : null;
}

test("the confirmation dialog is named by its title and described by its consequences", () => {
  const markup = confirmMarkup();
  const labelledBy = attr(markup, /<div[^>]*role="dialog"[^>]*>/, "aria-labelledby");
  const describedBy = attr(markup, /<div[^>]*role="dialog"[^>]*>/, "aria-describedby");
  assert.ok(labelledBy, "aria-labelledby on the dialog");
  assert.ok(describedBy, "aria-describedby on the dialog");
  assert.notEqual(labelledBy, describedBy);

  const title = new RegExp(`<h2[^>]*id="${labelledBy}"[^>]*>([^<]*)</h2>`).exec(markup);
  assert.ok(title, "an h2 carries the labelledby id");
  assert.equal(title[1], copy.title);

  const body = new RegExp(`<p[^>]*id="${describedBy}"[^>]*>([^<]*)</p>`).exec(markup);
  assert.ok(body, "the consequences paragraph carries the describedby id");
  assert.equal(body[1], copy.body);
});

test("a closed confirmation dialog renders nothing", () => {
  assert.equal(confirmMarkup({ open: false }), "");
});

test("Dialog uses the ids it is given and still names itself without them", () => {
  const givenProps: ComponentProps<typeof Dialog> = {
    open: true,
    onClose: noop,
    title: "Titre",
    labelledBy: "mon-titre",
    describedBy: "ma-description",
    children: "x",
  };
  const given = renderToStaticMarkup(createElement(Dialog, givenProps));
  assert.equal(attr(given, /<div[^>]*role="dialog"[^>]*>/, "aria-labelledby"), "mon-titre");
  assert.equal(attr(given, /<div[^>]*role="dialog"[^>]*>/, "aria-describedby"), "ma-description");
  assert.match(given, /<h2[^>]*id="mon-titre"/);

  const bareProps: ComponentProps<typeof Dialog> = { open: true, onClose: noop, title: "Titre", children: "x" };
  const bare = renderToStaticMarkup(createElement(Dialog, bareProps));
  const generated = attr(bare, /<div[^>]*role="dialog"[^>]*>/, "aria-labelledby");
  assert.ok(generated, "a dialog without props is still named");
  assert.match(bare, new RegExp(`<h2[^>]*id="${generated}"`));
  assert.equal(attr(bare, /<div[^>]*role="dialog"[^>]*>/, "aria-describedby"), null);
});
