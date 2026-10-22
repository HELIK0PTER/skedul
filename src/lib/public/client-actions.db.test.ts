import assert from "node:assert/strict";

import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db/atomic";
import * as schema from "@/lib/db/schema";
import { revokeMyLinksCore, updateMyNameCore } from "@/lib/public/client-actions";
import { COPY } from "@/lib/public/messages";
import type { PublicCoreResult } from "@/lib/public/result";
import { createTestPro, dbTest, deleteTestUser, testEmail } from "@/test/db";
import { createTestClientUser, sessionOf } from "@/test/public";
import { rowCustomer } from "@/test/rows";

async function userNameOf(db: Db, userId: string): Promise<string> {
  const [row] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId));
  assert.ok(row, `user ${userId}`);
  return row.name;
}

async function customerNameOf(db: Db, customerId: string): Promise<string> {
  const [row] = await db.select({ name: schema.customer.name }).from(schema.customer).where(eq(schema.customer.id, customerId));
  assert.ok(row, `customer ${customerId}`);
  return row.name;
}

async function linkVersionOf(db: Db, customerId: string): Promise<number> {
  const [row] = await db.select({ v: schema.customer.linkVersion }).from(schema.customer).where(eq(schema.customer.id, customerId));
  assert.ok(row, `customer ${customerId}`);
  return row.v;
}

function errorOf(res: PublicCoreResult<object>): string {
  assert.equal(res.ok, false, JSON.stringify(res));
  return res.ok ? "" : res.error;
}

dbTest("updateMyNameCore: renames the user and every row linked to her, and nothing else", async ({ db, pro }) => {
  const now = new Date();
  const second = await createTestPro(db);
  const third = await createTestPro(db);
  const email = testEmail("me");
  const me = await createTestClientUser(db, { email, name: "Ancien nom", verified: true });
  const stranger = await createTestClientUser(db, { email: testEmail("stranger"), name: "Autre compte", verified: true });
  try {
    const linkedHere = await rowCustomer(db, pro, { email, name: "Ancien nom", userId: me.userId });
    const linkedThere = await rowCustomer(db, second, { email, name: "Ancien nom", userId: me.userId });
    // The same address at a third pro, but nothing links it to her: anonymous history is never rewritten.
    const unlinked = await rowCustomer(db, third, { email, name: "Ancien nom", userId: null });
    // Another account's row at the first pro, and another pro's other client.
    const ofStranger = await rowCustomer(db, pro, { name: "Ancien nom", userId: stranger.userId });
    const ofSecondPro = await rowCustomer(db, second, { name: "Ancien nom", userId: null });

    const res = await updateMyNameCore(db, sessionOf({ userId: me.userId, email, name: "Ancien nom" }, { verified: true }), { name: "  Beatriz Almeida  " }, now);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(res.effects, []);

    assert.equal(await userNameOf(db, me.userId), "Beatriz Almeida", "trimmed, on the user");
    assert.equal(await customerNameOf(db, linkedHere), "Beatriz Almeida");
    assert.equal(await customerNameOf(db, linkedThere), "Beatriz Almeida", "her row at another pro is hers too");
    assert.equal(await customerNameOf(db, unlinked), "Ancien nom", "an unlinked row of the same address is left alone");
    assert.equal(await customerNameOf(db, ofStranger), "Ancien nom", "another account's row");
    assert.equal(await customerNameOf(db, ofSecondPro), "Ancien nom", "another client of another pro");
    assert.equal(await userNameOf(db, stranger.userId), "Autre compte", "another account");
  } finally {
    await deleteTestUser(db, second.userId);
    await deleteTestUser(db, third.userId);
    await deleteTestUser(db, stranger.userId);
    await deleteTestUser(db, me.userId);
  }
});

dbTest("account actions refuse a stranger before parsing or reading anything: no session, unverified, impersonated (S27)", async ({ db, pro }) => {
  const now = new Date();
  const email = testEmail("me");
  const me = await createTestClientUser(db, { email, name: "Ancien nom", verified: false });
  try {
    const linked = await rowCustomer(db, pro, { email, name: "Ancien nom", userId: me.userId });
    const who = { userId: me.userId, email, name: "Ancien nom" };
    const strangers = [
      ["no session", null],
      ["unverified", sessionOf(who, { verified: false })],
      ["impersonated", sessionOf(who, { verified: true, impersonated: true })],
    ] as const;
    for (const [label, session] of strangers) {
      // A valid input and a malformed one get the same answer: nothing is parsed for a stranger.
      for (const input of [{ name: "Beatriz" }, { name: "Beatriz", extra: 1 }, null]) {
        assert.equal(errorOf(await updateMyNameCore(db, session, input, now)), COPY.SIGNED_IN_ONLY, `${label} ${JSON.stringify(input)}`);
      }
      assert.equal(errorOf(await revokeMyLinksCore(db, session, now)), COPY.SIGNED_IN_ONLY, label);
    }
    assert.equal(await userNameOf(db, me.userId), "Ancien nom");
    assert.equal(await customerNameOf(db, linked), "Ancien nom");
    assert.equal(await linkVersionOf(db, linked), 1);
  } finally {
    await deleteTestUser(db, me.userId);
  }
});

dbTest("updateMyNameCore: French validation, a name with a link, an address or a long digit run is refused, nothing is written (S43, S44)", async ({ db, pro }) => {
  const now = new Date();
  const email = testEmail("me");
  const me = await createTestClientUser(db, { email, name: "Ancien nom", verified: true });
  try {
    const linked = await rowCustomer(db, pro, { email, name: "Ancien nom", userId: me.userId });
    const session = sessionOf({ userId: me.userId, email, name: "Ancien nom" }, { verified: true });

    const cases: [unknown, string][] = [
      [{ name: "" }, "Nom : ce champ est obligatoire."],
      [{ name: "   " }, "Nom : ce champ est obligatoire."],
      [{ name: "x".repeat(81) }, "Nom : 80 caractères au maximum."],
      [{ name: 42 }, "Nom : ce champ est obligatoire."],
      [{}, "Nom : ce champ est obligatoire."],
      [{ name: "Léa", extra: 1 }, "Champ inattendu."],
      [{ name: "Léa", identity: null, website: ["x"] }, "Champ inattendu."],
      [null, "Valeur invalide."],
      ["Léa", "Valeur invalide."],
      [["Léa"], "Valeur invalide."],
    ];
    for (const [input, expected] of cases) {
      assert.equal(errorOf(await updateMyNameCore(db, session, input, now)), expected, JSON.stringify(input));
    }

    for (const phishing of ["appelez le 0612345678", "appelez le 06 12 34 56 78", "voir www.exemple.fr", "voir bit.ly/x", "écrivez à lea@exemple.fr", "https://exemple.fr/promo"]) {
      const res = await updateMyNameCore(db, session, { name: phishing }, now);
      assert.equal(errorOf(res), COPY.PLAIN_NAME, phishing);
      assert.equal(res.ok === false && res.fieldErrors?.name, COPY.PLAIN_NAME, `${phishing}: under the field`);
    }

    assert.equal(await userNameOf(db, me.userId), "Ancien nom");
    assert.equal(await customerNameOf(db, linked), "Ancien nom");
  } finally {
    await deleteTestUser(db, me.userId);
  }
});

dbTest("revokeMyLinksCore: bumps link_version on the rows of the getMySpace predicate, and only those (S27)", async ({ db, pro }) => {
  const now = new Date();
  const second = await createTestPro(db);
  const third = await createTestPro(db);
  const fourth = await createTestPro(db);
  const suspended = await createTestPro(db);
  const email = testEmail("me");
  const me = await createTestClientUser(db, { email, name: "Beatriz", verified: true });
  const stranger = await createTestClientUser(db, { email: testEmail("stranger"), name: "Autre compte", verified: true });
  try {
    await db.update(schema.user).set({ banned: true, banExpires: null }).where(eq(schema.user.id, suspended.userId));
    const linked = await rowCustomer(db, pro, { email, userId: me.userId });
    const unlinked = await rowCustomer(db, third, { email, userId: null });
    // A pro that is suspended today: its link is dead now and must stay dead when the pro comes back.
    const ofSuspended = await rowCustomer(db, suspended, { email, userId: me.userId });
    // The same address, but linked to another account at the fourth pro: not hers (Decision 5), cross-tenant.
    const linkedToStranger = await rowCustomer(db, fourth, { email, userId: stranger.userId });
    // Another client of the second pro and of the first one.
    const neighbour = await rowCustomer(db, second, { userId: null });
    const neighbourHere = await rowCustomer(db, pro, { userId: null });

    const res = await revokeMyLinksCore(db, sessionOf({ userId: me.userId, email, name: "Beatriz" }, { verified: true }), now);
    assert.equal(res.ok && res.customers, 3, JSON.stringify(res));
    assert.deepEqual(res.effects, []);

    assert.equal(await linkVersionOf(db, linked), 2, "linked to her");
    assert.equal(await linkVersionOf(db, unlinked), 2, "her address, no link yet");
    assert.equal(await linkVersionOf(db, ofSuspended), 2, "a suspended pro's row is revoked too");
    assert.equal(await linkVersionOf(db, linkedToStranger), 1, "linked to another account");
    assert.equal(await linkVersionOf(db, neighbour), 1, "another client of another pro");
    assert.equal(await linkVersionOf(db, neighbourHere), 1, "another client of the same pro");

    // A second call cuts the new links again: the count is the same, the versions go one further.
    const again = await revokeMyLinksCore(db, sessionOf({ userId: me.userId, email, name: "Beatriz" }, { verified: true }), now);
    assert.equal(again.ok && again.customers, 3);
    assert.equal(await linkVersionOf(db, linked), 3);
    assert.equal(await linkVersionOf(db, linkedToStranger), 1);
  } finally {
    for (const p of [second, third, fourth, suspended]) await deleteTestUser(db, p.userId);
    await deleteTestUser(db, stranger.userId);
    await deleteTestUser(db, me.userId);
  }
});
