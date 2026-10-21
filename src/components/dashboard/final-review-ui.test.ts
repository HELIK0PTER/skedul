/**
 * Wiring guards for the final-review UI fixes. The components below are client or server components that import Server
 * Actions or the database, which the node:test runner cannot load, so what they must keep is pinned on their source
 * (the texts and rules they call have their own pure tests). Run from the repository root.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { INLINE_LINK_CLASS } from "@/components/ui/link-class";

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

test("« Indisponibilités » shows the pro's zone by its label, like « Disponibilités » (final review UI-15)", () => {
  const page = source("src/app/dashboard/unavailability/page.tsx");
  assert.match(page, /\(fuseau : \$\{timeZoneLabel\(tz\)\}\)/, "the zone label, not the raw IANA id");
  assert.doesNotMatch(page, /\(fuseau \$\{tz\}\)/, "no raw zone id in the description");
});

test("the branding preview shows the tickets vocabulary, not the v1 pack button (final review COV-8)", () => {
  const form = source("src/components/dashboard/branding-form.tsx");
  assert.doesNotMatch(form, /Pack 5 séances/, "the v1 « Pack 5 séances » button is gone");
  assert.match(form, />\s*Acheter des tickets\s*</, "the preview's second button speaks of tickets");
});

test("no dashboard text uses the raw brand colour, and the shared inline link is underlined (final review UI-2)", () => {
  const dir = "src/components/dashboard";
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
    source(`${dir}/${file}`)
      .split("\n")
      .forEach((line, i) => {
        // text-primary on small text is the pro's brand colour, 4.2:1 or less for a light preset; an icon (size-N) may keep it
        if (/(?<![-\w])text-primary(?![-\w/])/.test(line) && !/\bsize-\d+ text-primary\b/.test(line)) {
          assert.fail(`${file}:${i + 1} uses text-primary: ${line.trim()}`);
        }
      });
  }
  assert.match(INLINE_LINK_CLASS, /\btext-accent-foreground\b/, "the darkened brand text colour");
  assert.match(INLINE_LINK_CLASS, /\bunderline\b/, "a link is not told by its colour alone");
  const walletActions = source(`${dir}/wallet-actions.tsx`);
  assert.match(walletActions, /INLINE_LINK_CLASS/, "the wallet notes use the shared class");
  for (const file of ["event-editor.tsx", "register-attendee-dialog.tsx"]) {
    assert.match(source(`${dir}/${file}`), /INLINE_LINK_CLASS/, `${file} links use the shared class`);
  }
});
