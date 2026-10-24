import assert from "node:assert/strict";
import test from "node:test";

import { IP_HASH_RE } from "@/lib/throttle";
import { keyPaths, privateKeyPaths } from "@/test/key-paths";
import { actionVisitorOf, fakeCheckout, publicDepsOf, sessionOf } from "@/test/public";

import { SLUG_PARAM_RE, publicPageProfileOfRow, publicProOfRow, splitActionInput } from "./context";

const ROW = {
  id: "pro_1",
  slug: "altinha-paris",
  businessName: "Altinha Paris",
  timezone: "Europe/Paris",
  currency: "eur",
  userId: "owner_1",
  bookingHorizonDays: 60,
  minNoticeMinutes: 90,
  cancelDeadlineHours: 12,
};

/** The columns of the professional row the public page renders (profile-reads PUBLIC_PROFILE_COLUMNS). */
const PROFILE_ROW = {
  ...ROW,
  headline: "Cours collectifs de futevolei",
  bio: "Bienvenue sur la page.\nÀ bientôt.",
  brandColor: "#0f766e",
  bannerUrl: "https://blob.test/banner.png",
  headerLayout: "vitrine",
  avatarKind: "initiales",
  avatarStyle: "ocean",
  avatarSeed: "seed-1",
  avatarUrl: null,
};

test("publicProOfRow maps the row to the pro the cores use and keeps nothing else of it", () => {
  assert.deepEqual(publicProOfRow(ROW), {
    professionalId: "pro_1",
    slug: "altinha-paris",
    businessName: "Altinha Paris",
    timezone: "Europe/Paris",
    currency: "eur",
    ownerUserId: "owner_1",
    window: { bookingHorizonDays: 60, minNoticeMinutes: 90, cancelDeadlineHours: 12 },
  });
  const wide = { ...ROW, stripeAccountId: "acct_1", googleCalendarId: "cal_1", bio: "Bio" };
  const pro = publicProOfRow(wide);
  for (const key of ["stripeAccountId", "googleCalendarId", "bio", "id", "userId"]) {
    assert.equal(key in pro, false, `${key} must not be carried over`);
  }
});

test("publicPageProfileOfRow (G4a): the page holds the pro, the branding and the bio, with exactly these keys", () => {
  const profile = publicPageProfileOfRow(PROFILE_ROW);
  assert.deepEqual(profile, {
    pro: publicProOfRow(ROW),
    branding: {
      businessName: "Altinha Paris",
      headline: "Cours collectifs de futevolei",
      brandColor: "#0f766e",
      bannerUrl: "https://blob.test/banner.png",
      headerLayout: "vitrine",
      avatarKind: "initiales",
      avatarStyle: "ocean",
      avatarSeed: "seed-1",
      avatarUrl: null,
    },
    bio: "Bienvenue sur la page.\nÀ bientôt.",
  });
  // The one id of the professional's user the page keeps is the owner detection one, inside `pro` (never sent to the browser).
  assert.deepEqual(keyPaths(profile), [
    "bio",
    "branding",
    "branding.avatarKind",
    "branding.avatarSeed",
    "branding.avatarStyle",
    "branding.avatarUrl",
    "branding.bannerUrl",
    "branding.brandColor",
    "branding.businessName",
    "branding.headerLayout",
    "branding.headline",
    "pro",
    "pro.businessName",
    "pro.currency",
    "pro.ownerUserId",
    "pro.professionalId",
    "pro.slug",
    "pro.timezone",
    "pro.window",
    "pro.window.bookingHorizonDays",
    "pro.window.cancelDeadlineHours",
    "pro.window.minNoticeMinutes",
  ]);
});

test("publicPageProfileOfRow (G4a): nothing private of a wide professional row is carried over, whatever the row holds", () => {
  const wide = {
    ...PROFILE_ROW,
    stripeAccountId: "acct_1",
    googleCalendarId: "cal_1",
    themePreset: "violet",
    customColor: "#123456",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
  };
  const profile = publicPageProfileOfRow(wide);
  assert.deepEqual(keyPaths(profile), keyPaths(publicPageProfileOfRow(PROFILE_ROW)), "a wider row gives the same keys");
  const paths = keyPaths(profile);
  for (const forbidden of ["userId", "stripeAccountId", "googleCalendarId", "themePreset", "customColor", "createdAt", "updatedAt", "id"]) {
    assert.equal(paths.some((p) => p === forbidden || p.endsWith(`.${forbidden}`)), false, `${forbidden} must not be a key of the page profile`);
  }
  assert.deepEqual(
    privateKeyPaths(profile),
    ["pro.ownerUserId", "pro.professionalId"],
    "the only private-looking keys are the owner detection id and the pro id the cores need, both inside `pro`",
  );
  const text = JSON.stringify(profile);
  for (const secret of ["acct_1", "cal_1", "#123456", "2026-01-01"]) assert.equal(text.includes(secret), false, secret);
});

test("SLUG_PARAM_RE accepts a pro address and refuses anything else (no path, no case, no dot, 60 characters at most)", () => {
  for (const ok of ["altinha-paris", "a", "a-1", "0", "-", "a".repeat(60)]) assert.match(ok, SLUG_PARAM_RE, ok);
  for (const bad of ["../x", "A", "Altinha", "a".repeat(61), "", "a b", "a/b", "a.b", "é", "_a", "a_b", "a\n", "a?b", "//evil"]) {
    assert.doesNotMatch(bad, SLUG_PARAM_RE, JSON.stringify(bad));
  }
});

test("splitActionInput (S43): an object gives its slug and the rest without slug; the input is not modified", () => {
  const input = { slug: "altinha-paris", occurrenceId: "occ_1", identity: { name: "B", email: "b@example.com" } };
  const split = splitActionInput(input);
  assert.equal(split.slug, "altinha-paris");
  assert.deepEqual(split.rest, { occurrenceId: "occ_1", identity: { name: "B", email: "b@example.com" } });
  assert.equal("slug" in (split.rest as object), false);
  assert.equal(input.slug, "altinha-paris", "the caller's object keeps its slug");
  assert.notEqual(split.rest, input, "rest is a new object");

  // no slug key: slug undefined (the wrapper then answers PAGE_GONE), the rest is the whole object
  assert.deepEqual(splitActionInput({ occurrenceId: "occ_1" }), { slug: undefined, rest: { occurrenceId: "occ_1" } });
  // a slug that is not a string is passed on as it is: the wrapper refuses it
  assert.deepEqual(splitActionInput({ slug: ["a"], x: 1 }), { slug: ["a"], rest: { x: 1 } });
  // a null-prototype object is plain
  const bare = Object.assign(Object.create(null) as Record<string, unknown>, { slug: "s", y: 2 });
  assert.deepEqual(splitActionInput(bare), { slug: "s", rest: { y: 2 } });
});

test("splitActionInput (S43): anything that is not a plain object is passed whole with an undefined slug", () => {
  class Custom {
    slug = "altinha-paris";
  }
  const date = new Date(0);
  const map = new Map([["slug", "altinha-paris"]]);
  const custom = new Custom();
  const array = ["altinha-paris"];
  for (const input of [null, undefined, "altinha-paris", 42, true, array, date, map, custom]) {
    const split = splitActionInput(input);
    assert.equal(split.slug, undefined);
    assert.equal(split.rest, input, "the same value, for the core's strict schema to refuse");
  }
});

test("test helpers: actionVisitorOf, fakeCheckout and publicDepsOf behave as the DB tests of Tasks 9 to 14 expect", async () => {
  const visitor = actionVisitorOf();
  assert.equal(visitor.session, null);
  assert.equal(visitor.owner, null);
  assert.equal(visitor.guestCustomerId, null);
  assert.equal(visitor.wideIpHash, null);
  assert.match(visitor.ipHash, IP_HASH_RE);
  assert.notEqual(actionVisitorOf().ipHash, visitor.ipHash, "a fresh ipHash each call");
  const signedIn = actionVisitorOf({ session: sessionOf({ userId: "u1", email: "a@example.com" }), guestCustomerId: "c1" });
  assert.equal(signedIn.session?.userId, "u1");
  assert.equal(signedIn.guestCustomerId, "c1");

  const checkout = fakeCheckout();
  assert.equal(checkout.mode, "test");
  assert.equal(fakeCheckout("mock").mode, "mock");
  const req = {
    kind: "buybook" as const,
    purchaseId: "pur_1",
    amountCents: 8500,
    currency: "eur",
    productName: "Carnet de 4",
    customerEmail: "a@example.com",
    successUrl: "https://app.test/s/merci?p=pur_1",
    cancelUrl: "https://app.test/s/seance/o?paiement=annule&p=pur_1",
    expiresAt: new Date("2026-10-21T10:31:00Z"),
    env: "test",
  };
  assert.deepEqual(await checkout.create(req), { sessionId: "cs_test_fake_pur_1", url: "https://checkout.test/pur_1" });
  assert.deepEqual(checkout.created, [req]);

  const order: string[] = [];
  checkout.onCreate = async (r) => {
    order.push(`hook ${r.purchaseId}`);
  };
  const created = await checkout.create({ ...req, purchaseId: "pur_2" });
  order.push(`answer ${created.sessionId}`);
  assert.deepEqual(order, ["hook pur_2", "answer cs_test_fake_pur_2"], "the hook runs inside create, before it answers");

  checkout.failCreate = true;
  await assert.rejects(checkout.create({ ...req, purchaseId: "pur_3" }));
  assert.equal(checkout.created.length, 3, "a failing create is still recorded");

  assert.equal(await checkout.closeForRelease("cs_1"), "expired");
  checkout.closeOutcome = "paid";
  assert.equal(await checkout.closeForRelease("cs_2"), "paid");
  await checkout.expire("cs_3");
  assert.deepEqual(checkout.closed, ["cs_1", "cs_2"]);
  assert.deepEqual(checkout.expired, ["cs_3"]);

  assert.deepEqual(publicDepsOf(checkout), { appUrl: "https://app.test", checkout, mockAllowed: false, env: "test" });
  assert.deepEqual(publicDepsOf(checkout, { mockAllowed: true, appUrl: "http://localhost:3102", env: "preview" }), {
    appUrl: "http://localhost:3102",
    checkout,
    mockAllowed: true,
    env: "preview",
  });
});
