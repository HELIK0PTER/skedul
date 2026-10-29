/**
 * The admin user search's input schema and the rows it sends to the browser (P6 A4). Pure: run with
 * `tsx --test src/lib/admin-users.test.ts`.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { USER_SEARCH_MAX, USERS_PAGE_SIZE } from "@/lib/admin-params";
import { suspensionLabel, toAdminUserPage, userSearchSchema } from "@/lib/admin-users";
import { parseFr } from "@/lib/zod-fr";

test("userSearchSchema: a trimmed term up to USER_SEARCH_MAX, a known filter, a page from 1 to 10 000, nothing else", () => {
  const ok = parseFr(userSearchSchema, { q: "  Ana  ", filter: "pro", page: 2 });
  assert.deepEqual(ok, { ok: true, data: { q: "Ana", filter: "pro", page: 2 } });
  assert.equal(parseFr(userSearchSchema, { q: "", filter: "all", page: 1 }).ok, true, "an empty term lists the filter");
  assert.equal(parseFr(userSearchSchema, { q: "a".repeat(USER_SEARCH_MAX), filter: "all", page: 1 }).ok, true);
  for (const bad of [
    { q: "a".repeat(USER_SEARCH_MAX + 1), filter: "all", page: 1 },
    { q: "a", filter: "everyone", page: 1 },
    { q: "a", filter: "all", page: 0 },
    { q: "a", filter: "all", page: 10_001 },
    { q: "a", filter: "all", page: 1.5 },
    { q: "a", filter: "all", page: "2" },
    { q: 3, filter: "all", page: 1 },
    { q: "a", filter: "all", page: 1, userId: "someone" },
    null,
  ]) {
    assert.equal(parseFr(userSearchSchema, bad).ok, false, JSON.stringify(bad));
  }
});

test("suspensionLabel: null while active or once the ban has ended, « Suspendu » without an end, the end date in Paris", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  assert.equal(suspensionLabel({ banned: false, banExpires: null }, now), null);
  assert.equal(suspensionLabel({ banned: null, banExpires: null }, now), null);
  assert.equal(suspensionLabel({ banned: true, banExpires: new Date("2026-10-29T11:59:59Z") }, now), null, "a ban that ended");
  assert.equal(suspensionLabel({ banned: true, banExpires: null }, now), "Suspendu");
  // 23:30 UTC on the 31st is already the 1st of November in Paris.
  assert.equal(suspensionLabel({ banned: true, banExpires: new Date("2026-10-31T23:30:00Z") }, now), "Suspendu jusqu'au 1er nov. 2026");
});

test("toAdminUserPage: formatted labels only (no Date, no ban field), « Jamais » without a sign-in, the page count of the total", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  const res = {
    rows: [
      {
        id: "u1",
        name: "Ana",
        email: "ana@skedul.test",
        role: "pro" as const,
        createdAt: new Date("2026-01-07T10:00:00Z"),
        lastLoginAt: null,
        banned: true,
        banExpires: null,
        slug: "ana",
      },
      {
        id: "u2",
        name: "Bo",
        email: "bo@skedul.test",
        role: "client" as const,
        createdAt: new Date("2026-02-01T10:00:00Z"),
        lastLoginAt: new Date("2026-10-28T22:30:00Z"),
        banned: false,
        banExpires: null,
        slug: null,
      },
    ],
    total: USERS_PAGE_SIZE + 1,
  };
  assert.deepEqual(toAdminUserPage(res, 2, now), {
    rows: [
      { id: "u1", name: "Ana", email: "ana@skedul.test", role: "pro", slug: "ana", createdLabel: "7 janv. 2026", lastLoginLabel: "Jamais", status: "Suspendu" },
      { id: "u2", name: "Bo", email: "bo@skedul.test", role: "client", slug: null, createdLabel: "1er févr. 2026", lastLoginLabel: "28 oct. 2026", status: null },
    ],
    total: USERS_PAGE_SIZE + 1,
    page: 2,
    pageCount: 2,
  });
  assert.equal(toAdminUserPage({ rows: [], total: 0 }, 1, now).pageCount, 1, "an empty list still has one page");
});
