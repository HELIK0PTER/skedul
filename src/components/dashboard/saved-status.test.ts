import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SavedStatus } from "./saved-status";

const render = (props: { saved: boolean; message?: string }) => renderToStaticMarkup(createElement(SavedStatus, props));

test("SavedStatus keeps its live region mounted and empty until the save went through (final review UI-3, UI-6)", () => {
  const idle = render({ saved: false });
  assert.match(idle, /^<span[^>]*role="status"[^>]*><\/span>$/, "the region is there, with nothing in it");
  const done = render({ saved: true });
  assert.match(done, /^<span[^>]*role="status"/, "the same region");
  assert.match(done, /Enregistré<\/span>$/, "now it says so");
});

test("SavedStatus is green-700 (AA on white), never the success token (final review UI-3)", () => {
  for (const saved of [false, true]) {
    const markup = render({ saved });
    assert.match(markup, /\btext-green-700\b/);
    assert.doesNotMatch(markup, /text-success/);
  }
});

test("SavedStatus takes another message and hides the icon from assistive technology", () => {
  const markup = render({ saved: true, message: "Offre enregistrée" });
  assert.match(markup, /Offre enregistrée<\/span>$/);
  assert.match(markup, /<svg[^>]*aria-hidden="true"/);
});
