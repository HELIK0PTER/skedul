import assert from "node:assert/strict";

import { eq } from "drizzle-orm";

import {
  customerFromGuestCookie,
  customerFromVerifiedEmail,
  findGuestCustomer,
  resolveGuestLink,
  resolveSpaceIdentity,
} from "@/lib/back-office/guest-access";
import { revokeLinks } from "@/lib/booking/wallet";
import * as schema from "@/lib/db/schema";
import { guestLinkKey, signGuestLink } from "@/lib/guest-link";
import { addMinutes, createTestPro, dbTest, deleteTestUser, testEmail } from "@/test/db";
import { makeCustomer } from "@/test/fixtures";

const KEY = guestLinkKey("test-secret");

dbTest("findGuestCustomer: the customer, its pro's slug, its link version and the suspension flag", async ({ db, pro }) => {
  const customerId = await makeCustomer(db, pro);
  assert.deepEqual(await findGuestCustomer(db, customerId), {
    customerId,
    linkVersion: 1,
    slug: pro.slug,
    proSuspended: false,
  });

  await db.update(schema.user).set({ banned: true, banExpires: null }).where(eq(schema.user.id, pro.userId));
  assert.equal((await findGuestCustomer(db, customerId))?.proSuspended, true);

  // A ban whose date has passed counts as lifted, like the pro's public page.
  await db
    .update(schema.user)
    .set({ banned: true, banExpires: addMinutes(new Date(), -5) })
    .where(eq(schema.user.id, pro.userId));
  assert.equal((await findGuestCustomer(db, customerId))?.proSuspended, false);

  await revokeLinks(db, { professionalId: pro.proId, customerId });
  assert.equal((await findGuestCustomer(db, customerId))?.linkVersion, 2);
  assert.equal(await findGuestCustomer(db, "unknown-customer"), null);
});

dbTest("customerFromGuestCookie: a valid token gives the customer, anything else gives null", async ({ db, pro }) => {
  const customerId = await makeCustomer(db, pro);
  const token = signGuestLink({ customerId, linkVersion: 1 }, KEY);

  assert.equal(await customerFromGuestCookie(db, pro.proId, token, KEY), customerId);
  assert.equal(await customerFromGuestCookie(db, pro.proId, undefined, KEY), null);
  assert.equal(await customerFromGuestCookie(db, pro.proId, "", KEY), null);
  assert.equal(await customerFromGuestCookie(db, pro.proId, "not-a-token", KEY), null);

  // Tampered (last character changed) or signed with another key.
  const last = token.slice(-1) === "A" ? "B" : "A";
  assert.equal(await customerFromGuestCookie(db, pro.proId, token.slice(0, -1) + last, KEY), null);
  assert.equal(await customerFromGuestCookie(db, pro.proId, signGuestLink({ customerId, linkVersion: 1 }, guestLinkKey("another")), KEY), null);

  // A well-formed token for a customer that does not exist.
  assert.equal(await customerFromGuestCookie(db, pro.proId, signGuestLink({ customerId: "ghost", linkVersion: 1 }, KEY), KEY), null);

  // A version the customer never had (link made for a later version).
  assert.equal(await customerFromGuestCookie(db, pro.proId, signGuestLink({ customerId, linkVersion: 2 }, KEY), KEY), null);
});

dbTest("customerFromGuestCookie: a revoked link stops working, the new version works", async ({ db, pro }) => {
  const customerId = await makeCustomer(db, pro);
  const oldToken = signGuestLink({ customerId, linkVersion: 1 }, KEY);
  assert.equal(await customerFromGuestCookie(db, pro.proId, oldToken, KEY), customerId);

  const revoked = await revokeLinks(db, { professionalId: pro.proId, customerId });
  assert.ok(revoked.ok, JSON.stringify(revoked));
  assert.equal(revoked.linkVersion, 2);
  assert.equal(await customerFromGuestCookie(db, pro.proId, oldToken, KEY), null);
  assert.equal(await customerFromGuestCookie(db, pro.proId, signGuestLink({ customerId, linkVersion: 2 }, KEY), KEY), customerId);
});

dbTest("customerFromGuestCookie: a valid token never opens another pro's space", async ({ db, pro }) => {
  const mine = await makeCustomer(db, pro);
  const other = await createTestPro(db);
  try {
    const theirs = await makeCustomer(db, other);
    const myToken = signGuestLink({ customerId: mine, linkVersion: 1 }, KEY);
    const theirToken = signGuestLink({ customerId: theirs, linkVersion: 1 }, KEY);

    assert.equal(await customerFromGuestCookie(db, other.proId, myToken, KEY), null);
    assert.equal(await customerFromGuestCookie(db, pro.proId, theirToken, KEY), null);
    assert.equal(await customerFromGuestCookie(db, other.proId, theirToken, KEY), theirs);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("customerFromVerifiedEmail: the pro's customer with that e-mail, case and spaces ignored, never another pro's", async ({ db, pro }) => {
  const email = testEmail("space");
  const customerId = await makeCustomer(db, pro, { email });
  assert.equal(await customerFromVerifiedEmail(db, pro.proId, email), customerId);
  assert.equal(await customerFromVerifiedEmail(db, pro.proId, `  ${email.toUpperCase()} `), customerId);
  assert.equal(await customerFromVerifiedEmail(db, pro.proId, testEmail("nobody")), null);

  const other = await createTestPro(db);
  try {
    assert.equal(await customerFromVerifiedEmail(db, other.proId, email), null);
    const theirs = await makeCustomer(db, other, { email });
    assert.equal(await customerFromVerifiedEmail(db, other.proId, email), theirs);
    assert.equal(await customerFromVerifiedEmail(db, pro.proId, email), customerId);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

/* ─────────────────────── resolveGuestLink: the decision of /api/c/<token> ─────────────────────── */

dbTest("resolveGuestLink: a valid link is ok and targets the slug of the customer's own pro", async ({ db, pro }) => {
  const customerId = await makeCustomer(db, pro);
  const other = await createTestPro(db);
  try {
    const theirs = await makeCustomer(db, other);
    assert.deepEqual(await resolveGuestLink(db, signGuestLink({ customerId, linkVersion: 1 }, KEY), KEY), {
      kind: "ok",
      slug: pro.slug,
      customerId,
    });
    // The slug always comes from the customer's row: a link of the other pro's customer lands on the other pro's page.
    assert.deepEqual(await resolveGuestLink(db, signGuestLink({ customerId: theirs, linkVersion: 1 }, KEY), KEY), {
      kind: "ok",
      slug: other.slug,
      customerId: theirs,
    });
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("resolveGuestLink: a link revoked by « Déconnecter ses liens » is stale, the new one is ok", async ({ db, pro }) => {
  const customerId = await makeCustomer(db, pro);
  const oldToken = signGuestLink({ customerId, linkVersion: 1 }, KEY);
  assert.equal((await resolveGuestLink(db, oldToken, KEY)).kind, "ok");

  const revoked = await revokeLinks(db, { professionalId: pro.proId, customerId });
  assert.ok(revoked.ok, JSON.stringify(revoked));
  assert.deepEqual(await resolveGuestLink(db, oldToken, KEY), { kind: "stale", slug: pro.slug });
  assert.deepEqual(await resolveGuestLink(db, signGuestLink({ customerId, linkVersion: 2 }, KEY), KEY), {
    kind: "ok",
    slug: pro.slug,
    customerId,
  });
  // A version from the future (never issued) is not ok either.
  assert.deepEqual(await resolveGuestLink(db, signGuestLink({ customerId, linkVersion: 3 }, KEY), KEY), {
    kind: "stale",
    slug: pro.slug,
  });
});

dbTest("resolveGuestLink: a tampered, foreign-key, malformed, overlong or ghost token is not found", async ({ db, pro }) => {
  const customerId = await makeCustomer(db, pro);
  const token = signGuestLink({ customerId, linkVersion: 1 }, KEY);
  const notFound = { kind: "not_found" };

  const last = token.slice(-1) === "A" ? "B" : "A";
  assert.deepEqual(await resolveGuestLink(db, token.slice(0, -1) + last, KEY), notFound, "tampered MAC");
  // Another customer id / version under the original MAC.
  const [id, version, mac] = token.split(".");
  assert.deepEqual(await resolveGuestLink(db, `${id}x.${version}.${mac}`, KEY), notFound, "tampered id");
  assert.deepEqual(await resolveGuestLink(db, `${id}.2.${mac}`, KEY), notFound, "tampered version");
  assert.deepEqual(await resolveGuestLink(db, signGuestLink({ customerId, linkVersion: 1 }, guestLinkKey("another")), KEY), notFound, "other key");
  assert.deepEqual(await resolveGuestLink(db, signGuestLink({ customerId: "ghost", linkVersion: 1 }, KEY), KEY), notFound, "signed but unknown customer");
  assert.deepEqual(await resolveGuestLink(db, "garbage", KEY), notFound);
  assert.deepEqual(await resolveGuestLink(db, "", KEY), notFound);
  assert.deepEqual(await resolveGuestLink(db, "a".repeat(300), KEY), notFound, "overlong");
  assert.deepEqual(await resolveGuestLink(db, `${token}${"a".repeat(200)}`, KEY), notFound, "valid prefix, overlong");
});

dbTest("resolveGuestLink: a suspended pro's links are not found, valid or stale, until the ban lifts", async ({ db, pro }) => {
  const customerId = await makeCustomer(db, pro);
  const current = signGuestLink({ customerId, linkVersion: 1 }, KEY);
  await db.update(schema.user).set({ banned: true, banExpires: null }).where(eq(schema.user.id, pro.userId));
  assert.deepEqual(await resolveGuestLink(db, current, KEY), { kind: "not_found" });

  await revokeLinks(db, { professionalId: pro.proId, customerId });
  assert.deepEqual(await resolveGuestLink(db, current, KEY), { kind: "not_found" }, "stale and suspended answers like unknown");

  await db.update(schema.user).set({ banned: false, banExpires: null }).where(eq(schema.user.id, pro.userId));
  assert.equal((await resolveGuestLink(db, current, KEY)).kind, "stale");
});

dbTest("resolveGuestLink: a slug that is not a plain address segment is never redirected to", async ({ db, pro }) => {
  const customerId = await makeCustomer(db, pro);
  const token = signGuestLink({ customerId, linkVersion: 1 }, KEY);
  await db.update(schema.professional).set({ slug: "//evil.example" }).where(eq(schema.professional.id, pro.proId));
  assert.deepEqual(await resolveGuestLink(db, token, KEY), { kind: "not_found" });
});

/* ─────────────────────── resolveSpaceIdentity: who looks at the espace ─────────────────────── */

const noGuest = { guestToken: undefined, key: KEY } as const;

dbTest("resolveSpaceIdentity: a verified session gives the customer of this pro by e-mail, or no_record", async ({ db, pro }) => {
  const email = testEmail("session");
  const customerId = await makeCustomer(db, pro, { email });

  assert.deepEqual(
    await resolveSpaceIdentity(db, pro.proId, { ...noGuest, session: { email: ` ${email.toUpperCase()}`, emailVerified: true, impersonated: false } }),
    { kind: "customer", customerId, via: "session" },
  );
  const stranger = testEmail("stranger");
  assert.deepEqual(
    await resolveSpaceIdentity(db, pro.proId, { ...noGuest, session: { email: stranger, emailVerified: true, impersonated: false } }),
    { kind: "no_record", email: stranger },
  );
});

dbTest("resolveSpaceIdentity: an UNVERIFIED session never reads a wallet, even with the customer's e-mail", async ({ db, pro }) => {
  const email = testEmail("unverified");
  const customerId = await makeCustomer(db, pro, { email });
  const session = { email, emailVerified: false, impersonated: false };

  assert.deepEqual(await resolveSpaceIdentity(db, pro.proId, { ...noGuest, session }), { kind: "anonymous" });

  // Only the personal link of that customer opens the space for them.
  const token = signGuestLink({ customerId, linkVersion: 1 }, KEY);
  assert.deepEqual(await resolveSpaceIdentity(db, pro.proId, { session, guestToken: token, key: KEY }), {
    kind: "customer",
    customerId,
    via: "guest",
  });
});

dbTest("resolveSpaceIdentity: an impersonated session never reads client data through the pro's session", async ({ db, pro }) => {
  const email = testEmail("impersonated");
  const customerId = await makeCustomer(db, pro, { email });
  const session = { email, emailVerified: true, impersonated: true };
  assert.deepEqual(await resolveSpaceIdentity(db, pro.proId, { ...noGuest, session }), { kind: "anonymous" });
  const token = signGuestLink({ customerId, linkVersion: 1 }, KEY);
  assert.deepEqual(await resolveSpaceIdentity(db, pro.proId, { session, guestToken: token, key: KEY }), {
    kind: "customer",
    customerId,
    via: "guest",
  });
});

dbTest("resolveSpaceIdentity: the verified session wins over the cookie; without a session the cookie works", async ({ db, pro }) => {
  const mine = await makeCustomer(db, pro, { email: testEmail("a") });
  const sessionEmail = testEmail("b");
  const sessionCustomer = await makeCustomer(db, pro, { email: sessionEmail });
  const token = signGuestLink({ customerId: mine, linkVersion: 1 }, KEY);

  assert.deepEqual(
    await resolveSpaceIdentity(db, pro.proId, { session: { email: sessionEmail, emailVerified: true, impersonated: false }, guestToken: token, key: KEY }),
    { kind: "customer", customerId: sessionCustomer, via: "session" },
  );
  assert.deepEqual(await resolveSpaceIdentity(db, pro.proId, { session: null, guestToken: token, key: KEY }), {
    kind: "customer",
    customerId: mine,
    via: "guest",
  });
  assert.deepEqual(await resolveSpaceIdentity(db, pro.proId, { session: null, guestToken: undefined, key: KEY }), { kind: "anonymous" });
});

dbTest("resolveSpaceIdentity: a revoked, tampered or other pro's cookie is anonymous", async ({ db, pro }) => {
  const customerId = await makeCustomer(db, pro);
  const token = signGuestLink({ customerId, linkVersion: 1 }, KEY);
  const other = await createTestPro(db);
  try {
    const theirs = await makeCustomer(db, other);
    const theirToken = signGuestLink({ customerId: theirs, linkVersion: 1 }, KEY);
    const anonymous = { kind: "anonymous" };

    assert.equal((await resolveSpaceIdentity(db, pro.proId, { session: null, guestToken: token, key: KEY })).kind, "customer");
    // The cookie of the other pro's customer is worthless on this pro's page, and the reverse.
    assert.deepEqual(await resolveSpaceIdentity(db, pro.proId, { session: null, guestToken: theirToken, key: KEY }), anonymous);
    assert.deepEqual(await resolveSpaceIdentity(db, other.proId, { session: null, guestToken: token, key: KEY }), anonymous);
    // Tampered.
    const last = token.slice(-1) === "A" ? "B" : "A";
    assert.deepEqual(await resolveSpaceIdentity(db, pro.proId, { session: null, guestToken: token.slice(0, -1) + last, key: KEY }), anonymous);
    // Revoked: the cookie dies at once, with no request to /api/c.
    await revokeLinks(db, { professionalId: pro.proId, customerId });
    assert.deepEqual(await resolveSpaceIdentity(db, pro.proId, { session: null, guestToken: token, key: KEY }), anonymous);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});
