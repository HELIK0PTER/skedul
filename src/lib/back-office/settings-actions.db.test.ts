import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { addDaysMs, createTestPro, dbTest, deleteTestUser, testEmail, type Db, type TestPro } from "../../test/db";
import { giveTickets, makeCustomer, makeEvent, makeType } from "../../test/fixtures";
import { proCtx } from "../../test/pro-ctx";
import { rowBooking, rowEvent, rowRdv, rowRdvType, rowSeance } from "../../test/rows";
import { packSrc } from "../avatar-pack";
import { THEME_PRESETS } from "../color";
import { availabilityRule, occurrence, professional, timeOff, user } from "../db/schema";
import {
  AVATAR_REFUSED,
  BRANDING_IMAGE_REFUSED,
  PROFILE_NOT_CREATED,
  SLUG_TAKEN,
  createProfessionalProfileCore,
  isTimezoneLocked,
  updateBrandingCore,
  updateProfileCore,
  updateSlugCore,
  type BrandingInput,
  type ProfileInput,
} from "./settings-actions";

const OK = { ok: true, effects: [] } as const;
const LOCKED = {
  ok: false,
  code: "timezone_locked",
  error: "Fuseau verrouillé : vous avez des séances planifiées, des indisponibilités à venir ou des tickets à durée limitée.",
} as const;

const input = (over: Partial<ProfileInput> = {}): ProfileInput => ({
  businessName: "Studio Altinha",
  headline: "Capoeira et roda",
  bio: null,
  timezone: "Europe/Paris",
  ...over,
});

async function rowOf(db: Db, proId: string) {
  const [row] = await db.select().from(professional).where(eq(professional.id, proId));
  return row;
}

/** A scheduled RDV that is really booked (seats_taken 1 and its booking): a scheduled RDV with no seat would break invariant I5. */
async function bookedRdv(db: Db, pro: TestPro, typeId: string, startsAt: Date): Promise<string> {
  const rdvId = await rowRdv(db, pro, typeId, { startsAt });
  await rowBooking(db, pro, { occurrenceId: rdvId, customerId: await makeCustomer(db, pro) });
  return rdvId;
}

dbTest("updateProfileCore saves the profile and the time zone when nothing is planned", async ({ db, pro }) => {
  const now = new Date();
  const res = await updateProfileCore(
    db,
    proCtx(pro),
    input({ businessName: "  Studio Altinha  ", headline: " Capoeira ", bio: null, timezone: "Europe/Zurich" }),
    now,
  );
  assert.deepEqual(res, OK);
  const row = await rowOf(db, pro.proId);
  assert.deepEqual([row.businessName, row.headline, row.bio, row.timezone], ["Studio Altinha", "Capoeira", null, "Europe/Zurich"]);

  // empty text fields become null
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ headline: "", bio: "" }), now), OK);
  const emptied = await rowOf(db, pro.proId);
  assert.deepEqual([emptied.headline, emptied.bio], [null, null]);
});

dbTest("a live event locks the time zone: refused with the pro message, nothing written; the same zone still saves", async ({ db, pro }) => {
  const now = new Date();
  await makeEvent(db, pro);
  assert.equal(await isTimezoneLocked(db, pro.proId, now), true);

  const before = await rowOf(db, pro.proId);
  const refused = await updateProfileCore(db, proCtx(pro), input({ businessName: "Autre nom", timezone: "America/New_York" }), now);
  assert.deepEqual(refused, LOCKED);
  assert.deepEqual(await rowOf(db, pro.proId), before, "the whole update is refused, not only the zone");

  const sameZone = await updateProfileCore(db, proCtx(pro), input({ businessName: "Nouveau nom", timezone: "Europe/Paris" }), now);
  assert.deepEqual(sameZone, OK);
  const after = await rowOf(db, pro.proId);
  assert.deepEqual([after.businessName, after.timezone], ["Nouveau nom", "Europe/Paris"]);
});

dbTest("a future scheduled RDV alone locks the time zone; a past or a cancelled one does not", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await rowRdvType(db, pro);
  await bookedRdv(db, pro, typeId, addDaysMs(now, -2));
  await rowRdv(db, pro, typeId, { startsAt: addDaysMs(now, 2), status: "cancelled", seatsTaken: 0 });
  assert.equal(await isTimezoneLocked(db, pro.proId, now), false);
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ timezone: "Europe/Zurich" }), now), OK);

  await bookedRdv(db, pro, typeId, addDaysMs(now, 3));
  assert.equal(await isTimezoneLocked(db, pro.proId, now), true);
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ timezone: "Europe/London" }), now), LOCKED);
  assert.equal((await rowOf(db, pro.proId)).timezone, "Europe/Zurich");
});

dbTest("an archived event locks only through a future scheduled séance", async ({ db, pro }) => {
  const now = new Date();
  const eventId = await rowEvent(db, pro, { archivedAt: now });
  await rowSeance(db, pro, eventId, { startsAt: addDaysMs(now, -2) });
  assert.equal(await isTimezoneLocked(db, pro.proId, now), false, "archived, only a past séance");
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ timezone: "Europe/Zurich" }), now), OK);

  const future = await rowSeance(db, pro, eventId, { startsAt: addDaysMs(now, 2) });
  assert.equal(await isTimezoneLocked(db, pro.proId, now), true, "archived, but a future séance is still scheduled");
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ timezone: "America/New_York" }), now), LOCKED);

  await db.delete(occurrence).where(eq(occurrence.id, future));
  assert.equal(await isTimezoneLocked(db, pro.proId, now), false);
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ timezone: "America/New_York" }), now), OK);
  assert.equal((await rowOf(db, pro.proId)).timezone, "America/New_York");
});

dbTest("a future time off alone locks the time zone (its instants were computed in the old zone); a past one does not", async ({ db, pro }) => {
  const now = new Date();
  const timeOffAt = (startAt: Date, endAt: Date) =>
    db.insert(timeOff).values({ id: `to-${startAt.getTime()}`, professionalId: pro.proId, startAt, endAt, allDay: true, reason: null });

  await timeOffAt(addDaysMs(now, -5), addDaysMs(now, -3));
  assert.equal(await isTimezoneLocked(db, pro.proId, now), false, "a past time off");
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ timezone: "Europe/Zurich" }), now), OK);

  await timeOffAt(addDaysMs(now, 10), addDaysMs(now, 12));
  assert.equal(await isTimezoneLocked(db, pro.proId, now), true, "a time off to come");
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ timezone: "Europe/London" }), now), LOCKED);
  assert.equal((await rowOf(db, pro.proId)).timezone, "Europe/Zurich");

  assert.equal(await isTimezoneLocked(db, pro.proId, addDaysMs(now, 20)), false, "once it is over");

  // A time off in progress (it ends later) is still to come as far as the zone is concerned.
  await timeOffAt(addDaysMs(now, -1), addDaysMs(now, 1));
  assert.equal(await isTimezoneLocked(db, pro.proId, now), true);
});

dbTest("an available ticket with an expiry alone locks the time zone; no expiry, an expired one or another pro's do not", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const customerId = await makeCustomer(db, pro);

  await giveTickets(db, pro, customerId, typeId, 2);
  assert.equal(await isTimezoneLocked(db, pro.proId, now), false, "tickets without a limit");
  await giveTickets(db, pro, customerId, typeId, 1, { now: addDaysMs(now, -10), expiresAt: addDaysMs(now, -2) });
  assert.equal(await isTimezoneLocked(db, pro.proId, now), false, "an expired ticket");
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ timezone: "Europe/Zurich" }), now), OK);

  await giveTickets(db, pro, customerId, typeId, 1, { expiresAt: addDaysMs(now, 30) });
  assert.equal(await isTimezoneLocked(db, pro.proId, now), true, "its expiry is a local midnight of the old zone");
  assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ timezone: "Europe/London" }), now), LOCKED);
  assert.equal((await rowOf(db, pro.proId)).timezone, "Europe/Zurich");
  assert.equal(await isTimezoneLocked(db, pro.proId, addDaysMs(now, 40)), false, "once it has expired");

  const other = await createTestPro(db);
  try {
    assert.equal(await isTimezoneLocked(db, other.proId, now), false, "the ticket of one pro does not lock the other");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("validation speaks French and writes nothing", async ({ db, pro }) => {
  const now = new Date();
  const before = await rowOf(db, pro.proId);
  const cases: [Partial<ProfileInput>, string][] = [
    [{ timezone: "Europe/Geneva" }, "Fuseau horaire inconnu."],
    [{ timezone: "" }, "Fuseau horaire inconnu."],
    [{ businessName: "   " }, "Nom de l'activité : ce champ est obligatoire."],
    [{ headline: "x".repeat(161) }, "Accroche : 160 caractères au maximum."],
  ];
  for (const [over, error] of cases) {
    assert.deepEqual(await updateProfileCore(db, proCtx(pro), input(over), now), { ok: false, error }, error);
  }
  assert.deepEqual(await rowOf(db, pro.proId), before);
});

dbTest("the core touches only the acting pro, and the lock is per pro", async ({ db, pro }) => {
  const now = new Date();
  const other = await createTestPro(db);
  try {
    await makeEvent(db, pro);
    const otherBefore = await rowOf(db, other.proId);
    assert.deepEqual(await updateProfileCore(db, proCtx(pro), input({ businessName: "Moi", timezone: "Europe/Paris" }), now), OK);
    assert.deepEqual(await rowOf(db, other.proId), otherBefore, "the other pro is untouched");

    assert.equal(await isTimezoneLocked(db, pro.proId, now), true);
    assert.equal(await isTimezoneLocked(db, other.proId, now), false, "the event of one pro does not lock the other");
    assert.deepEqual(await updateProfileCore(db, proCtx(other), input({ timezone: "America/Montreal" }), now), OK);
    assert.equal((await rowOf(db, other.proId)).timezone, "America/Montreal");
    assert.equal((await rowOf(db, pro.proId)).timezone, "Europe/Paris");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

/* ───────────── Branding, public address and onboarding (P6 A5) ───────────── */

const HOST = "teststore.public.blob.vercel-storage.com";
const STORE = { blobHost: HOST };
const uploaded = (pro: TestPro, kind: "banner" | "avatar", ext = "webp") =>
  `https://${HOST}/branding/${pro.proId}/${kind}-${nanoid()}.${ext}`;
const branding = (over: Partial<BrandingInput> = {}): BrandingInput => ({
  themePreset: "violet",
  customColor: null,
  bannerUrl: null,
  headerLayout: "profil",
  avatarKind: null,
  avatarStyle: null,
  avatarSeed: null,
  avatarUrl: null,
  ...over,
});
const brandingOf = async (db: Db, proId: string) => {
  const r = await rowOf(db, proId);
  return {
    themePreset: r.themePreset,
    customColor: r.customColor,
    brandColor: r.brandColor,
    bannerUrl: r.bannerUrl,
    headerLayout: r.headerLayout,
    avatarKind: r.avatarKind,
    avatarStyle: r.avatarStyle,
    avatarSeed: r.avatarSeed,
    avatarUrl: r.avatarUrl,
  };
};

dbTest("updateBrandingCore stores the pro's own uploads, a pack avatar or a generated one, and resolves the brand color", async ({ db, pro }) => {
  const now = new Date();
  const banner = uploaded(pro, "banner");
  const avatar = uploaded(pro, "avatar", "png");
  const custom = branding({
    themePreset: "custom",
    customColor: " #12AB34 ",
    bannerUrl: banner,
    headerLayout: "vitrine",
    avatarKind: "upload",
    avatarUrl: avatar,
  });
  assert.deepEqual(await updateBrandingCore(db, proCtx(pro), custom, now, STORE), OK);
  assert.deepEqual(await brandingOf(db, pro.proId), {
    themePreset: "custom",
    customColor: "#12ab34",
    brandColor: "#12ab34",
    bannerUrl: banner,
    headerLayout: "vitrine",
    avatarKind: "upload",
    avatarStyle: null,
    avatarSeed: null,
    avatarUrl: avatar,
  });

  // A named preset keeps the custom color for later; the pack needs no Blob store.
  const preset = THEME_PRESETS[0];
  const pack = branding({ themePreset: preset.id, customColor: "not a color", avatarKind: "pack", avatarUrl: packSrc("ninja") });
  assert.deepEqual(await updateBrandingCore(db, proCtx(pro), pack, now, { blobHost: null }), OK);
  assert.deepEqual(await brandingOf(db, pro.proId), {
    themePreset: preset.id,
    customColor: "#12ab34",
    brandColor: preset.color,
    bannerUrl: null,
    headerLayout: "profil",
    avatarKind: "pack",
    avatarStyle: null,
    avatarSeed: null,
    avatarUrl: "/avatars/3d/ninja.png",
  });

  // « custom » without a valid color of its own falls back to the stored custom color.
  const generated = branding({ themePreset: "custom", avatarKind: "generated", avatarStyle: "micah", avatarSeed: "Studio-3", avatarUrl: avatar });
  assert.deepEqual(await updateBrandingCore(db, proCtx(pro), generated, now, STORE), OK);
  const row = await brandingOf(db, pro.proId);
  assert.deepEqual(
    [row.themePreset, row.brandColor, row.avatarKind, row.avatarStyle, row.avatarSeed, row.avatarUrl],
    ["custom", "#12ab34", "generated", "micah", "Studio-3", null],
    "a generated avatar keeps no URL",
  );
});

dbTest("updateBrandingCore refuses an image from anywhere else, an unknown avatar and a forged input, and writes nothing", async ({ db, pro }) => {
  const now = new Date();
  const other = await createTestPro(db);
  try {
    const before = await rowOf(db, pro.proId);
    const imageRefused = { ok: false, error: BRANDING_IMAGE_REFUSED };
    const avatarRefused = { ok: false, error: AVATAR_REFUSED };
    for (const bannerUrl of [
      "https://evil.test/banner.png",
      `http://${HOST}/branding/${pro.proId}/banner-a.webp`,
      `https://${HOST}/branding/${other.proId}/banner-a.webp`,
      `https://${HOST}/branding/${pro.proId}/avatar-a.webp`,
      `https://${HOST}/branding/${pro.proId}/banner-a.svg`,
      packSrc("ninja"),
      "javascript:alert(1)",
    ]) {
      assert.deepEqual(await updateBrandingCore(db, proCtx(pro), branding({ bannerUrl }), now, STORE), imageRefused, bannerUrl);
    }
    assert.deepEqual(
      await updateBrandingCore(db, proCtx(pro), branding({ bannerUrl: uploaded(pro, "banner") }), now, { blobHost: null }),
      imageRefused,
      "no Blob store configured: no upload can be the pro's",
    );
    const avatars: [string, string | null, object][] = [
      ["upload", "https://evil.test/a.png", imageRefused],
      ["upload", uploaded(other, "avatar"), imageRefused],
      ["upload", uploaded(pro, "banner"), imageRefused],
      ["upload", packSrc("ninja"), imageRefused],
      ["upload", null, imageRefused],
      ["pack", "/avatars/3d/nope.png", avatarRefused],
      ["pack", `https://evil.test${packSrc("ninja")}`, avatarRefused],
      ["pack", uploaded(pro, "avatar"), avatarRefused],
      ["pack", null, avatarRefused],
    ];
    for (const [avatarKind, avatarUrl, refused] of avatars) {
      assert.deepEqual(
        await updateBrandingCore(db, proCtx(pro), branding({ avatarKind, avatarUrl }), now, STORE),
        refused,
        `${avatarKind} ${avatarUrl}`,
      );
    }
    assert.deepEqual(
      await updateBrandingCore(db, proCtx(pro), branding({ avatarKind: "generated", avatarStyle: "evil", avatarSeed: "x" }), now, STORE),
      avatarRefused,
    );
    const forged = { ...branding(), professionalId: other.proId } as BrandingInput;
    assert.equal((await updateBrandingCore(db, proCtx(pro), forged, now, STORE)).ok, false, "a strict input: no field rides along");
    assert.equal((await updateBrandingCore(db, proCtx(pro), branding({ avatarSeed: "s".repeat(201), avatarKind: "generated", avatarStyle: "micah" }), now, STORE)).ok, false);
    assert.deepEqual(await rowOf(db, pro.proId), before, "nothing written");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("updateSlugCore changes the address; a taken, reserved or short one is refused and nothing is written", async ({ db, pro }) => {
  const now = new Date();
  const other = await createTestPro(db);
  try {
    const fresh = `t-${nanoid(10).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
    assert.deepEqual(await updateSlugCore(db, proCtx(pro), { slug: `  ${fresh.toUpperCase()}- ` }, now), { ok: true, effects: [], slug: fresh });
    assert.equal((await rowOf(db, pro.proId)).slug, fresh);
    assert.deepEqual(await updateSlugCore(db, { ...proCtx(pro), slug: fresh }, { slug: fresh }, now), { ok: true, effects: [], slug: fresh }, "its own address again");

    const cases: [string, string][] = [
      [other.slug, SLUG_TAKEN],
      ["ab", "Au moins 3 caractères."],
      ["dashboard", "Cette adresse est réservée par Skedul."],
    ];
    for (const [slug, error] of cases) {
      assert.deepEqual(await updateSlugCore(db, { ...proCtx(pro), slug: fresh }, { slug }, now), { ok: false, error }, slug);
    }
    assert.equal((await updateSlugCore(db, proCtx(pro), { slug: 42 } as unknown as { slug: string }, now)).ok, false);
    assert.equal((await rowOf(db, pro.proId)).slug, fresh, "still the new address");
    assert.equal((await rowOf(db, other.proId)).slug, other.slug, "the other pro keeps theirs");
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

/** A signed-up account with no pro page yet (the onboarding's caller). */
async function clientUser(db: Db): Promise<string> {
  const id = nanoid();
  await db.insert(user).values({ id, name: "Client onboarding", email: testEmail("onb"), emailVerified: true, role: "client" });
  return id;
}

const roleOf = async (db: Db, userId: string) => (await db.select({ role: user.role }).from(user).where(eq(user.id, userId)))[0]?.role;

dbTest("createProfessionalProfileCore writes the page, the pro role and the Monday to Friday hours together", async ({ db }) => {
  const userId = await clientUser(db);
  try {
    const name = `Studio ${nanoid(8).replace(/[^A-Za-z0-9]/g, "x")}`;
    const res = await createProfessionalProfileCore(db, userId, { businessName: `  ${name}  `, headline: "", bio: " Bio ", timezone: "Mars/Olympus" });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const [page] = await db.select().from(professional).where(eq(professional.userId, userId));
    assert.deepEqual(
      [page.id, page.slug, page.businessName, page.headline, page.bio, page.timezone],
      [res.professionalId, res.slug, name, null, "Bio", "Europe/Paris"],
      "an unknown zone falls back to Paris",
    );
    assert.equal(res.slug, name.toLowerCase().replace(/ /g, "-"));
    assert.equal(await roleOf(db, userId), "pro");
    const rules = await db
      .select({ day: availabilityRule.dayOfWeek, start: availabilityRule.startMinute, end: availabilityRule.endMinute, type: availabilityRule.ticketTypeId })
      .from(availabilityRule)
      .where(eq(availabilityRule.professionalId, res.professionalId))
      .orderBy(asc(availabilityRule.dayOfWeek));
    assert.deepEqual(rules, [1, 2, 3, 4, 5].map((day) => ({ day, start: 540, end: 1020, type: null })));
  } finally {
    await deleteTestUser(db, userId);
  }
});

dbTest("createProfessionalProfileCore: an address taken between its check and the batch, or an invalid name, leaves the account as it was", async ({ db, pro }) => {
  const userId = await clientUser(db);
  try {
    const name = `Studio ${nanoid(8).replace(/[^A-Za-z0-9]/g, "x")}`;
    const raced = await createProfessionalProfileCore(db, userId, { businessName: name }, {
      afterSlug: async (slug) => {
        await db.update(professional).set({ slug }).where(eq(professional.id, pro.proId));
      },
    });
    assert.deepEqual(raced, { ok: false, error: PROFILE_NOT_CREATED });
    assert.equal(await roleOf(db, userId), "client", "the role change of the batch is rolled back");
    assert.deepEqual(await db.select({ id: professional.id }).from(professional).where(eq(professional.userId, userId)), []);

    for (const businessName of ["   ", "x".repeat(500)]) {
      const res = await createProfessionalProfileCore(db, userId, { businessName });
      assert.equal(res.ok, false, businessName.slice(0, 10));
    }
    assert.equal(await roleOf(db, userId), "client");
  } finally {
    await deleteTestUser(db, userId);
  }
});
