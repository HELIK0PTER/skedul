import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cancelPathOf } from "@/lib/payments/checkout";
import { holdStorageKey, readHoldId } from "@/lib/public/buy-and-book-form";

import { rdvHoldStorageKey, rdvReturnHref, readRdvHoldId, storeRdvHoldId } from "./rdv-form";

const START = "2027-01-20T09:00:00.000Z";

/** A Storage-shaped fake that keeps its entries in a map. */
function fakeStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => void map.set(key, value),
    map,
  };
}

test("rdvHoldStorageKey: skedul:hold:rdv:<type>:<start ISO>, one key per slot of one type, never a séance key", () => {
  assert.equal(rdvHoldStorageKey("tt_1", START), "skedul:hold:rdv:tt_1:2027-01-20T09:00:00.000Z");
  assert.notEqual(rdvHoldStorageKey("tt_1", START), rdvHoldStorageKey("tt_2", START), "another type");
  assert.notEqual(rdvHoldStorageKey("tt_1", START), rdvHoldStorageKey("tt_1", "2027-01-20T10:00:00.000Z"), "another slot");
  // A séance key is skedul:hold:<occurrenceId> and a nanoid has no colon: the two families never meet.
  assert.notEqual(rdvHoldStorageKey("tt_1", START), holdStorageKey("rdv"));
  assert.equal(rdvHoldStorageKey("tt_1", START).startsWith(holdStorageKey("rdv:")), true);
});

test("the RDV hold id round-trips through a storage, keyed by the type and the start", () => {
  const storage = fakeStorage();
  storeRdvHoldId(storage, "tt_1", START, "pur_Abc-123");
  assert.equal(storage.map.get("skedul:hold:rdv:tt_1:2027-01-20T09:00:00.000Z"), "pur_Abc-123");
  assert.equal(readRdvHoldId(storage, "tt_1", START), "pur_Abc-123");
  assert.equal(readRdvHoldId(storage, "tt_2", START), null, "another type has no entry");
  assert.equal(readRdvHoldId(storage, "tt_1", "2027-01-20T10:00:00.000Z"), null, "another slot has no entry");
  assert.equal(readHoldId(storage, "tt_1"), null, "the séance reader never sees an RDV entry");
});

test("a stored or offered id that does not look like one of our purchase ids is never used (HOLD_ID_RE)", () => {
  const key = rdvHoldStorageKey("tt_1", START);
  for (const bad of ["", "a b", "a/b", "../x", "<script>", "é", "x".repeat(65), "https://evil.test"]) {
    assert.equal(readRdvHoldId(fakeStorage({ [key]: bad }), "tt_1", START), null, JSON.stringify(bad));
    const storage = fakeStorage();
    storeRdvHoldId(storage, "tt_1", START, bad);
    assert.equal(storage.map.size, 0, `nothing stored for ${JSON.stringify(bad)}`);
  }
  assert.equal(readRdvHoldId(fakeStorage({ [key]: "x".repeat(64) }), "tt_1", START), "x".repeat(64));
});

test("a missing or throwing storage never throws (private window, blocked site data)", () => {
  assert.equal(readRdvHoldId(null, "tt_1", START), null);
  assert.doesNotThrow(() => storeRdvHoldId(null, "tt_1", START, "pur_1"));
  const throwing = {
    getItem: (): string | null => {
      throw new Error("denied");
    },
    setItem: (): void => {
      throw new Error("denied");
    },
  };
  assert.equal(readRdvHoldId(throwing, "tt_1", START), null);
  assert.doesNotThrow(() => storeRdvHoldId(throwing, "tt_1", START, "pur_1"));
});

test("rdvReturnHref: the RDV type page with the buyer's own reference, the same path as the Checkout cancel URL", () => {
  assert.equal(rdvReturnHref("altinha-paris", "tt_1", "pur_1"), "/altinha-paris/rdv/tt_1?paiement=annule&p=pur_1");
  assert.equal(rdvReturnHref("altinha-paris", "tt_1", "a/b"), "/altinha-paris/rdv/tt_1?paiement=annule&p=a%2Fb");
  for (const [slug, ticketTypeId, purchaseId] of [
    ["altinha-paris", "tt_1", "pur_1"],
    ["a b", "../tt?x=1#y", "p&next=/admin"],
  ] as const) {
    assert.equal(
      rdvReturnHref(slug, ticketTypeId, purchaseId),
      cancelPathOf({ kind: "rdv", slug, ticketTypeId, purchaseId }),
      "one path for the cancel URL and the resume link",
    );
  }
  const url = new URL(rdvReturnHref("altinha-paris", "x y&redirect=https://evil.test", "p1"), "https://app.test");
  assert.equal(url.origin, "https://app.test", "a relative path: it stays on the app");
  assert.deepEqual([...url.searchParams.keys()], ["paiement", "p"]);
});

test("rdv-form.ts is client safe: no server module, no database, no env", () => {
  const source = readFileSync("src/lib/public/rdv-form.ts", "utf8");
  assert.doesNotMatch(source, /server-only|from "next\/|@\/lib\/db|@\/lib\/env|@\/lib\/session|drizzle-orm/);
});
