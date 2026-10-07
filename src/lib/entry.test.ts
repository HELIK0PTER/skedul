import test from "node:test";
import assert from "node:assert/strict";

import { entryPath, parseEntryChoice, resolveEntry } from "./entry";

test("resolveEntry sends non-admins to /dashboard, whatever the cookie says", () => {
  assert.equal(resolveEntry({ isAdmin: false, remembered: null }), "/dashboard");
  assert.equal(resolveEntry({ isAdmin: false, remembered: "admin" }), "/dashboard");
});

test("resolveEntry asks an admin to choose when nothing is remembered", () => {
  assert.equal(resolveEntry({ isAdmin: true, remembered: null }), "choose");
});

test("resolveEntry follows an admin's remembered choice", () => {
  assert.equal(resolveEntry({ isAdmin: true, remembered: "admin" }), "/admin");
  assert.equal(resolveEntry({ isAdmin: true, remembered: "client" }), "/dashboard");
});

test("parseEntryChoice accepts only admin or client", () => {
  assert.equal(parseEntryChoice("admin"), "admin");
  assert.equal(parseEntryChoice("client"), "client");
  for (const bad of ["", "root", "ADMIN", undefined, null]) {
    assert.equal(parseEntryChoice(bad), null);
  }
});

test("entryPath maps each choice to its dashboard", () => {
  assert.equal(entryPath("admin"), "/admin");
  assert.equal(entryPath("client"), "/dashboard");
});
