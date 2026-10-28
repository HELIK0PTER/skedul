import assert from "node:assert/strict";

import { eq } from "drizzle-orm";

import { ownedCustomerId } from "@/lib/back-office/guest-access";
import { revokeLinks } from "@/lib/booking/wallet";
import * as schema from "@/lib/db/schema";
import { guestLinkKey, signGuestLink } from "@/lib/guest-link";
import { createTestPro, dbTest, deleteTestUser, testEmail, type Db, type TestPro } from "@/test/db";
import { makeCustomer } from "@/test/fixtures";
import { createTestClientUser, sessionOf } from "@/test/public";

import { customerEmailOf, linkCustomerUser, resolveVisitor, type WalletOwner } from "./identity";

const KEY = guestLinkKey("test-secret");
const noCookie = { guestToken: undefined, key: KEY } as const;
const target = (pro: TestPro) => ({ professionalId: pro.proId, ownerUserId: pro.userId });
const tokenOf = (customerId: string, linkVersion = 1) => signGuestLink({ customerId, linkVersion }, KEY);

/** Client users for the duration of `fn`, deleted after it (the harness only deletes the pro's user). */
async function withClientUsers<T>(
  db: Db,
  specs: { email: string; verified: boolean }[],
  fn: (users: { userId: string; email: string }[]) => Promise<T>,
): Promise<T> {
  const users: { userId: string; email: string }[] = [];
  try {
    for (const spec of specs) {
      const { userId } = await createTestClientUser(db, spec);
      users.push({ userId, email: spec.email });
    }
    return await fn(users);
  } finally {
    for (const u of users) await deleteTestUser(db, u.userId);
  }
}

async function customerRow(db: Db, customerId: string) {
  const [row] = await db
    .select({ userId: schema.customer.userId, updatedAt: schema.customer.updatedAt })
    .from(schema.customer)
    .where(eq(schema.customer.id, customerId));
  return row;
}

dbTest("ownedCustomerId (S5): the session e-mail's customer when unlinked or linked to the session user, never another user's row nor another pro's", async ({ db, pro }) => {
  const email = testEmail("owned");
  const customerId = await makeCustomer(db, pro, { email });
  const other = await createTestPro(db);
  try {
    await withClientUsers(db, [{ email, verified: true }, { email: testEmail("rival"), verified: true }], async ([me, rival]) => {
      // unlinked row; the address matches with case and spaces ignored
      assert.equal(await ownedCustomerId(db, pro.proId, { userId: me.userId, email: ` ${email.toUpperCase()} ` }), customerId);

      // linked to the session user
      await db.update(schema.customer).set({ userId: me.userId }).where(eq(schema.customer.id, customerId));
      assert.equal(await ownedCustomerId(db, pro.proId, { userId: me.userId, email }), customerId);

      // linked to another user: not hers
      await db.update(schema.customer).set({ userId: rival.userId }).where(eq(schema.customer.id, customerId));
      assert.equal(await ownedCustomerId(db, pro.proId, { userId: me.userId, email }), null);

      // another address at this pro
      assert.equal(await ownedCustomerId(db, pro.proId, { userId: me.userId, email: testEmail("nobody") }), null);

      // another pro's page has no row for this address (S6); its own row for the address is its own
      assert.equal(await ownedCustomerId(db, other.proId, { userId: me.userId, email }), null);
      const theirs = await makeCustomer(db, other, { email });
      assert.equal(await ownedCustomerId(db, other.proId, { userId: me.userId, email }), theirs);
    });
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("resolveVisitor: a signed-out visitor is anonymous; a valid cookie names its customer of THIS pro at its current link_version only (S9)", async ({ db, pro }) => {
  const customerId = await makeCustomer(db, pro);
  const other = await createTestPro(db);
  try {
    const theirs = await makeCustomer(db, other);
    const bare = await resolveVisitor(db, { session: null, ...noCookie }, target(pro));
    assert.deepEqual(bare, { state: "anonymous", email: null, name: null, isPageOwner: false, owner: null, guestCustomerId: null });

    const withCookie = await resolveVisitor(db, { session: null, guestToken: tokenOf(customerId), key: KEY }, target(pro));
    assert.deepEqual(withCookie, { ...bare, guestCustomerId: customerId });

    // the cookie of another pro's customer is worthless here, and a garbage cookie is no cookie
    assert.equal((await resolveVisitor(db, { session: null, guestToken: tokenOf(theirs), key: KEY }, target(pro))).guestCustomerId, null);
    assert.equal((await resolveVisitor(db, { session: null, guestToken: tokenOf(customerId), key: KEY }, target(other))).guestCustomerId, null);
    for (const garbage of ["", "not-a-token", `${tokenOf(customerId)}x`, "a".repeat(300)]) {
      assert.equal((await resolveVisitor(db, { session: null, guestToken: garbage, key: KEY }, target(pro))).guestCustomerId, null, garbage.slice(0, 12));
    }

    // a revoked link dies at once
    const stale = tokenOf(customerId);
    const revoked = await revokeLinks(db, { professionalId: pro.proId, customerId });
    assert.ok(revoked.ok, JSON.stringify(revoked));
    assert.equal((await resolveVisitor(db, { session: null, guestToken: stale, key: KEY }, target(pro))).guestCustomerId, null);
    assert.equal((await resolveVisitor(db, { session: null, guestToken: tokenOf(customerId, 2), key: KEY }, target(pro))).guestCustomerId, customerId);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("resolveVisitor: a verified session with a record is the Owner of THAT pro only; the cookie is ignored; nothing is written (L1370)", async ({ db, pro }) => {
  const email = testEmail("owner");
  const customerId = await makeCustomer(db, pro, { email, name: "Beatriz Almeida" });
  const strangerCustomer = await makeCustomer(db, pro);
  const other = await createTestPro(db);
  try {
    await withClientUsers(db, [{ email, verified: true }], async ([me]) => {
      const session = sessionOf(me);
      const before = await customerRow(db, customerId);

      // a valid cookie of ANOTHER customer of the same pro does not matter: a verified session wins
      const visitor = await resolveVisitor(db, { session, guestToken: tokenOf(strangerCustomer), key: KEY }, target(pro));
      assert.deepEqual(visitor, {
        state: "verified",
        email,
        name: session.name,
        isPageOwner: false,
        owner: { professionalId: pro.proId, customerId, userId: me.userId, email },
        guestCustomerId: null,
      });

      // a render never links the account: only an action core does (linkCustomerUser), after its validation and throttle
      const after = await customerRow(db, customerId);
      assert.equal(after.userId, null);
      assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());

      // the same visitor at a pro who has no record of the address: no owner (S6)
      const elsewhere = await resolveVisitor(db, { session, ...noCookie }, target(other));
      assert.equal(elsewhere.state, "verified");
      assert.equal(elsewhere.owner, null);
      assert.equal(elsewhere.guestCustomerId, null);
    });
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("resolveVisitor: a verified session without a usable record has no owner and no guest customer, even with a valid cookie (S5)", async ({ db, pro }) => {
  const email = testEmail("norecord");
  const linkedEmail = testEmail("linked");
  const cookieCustomer = await makeCustomer(db, pro);
  const linkedCustomer = await makeCustomer(db, pro, { email: linkedEmail });
  await withClientUsers(db, [{ email, verified: true }, { email: linkedEmail, verified: true }, { email: testEmail("rival"), verified: true }], async ([me, mine, rival]) => {
    // no row at all for the address
    const none = await resolveVisitor(db, { session: sessionOf(me), guestToken: tokenOf(cookieCustomer), key: KEY }, target(pro));
    assert.equal(none.state, "verified");
    assert.equal(none.owner, null);
    assert.equal(none.guestCustomerId, null);
    assert.equal(none.email, email);

    // a row for the address that is linked to another user: not hers (Decision 5)
    await db.update(schema.customer).set({ userId: rival.userId }).where(eq(schema.customer.id, linkedCustomer));
    const linked = await resolveVisitor(db, { session: sessionOf(mine), ...noCookie }, target(pro));
    assert.equal(linked.owner, null);

    // linked to herself: the Owner
    await db.update(schema.customer).set({ userId: mine.userId }).where(eq(schema.customer.id, linkedCustomer));
    const own = await resolveVisitor(db, { session: sessionOf(mine), ...noCookie }, target(pro));
    assert.equal(own.owner?.customerId, linkedCustomer);
  });
});

dbTest("resolveVisitor: an unverified session is never an Owner; the cookie's customer is still reported (the banner; read and cancel, never spend)", async ({ db, pro }) => {
  const email = testEmail("unverified");
  const customerId = await makeCustomer(db, pro, { email });
  await withClientUsers(db, [{ email, verified: false }], async ([me]) => {
    const session = sessionOf(me, { verified: false });
    const bare = await resolveVisitor(db, { session, ...noCookie }, target(pro));
    assert.deepEqual(bare, { state: "unverified", email, name: session.name, isPageOwner: false, owner: null, guestCustomerId: null });
    const withCookie = await resolveVisitor(db, { session, guestToken: tokenOf(customerId), key: KEY }, target(pro));
    assert.equal(withCookie.owner, null, "the typed-address customer of an unverified session is not hers");
    assert.equal(withCookie.guestCustomerId, customerId);
  });
});

dbTest("resolveVisitor (S2, S42): an impersonated session has no owner, no guest customer and no identity, with a valid cookie and a matching customer", async ({ db, pro }) => {
  const email = testEmail("impersonated");
  const customerId = await makeCustomer(db, pro, { email });
  const cookie = { guestToken: tokenOf(customerId), key: KEY };
  for (const verified of [true, false]) {
    // an admin impersonating the pro: the session user is the pro's own user
    const session = sessionOf({ userId: pro.userId, email }, { verified, impersonated: true });
    const visitor = await resolveVisitor(db, { session, ...cookie }, target(pro));
    assert.deepEqual(visitor, {
      state: "impersonating",
      email: null,
      name: null,
      isPageOwner: true,
      owner: null,
      guestCustomerId: null,
    });
  }
});

dbTest("resolveVisitor: isPageOwner is true only for the session of the pro's own user", async ({ db, pro }) => {
  const proEmail = testEmail("proowner");
  const own = await resolveVisitor(db, { session: sessionOf({ userId: pro.userId, email: proEmail }), ...noCookie }, target(pro));
  assert.equal(own.isPageOwner, true);
  assert.equal(own.state, "verified");
  assert.equal(own.owner, null, "no customer row for the pro's address here");

  const other = await resolveVisitor(db, { session: sessionOf({ userId: "u-someone", email: testEmail("visitor") }), ...noCookie }, target(pro));
  assert.equal(other.isPageOwner, false);
  const signedOut = await resolveVisitor(db, { session: null, ...noCookie }, target(pro));
  assert.equal(signedOut.isPageOwner, false);
});

dbTest("linkCustomerUser fills a null user_id of the owner's own row, once, and never replaces, relinks or crosses pros", async ({ db, pro }) => {
  const other = await createTestPro(db);
  try {
    const email = testEmail("link");
    const rivalEmail = testEmail("rivalrow");
    const unverifiedEmail = testEmail("unverifiedrow");
    const customerId = await makeCustomer(db, pro, { email });
    const rivalRow = await makeCustomer(db, pro, { email: rivalEmail });
    const unverifiedRow = await makeCustomer(db, pro, { email: unverifiedEmail });
    const theirs = await makeCustomer(db, other, { email });
    await withClientUsers(
      db,
      [{ email, verified: true }, { email: rivalEmail, verified: true }, { email: unverifiedEmail, verified: false }],
      async ([me, rival, unverified]) => {
        const now = new Date();
        const owner: WalletOwner = { professionalId: pro.proId, customerId, userId: me.userId, email };

        // another pro's id in the owner: the customer is not that pro's, nothing is written anywhere
        await linkCustomerUser(db, { ...owner, professionalId: other.proId }, now);
        assert.equal((await customerRow(db, customerId)).userId, null);
        assert.equal((await customerRow(db, theirs)).userId, null);

        // an unverified account of the address links nothing (defence in depth: the caller checks it first)
        await linkCustomerUser(db, { professionalId: pro.proId, customerId: unverifiedRow, userId: unverified.userId, email: unverifiedEmail }, now);
        assert.equal((await customerRow(db, unverifiedRow)).userId, null);

        // her own row: filled
        await linkCustomerUser(db, owner, now);
        const linked = await customerRow(db, customerId);
        assert.equal(linked.userId, me.userId);
        assert.equal(linked.updatedAt.getTime(), now.getTime());

        // a row already linked to someone else is never taken over, even by a verified account of the same address
        await db.update(schema.customer).set({ userId: me.userId }).where(eq(schema.customer.id, rivalRow));
        await linkCustomerUser(db, { professionalId: pro.proId, customerId: rivalRow, userId: rival.userId, email: rivalEmail }, now);
        assert.equal((await customerRow(db, rivalRow)).userId, me.userId);

        // idempotent: a second call changes nothing, not even updated_at
        await linkCustomerUser(db, owner, new Date(now.getTime() + 60_000));
        assert.equal((await customerRow(db, customerId)).updatedAt.getTime(), now.getTime());
      },
    );
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("customerEmailOf: the e-mail of THIS pro's customer; another pro's customer or an unknown id gives null (S6)", async ({ db, pro }) => {
  const email = testEmail("emailof");
  const customerId = await makeCustomer(db, pro, { email });
  const other = await createTestPro(db);
  try {
    const theirs = await makeCustomer(db, other);
    assert.equal(await customerEmailOf(db, pro.proId, customerId), email);
    assert.equal(await customerEmailOf(db, pro.proId, theirs), null);
    assert.equal(await customerEmailOf(db, other.proId, customerId), null);
    assert.equal(await customerEmailOf(db, pro.proId, "unknown-customer"), null);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});
