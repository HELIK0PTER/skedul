import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { professional, user } from "@/lib/db/schema";
import { createTestPro, dbTest, deleteTestUser } from "@/test/db";
import { keyPaths } from "@/test/key-paths";

import { readPublicProfile } from "./profile-reads";

/** Every key of the public projection, in alphabetical order (a column added to the select is a deliberate change here). */
const PUBLIC_KEYS = [
  "avatarKind",
  "avatarSeed",
  "avatarStyle",
  "avatarUrl",
  "bannerUrl",
  "bio",
  "bookingHorizonDays",
  "brandColor",
  "businessName",
  "cancelDeadlineHours",
  "currency",
  "headerLayout",
  "headline",
  "id",
  "minNoticeMinutes",
  "slug",
  "timezone",
  "userId",
];

dbTest("readPublicProfile returns the public projection of the pro of the slug, without the Stripe account, the Google calendar or the theme", async ({ db, pro }) => {
  await db
    .update(professional)
    .set({
      headline: "Cours collectifs",
      bio: "Bienvenue.",
      brandColor: "#0f766e",
      stripeAccountId: "acct_test_private",
      googleCalendarId: "calendar-private@group.calendar.google.com",
      themePreset: "ocean",
      customColor: "#123456",
      bookingHorizonDays: 45,
      minNoticeMinutes: 120,
      cancelDeadlineHours: 12,
    })
    .where(eq(professional.id, pro.proId));

  const row = await readPublicProfile(db, pro.slug);
  assert.ok(row);
  assert.deepEqual(keyPaths(row), PUBLIC_KEYS, "exactly the columns the public page renders or needs");
  assert.equal(row.id, pro.proId);
  assert.equal(row.userId, pro.userId, "the user id stays on the server side row: ownerUserId is built from it");
  assert.equal(row.slug, pro.slug);
  assert.deepEqual(
    [row.headline, row.bio, row.brandColor, row.bookingHorizonDays, row.minNoticeMinutes, row.cancelDeadlineHours],
    ["Cours collectifs", "Bienvenue.", "#0f766e", 45, 120, 12],
  );
  const text = JSON.stringify(row);
  for (const secret of ["acct_test_private", "calendar-private", "ocean", "#123456"]) {
    assert.equal(text.includes(secret), false, `${secret} is never read by the public profile`);
  }
});

dbTest("readPublicProfile: an unknown slug is null, and a slug is the pro it names, not another's", async ({ db, pro }) => {
  const other = await createTestPro(db);
  try {
    assert.equal(await readPublicProfile(db, `${pro.slug}-nope`), null);
    assert.equal((await readPublicProfile(db, other.slug))?.id, other.proId);
    assert.equal((await readPublicProfile(db, pro.slug))?.id, pro.proId);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("readPublicProfile: a suspended pro is offline, unless the caller asks for it (the thank-you page)", async ({ db, pro }) => {
  assert.ok(await readPublicProfile(db, pro.slug));
  await db.update(user).set({ banned: true, banExpires: null }).where(eq(user.id, pro.userId));
  assert.equal(await readPublicProfile(db, pro.slug), null);
  assert.equal(await readPublicProfile(db, pro.slug, {}), null);
  assert.equal(await readPublicProfile(db, pro.slug, { includeSuspended: false }), null);
  const kept = await readPublicProfile(db, pro.slug, { includeSuspended: true });
  assert.equal(kept?.id, pro.proId);
  assert.deepEqual(keyPaths(kept), PUBLIC_KEYS, "the thank-you page gets the same projection");

  // A ban that has run out counts as lifted.
  await db.update(user).set({ banned: true, banExpires: new Date(Date.now() - 60_000) }).where(eq(user.id, pro.userId));
  assert.equal((await readPublicProfile(db, pro.slug))?.id, pro.proId);
});
