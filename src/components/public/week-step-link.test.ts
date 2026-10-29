/**
 * Wiring guards for the week navigation of the public pages (P6 A44). WeekStepLink is a client component and the pages
 * that use it are server components reading the database, which the node:test runner cannot render, so what they keep
 * is pinned on their source. Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { openingTags } from "@/test/source-guards";

const source = (path: string): string => readFileSync(path, "utf8");

const STEP = "src/components/public/week-step-link.tsx";

test("a week step is the same link at every week: aria-disabled and inert at an end, never a disabled button in its place (P6 A44)", () => {
  const step = source(STEP);
  assert.match(step, /^"use client";/, "the inert click is an event handler");
  // A keyboard user who walks to the first or the horizon week keeps the focus: React keeps a DOM node only while the
  // element type at its position stays the same, and a <button disabled> in place of the link was a new node.
  const links = openingTags(step, "Link");
  assert.equal(links.length, 1, "one link, whatever the week");
  const link = links[0].text;
  assert.match(link, /href=\{href \?\? fallbackHref\}/, "at an end, the shown week's own address (a middle click opens the same page)");
  assert.match(link, /aria-disabled=\{disabled \|\| undefined\}/);
  assert.match(link, /onClick=\{disabled \? \(event\) => event\.preventDefault\(\) : undefined\}/, "Enter or a click does nothing at an end");
  assert.match(link, /prefetch=\{disabled \? false : undefined\}/, "the shown week is not prefetched again");
  const buttons = openingTags(step, "Button");
  assert.equal(buttons.length, 1);
  assert.match(buttons[0].topLevel, /\basChild\b/);
  assert.doesNotMatch(buttons[0].topLevel, /\sdisabled\b/, "never the disabled attribute: it takes the control out of the tab order");
  // The look of the old disabled button, read off aria-disabled instead.
  assert.match(buttons[0].text, /aria-disabled:pointer-events-none aria-disabled:opacity-50/);
});

test("the RDV page and the public planning walk their weeks through WeekStepLink, no disabled button left (P6 A44)", () => {
  const pages = [
    { file: "src/app/[slug]/rdv/[ticketTypeId]/page.tsx", fallback: /fallbackHref=\{nav\.selfHref\}/, scroll: true },
    { file: "src/components/public/public-planning.tsx", fallback: /fallbackHref=\{shownHref\}/, scroll: false },
  ];
  for (const page of pages) {
    const text = source(page.file);
    assert.match(text, /import \{ WeekStepLink \} from "@\/components\/public\/week-step-link";/, page.file);
    const steps = openingTags(text, "WeekStepLink");
    assert.equal(steps.length, 2, `${page.file}: the previous and the next week`);
    assert.match(steps[0].text, /href=\{nav\.prevHref\}/, page.file);
    assert.match(steps[1].text, /href=\{nav\.nextHref\}/, page.file);
    for (const step of steps) {
      assert.match(step.text, page.fallback, `${page.file}: ${step.text}`);
      // The RDV page keeps its scroll position across weeks, as before.
      assert.equal(/scroll=\{false\}/.test(step.text), page.scroll, `${page.file}: ${step.text}`);
    }
    for (const button of openingTags(text, "Button")) {
      assert.doesNotMatch(button.topLevel, /\sdisabled\b/, `${page.file}: ${button.text}`);
    }
  }
  const planning = source("src/components/public/public-planning.tsx");
  assert.match(planning, /const shownHref = view === "semaine" \? nav\.weekHref : nav\.listHref;/, "the shown week in the shown view");
});
