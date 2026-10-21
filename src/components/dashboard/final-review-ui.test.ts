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

test("the event delete confirmation keeps one dialog instance, gives « Retour » the focus when the preview is ready and returns it (final review UI-1)", () => {
  const card = source("src/components/dashboard/event-delete-card.tsx");
  assert.doesNotMatch(card, /<ConfirmDialog[^>]*\bkey=/, "no key remount: it dropped the focus on <body> when the dialog closed");
  assert.match(card, /returnFocusTo=\{returnFocus\}/, "the trigger that opened the dialog gets the focus back");
  assert.match(card, /ref=\{wholeButton\}/, "« Supprimer l'événement » is a focus target");
  assert.match(card, /ref=\{customButton\}/, "« Voir les conséquences » is a focus target");
  const confirm = source("src/components/dashboard/confirm-dialog.tsx");
  assert.match(confirm, /ref=\{back\}/, "« Retour » can be focused from the effect");
  assert.match(confirm, /if \(open && !pending\) focusBack\(\)/, "once nothing is awaited, « Retour » takes the focus");
  assert.match(confirm, /if \(!error\) back\.current\?\.focus\(\)/, "unless the action failed: the error text has it then");
  assert.match(confirm, /returnFocusTo=\{returnFocusTo\}/, "handed to the dialog");
  const dialog = source("src/components/ui/dialog.tsx");
  assert.match(dialog, /restoreTarget\(returnFocusTo\?\.\(\), opener\)/, "the dialog restores the focus through the pure rule");
});

test("catalog forms call their Server Actions through callOrFail, so a failed call shows a message (final review UI-4)", () => {
  const dir = "src/components/dashboard";
  const files = [
    "ticket-type-editor.tsx",
    "offer-list.tsx",
    "type-danger-zone.tsx",
    "new-ticket-type-button.tsx",
    "type-hours-editor.tsx",
    "profile-form.tsx",
  ];
  for (const file of files) {
    const text = source(`${dir}/${file}`);
    const imported = /import \{([^}]*)\} from "@\/server\/[\w-]+";/.exec(text);
    assert.ok(imported, `${file} imports its Server Actions`);
    const names = imported[1]
      .split(",")
      .map((n) => n.trim())
      .filter((n) => /^[a-z]\w+$/.test(n));
    assert.ok(names.length > 0, `${file}: some actions`);
    for (const name of names) {
      let seen = 0;
      for (let at = text.indexOf(`${name}(`); at !== -1; at = text.indexOf(`${name}(`, at + 1)) {
        const line = text.slice(text.lastIndexOf("\n", at) + 1, text.indexOf("\n", at));
        seen += 1;
        assert.match(text.slice(Math.max(0, at - 120), at), /callOrFail\(/, `${file}: ${name} outside callOrFail: ${line.trim()}`);
      }
      assert.ok(seen > 0, `${file} calls ${name}`);
    }
    assert.match(text, /callOrFail/, `${file} uses callOrFail`);
  }
});

test("the offer and RDV forms drop a field's message when it is edited and focus the problem after a refusal (final review UI-5)", () => {
  const dir = "src/components/dashboard";
  const offers = source(`${dir}/offer-list.tsx`);
  assert.match(offers, /errorAfterEdit\(current, OFFER_ERROR_FIELDS\[key\]\)/, "an offer edit clears its field's message");
  assert.match(offers, /useRefusalFocus\(\)/, "the offer dialog moves the focus after a refusal");
  assert.match(offers, /ref=\{errorBox\}/, "the general message can take the focus");
  const types = source(`${dir}/ticket-type-editor.tsx`);
  assert.match(types, /errorAfterEdit\(current, RDV_ERROR_FIELDS\[key\]\)/, "an RDV edit clears its field's message");
  assert.equal(types.match(/useRefusalFocus\(\)/g)?.length, 3, "the three forms of the type editor");
  assert.equal(types.match(/\brefused\(\);/g)?.length, 4, "every refusal (1 client side, 3 server side) moves the focus");
});

test("success lines live in an always-mounted status region, in green-700 (final review UI-3, UI-6)", () => {
  const dir = "src/components/dashboard";
  for (const file of ["profile-form.tsx", "ticket-type-editor.tsx", "type-hours-editor.tsx"]) {
    const text = source(`${dir}/${file}`);
    assert.match(text, /<SavedStatus\b/, `${file} uses the shared region`);
    assert.doesNotMatch(text, /\{saved && \(\s*<span role="status"/, `${file} no longer mounts its region with the text`);
  }
  assert.equal(source(`${dir}/ticket-type-editor.tsx`).match(/<SavedStatus\b/g)?.length, 3, "the three forms of the type editor");
  // the notices: the region is always there, only its content changes
  for (const file of ["offer-list.tsx", "type-danger-zone.tsx"]) {
    const text = source(`${dir}/${file}`);
    assert.doesNotMatch(text, /\{notice !== null && \(\s*<p role="status"/, `${file}: the notice region is not mounted with its text`);
    assert.match(text, /<p role="status" className=\{notice/, `${file}: an always-mounted notice region`);
  }
  // small success text is green-700: the success token (3.3:1 on white) is for fills and icons
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
    source(`${dir}/${file}`)
      .split("\n")
      .forEach((line, i) => {
        if (/(?<![-\w])text-success(?![-\w])/.test(line) && !/\bsize-\d+ shrink-0 text-success\b/.test(line)) {
          assert.fail(`${file}:${i + 1} writes text in text-success: ${line.trim()}`);
        }
      });
  }
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
