/**
 * Wiring guards for the final-review UI fixes. The components below are client or server components that import Server
 * Actions or the database, which the node:test runner cannot load, so what they must keep is pinned on their source
 * (the texts and rules they call have their own pure tests). Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string): string => readFileSync(path, "utf8");

test("the event page says its seats as « N inscrits sur M », not « N / M places » (final review UI-10)", () => {
  const page = source("src/app/dashboard/events/[id]/page.tsx");
  assert.match(page, /seatsText\(/, "the planning wording");
  assert.doesNotMatch(page, /\/ \$\{occurrence\.capacity\} places/, "the ambiguous « 3 / 12 places » is gone");
});

test("the dashboard week preview blocks carry the planning's accessible name (final review UI-11)", () => {
  const preview = source("src/components/dashboard/week-preview.tsx");
  assert.match(preview, /aria-label=\{blockLabel\(i, tz\)\}/, "day, time, title and seats in the name of each block");
  assert.doesNotMatch(preview, /sr-only">annulée/, "« annulée » is part of the name, not a hidden span beside it");
});

test("the mobile day chips name their séances and rendez-vous apart (final review UI-12)", () => {
  const calendar = source("src/components/dashboard/planning-calendar.tsx");
  assert.match(calendar, /dayCountText\(/, "the chip's name uses the counted words");
  assert.doesNotMatch(calendar, /plural\(count, "séance", "séances"\)/, "a rendez-vous is no longer counted as a séance");
});
