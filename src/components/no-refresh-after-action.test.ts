/**
 * P6 A34: a router.refresh() queued after a Server Action risks a stale view and the Next 16.2.9 push-plus-refresh hang.
 * The actions revalidate the pages they change themselves: revalidatePath, or a cookie write, which makes Next re-render
 * the current route in the same round trip (node_modules/next/dist/docs, cookies.md « Understanding Cookie Behavior in
 * Server Functions »). The refreshes left follow an auth client call, where no Server Action runs and nothing is
 * revalidated, or poll a payment. Pinned on the source: node:test cannot load client components. Run from the
 * repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bodyOf, codeView, sourceFilesUnder } from "../test/source-guards";

/** Each file that may still call router.refresh(), and why it is not after a Server Action. */
const ALLOWED: Record<string, string> = {
  "src/components/sign-out-button.tsx": "after authClient signOut, which clears the session cookie in the browser",
  "src/components/auth/auth-form.tsx": "after an authClient sign-in or sign-up",
  "src/components/auth/demo-quick-login.tsx": "after an authClient sign-in",
  "src/components/auth/email-code-form.tsx": "after an authClient code sign-in (code-sign-in-guards.test.ts pins it)",
  "src/components/dashboard/verify-email-banner.tsx": "after authClient verifyEmail and a fresh getSession",
  "src/components/public/merci-refresher.tsx": "polls the merci page while the payment lands (merci-refresher.test.ts)",
};

const read = (path: string): string => readFileSync(path, "utf8");

test("router.refresh() is called only where no Server Action revalidates the page (P6 A34)", () => {
  const calling = sourceFilesUnder("src")
    .filter((file) => /\brouter\s*\.\s*refresh\s*\(/.test(codeView(read(file))))
    .sort();
  assert.deepEqual(calling, Object.keys(ALLOWED).sort());
});

test("the actions whose callers lost their refresh revalidate what they change (P6 A34)", () => {
  // Google Agenda card of /dashboard/settings: the action revalidates the settings page.
  const pro = read("src/server/pro.ts");
  const disconnect = bodyOf(pro, "disconnectGoogleCalendar");
  assert.match(disconnect, /await clearGoogleLink\(db, pro\.id\);(?:\s*\/\/[^\n]*)*\s*revalidatePath\("\/dashboard\/settings"\);\s*return \{ ok: true \};/);
  // « Oublier mon choix » of the admin sidebar: deleting the cookie re-renders the current route and its layouts.
  assert.match(bodyOf(read("src/server/entry.ts"), "forgetEntryChoice"), /\(await cookies\(\)\)\.delete\(ENTRY_COOKIE\);/);
  // The support, FAQ and user actions revalidate their pages on success (the helpers of their files).
  const supportAdmin = read("src/server/support-admin.ts");
  for (const name of ["adminReply", "setSupportStage", "acceptForDevelopment", "setSupportEta", "resolveSupportRequest", "reopenSupportRequest"]) {
    assert.match(bodyOf(supportAdmin, name), /\brefresh\((?:id|request\.id|input\.id)\);/, name);
  }
  for (const name of ["saveHelpCategory", "deleteHelpCategory", "moveHelpCategory", "saveHelpArticle", "deleteHelpArticle", "setHelpArticlePublished", "moveHelpArticle"]) {
    assert.match(bodyOf(supportAdmin, name), /\brefreshFaq\(\);/, name);
  }
  assert.match(bodyOf(read("src/server/support.ts"), "replyToSupportRequest"), /revalidatePath\(`\/aide\/demandes\/\$\{request\.id\}`\);/);
  const admin = read("src/server/admin.ts");
  for (const name of ["suspendUser", "reactivateUser", "signOutEverywhere", "setAdminRole"]) {
    assert.match(bodyOf(admin, name), /\brefresh\((?:target\.id|userId)\);/, name);
  }
});

test("the components that lost their refresh no longer import useRouter for it (P6 A34)", () => {
  for (const file of [
    "src/components/admin/admin-sidebar.tsx",
    "src/components/admin/support-admin-panel.tsx",
    "src/components/admin/support-faq-editor.tsx",
    "src/components/admin/dev-board-card.tsx",
    "src/components/admin/user-actions.tsx",
    "src/components/support/message-composer.tsx",
  ]) {
    assert.doesNotMatch(codeView(read(file)), /\buseRouter\b/, file);
  }
  // The Google card keeps useRouter for its router.replace after the OAuth return, a navigation and not a refresh.
  assert.match(read("src/components/dashboard/google-calendar-card.tsx"), /router\.replace\("\/dashboard\/settings"\);/);
});
