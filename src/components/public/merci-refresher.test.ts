/**
 * Wiring guard for src/components/public/merci-refresher.tsx (P4 Task 30). The component is a client component that
 * imports next/navigation, which the node:test runner cannot load, so the rules it must keep are pinned on its source.
 * Run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE = readFileSync("src/components/public/merci-refresher.tsx", "utf8");

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

test("while active it reads the page again every 3 seconds, 20 times at most, and cleans its timer up", () => {
  assert.match(SOURCE, /^"use client";/);
  assert.match(SOURCE, /const REFRESH_EVERY_MS = 3000;/);
  assert.match(SOURCE, /const REFRESH_MAX = 20;/);
  assert.match(SOURCE, /if \(!active\) return;/);
  assert.match(SOURCE, /setInterval\(/);
  assert.match(SOURCE, /if \(count >= REFRESH_MAX\) \{\s*clearInterval\(timer\);\s*setSpent\(true\);\s*\}/);
  assert.match(SOURCE, /return \(\) => clearInterval\(timer\);/);
  assert.match(SOURCE, /\[active, router\]/);
});

test("it only refreshes the router: a periodic read, never a navigation, a fetch or an action", () => {
  assert.equal(SOURCE.split("router.refresh()").length - 1, 1);
  assert.doesNotMatch(SOURCE, /router\.(push|replace)|fetch\(|@\/server\/|window\.location/);
  assert.doesNotMatch(SOURCE, /console\./);
});

test("it gives up with the contract's sentence in an always-mounted status line", () => {
  assert.match(SOURCE, /const GIVE_UP_TEXT = "La confirmation vous sera envoyée par email\.";/);
  assert.match(SOURCE, /<p role="status" className=\{active && spent \? "[^"]*" : "sr-only"\}>/);
  assert.match(SOURCE, /\{active && spent \? GIVE_UP_TEXT : ""\}/);
});

test("no dash and no brand-coloured text", () => {
  assert.doesNotMatch(SOURCE, DASH);
  assert.doesNotMatch(SOURCE, /text-primary([^-a-zA-Z]|$)/);
});
