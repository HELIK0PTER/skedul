import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { accountLink } from "@/lib/account-link";

test("a pro gets « Tableau de bord » to the dashboard, a signed-in user without a pro page « Mon espace » to the client space", () => {
  assert.deepEqual(accountLink({ signedIn: true, hasPro: true }), { href: "/dashboard", label: "Tableau de bord" });
  assert.deepEqual(accountLink({ signedIn: true, hasPro: false }), { href: "/mon-espace", label: "Mon espace" });
});

test("nobody signed out gets an account link, whatever a stale pro flag says", () => {
  assert.equal(accountLink({ signedIn: false, hasPro: false }), null);
  assert.equal(accountLink({ signedIn: false, hasPro: true }), null);
});

test("one label per place: the two links never share a label (« Mon espace » names /mon-espace only)", () => {
  const pro = accountLink({ signedIn: true, hasPro: true });
  const client = accountLink({ signedIn: true, hasPro: false });
  assert.ok(pro && client);
  assert.notEqual(pro.label, client.label);
  assert.notEqual(pro.href, client.href);
});

test("the site header takes its link from accountLink and spells no account label itself", () => {
  const header = readFileSync("src/components/site-header.tsx", "utf8");
  assert.match(header, /accountLink\(\{ signedIn: user !== null, hasPro: pro !== null \}\)/);
  assert.doesNotMatch(header, /"Mon espace"|"Tableau de bord"|"\/dashboard"|"\/onboarding"|"\/mon-espace"/);
});
