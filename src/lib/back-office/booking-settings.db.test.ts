import assert from "node:assert/strict";
import { and, eq, isNull } from "drizzle-orm";

import { createTestPro, dbTest, deleteTestUser, type Db } from "../../test/db";
import { makeType } from "../../test/fixtures";
import { proCtx } from "../../test/pro-ctx";
import { setAvailabilityRules } from "../booking/catalog";
import { availabilityRule, professional } from "../db/schema";
import { NOTICE_TOO_LONG } from "./notice";
import { saveAvailabilityCore, updateBookingSettingsCore } from "./settings-actions";

const OK = { ok: true, effects: [] } as const;

async function rowOf(db: Db, proId: string) {
  const [row] = await db.select().from(professional).where(eq(professional.id, proId));
  return row;
}

const DEFAULT_SETTINGS = { bookingHorizonDays: 60, minNoticeMinutes: 60, cancelDeadlineHours: 24 };

async function settingsOf(db: Db, proId: string) {
  const row = await rowOf(db, proId);
  return {
    bookingHorizonDays: row.bookingHorizonDays,
    minNoticeMinutes: row.minNoticeMinutes,
    cancelDeadlineHours: row.cancelDeadlineHours,
  };
}

/** [dayOfWeek, startMinute, endMinute] of the global hours (typeId null) or of one type's hours, sorted. */
async function hoursOf(db: Db, proId: string, typeId: string | null): Promise<number[][]> {
  const rows = await db
    .select()
    .from(availabilityRule)
    .where(
      and(
        eq(availabilityRule.professionalId, proId),
        typeId === null ? isNull(availabilityRule.ticketTypeId) : eq(availabilityRule.ticketTypeId, typeId),
      ),
    );
  return rows
    .map((r) => [r.dayOfWeek, r.startMinute, r.endMinute])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

dbTest("updateBookingSettingsCore saves the three settings of the acting pro only", async ({ db, pro }) => {
  const now = new Date();
  const other = await createTestPro(db);
  try {
    assert.deepEqual(await settingsOf(db, pro.proId), DEFAULT_SETTINGS);
    assert.deepEqual(
      await updateBookingSettingsCore(db, proCtx(pro), { bookingHorizonDays: 90, minNoticeMinutes: 1440, cancelDeadlineHours: 12 }, now),
      OK,
    );
    assert.deepEqual(await settingsOf(db, pro.proId), { bookingHorizonDays: 90, minNoticeMinutes: 1440, cancelDeadlineHours: 12 });
    assert.deepEqual(await settingsOf(db, other.proId), DEFAULT_SETTINGS, "the other pro is untouched");

    // a notice of exactly the horizon is allowed (3 days = 4320 minutes)
    assert.deepEqual(
      await updateBookingSettingsCore(db, proCtx(pro), { bookingHorizonDays: 3, minNoticeMinutes: 4320, cancelDeadlineHours: 0 }, now),
      OK,
    );
    assert.deepEqual(await settingsOf(db, pro.proId), { bookingHorizonDays: 3, minNoticeMinutes: 4320, cancelDeadlineHours: 0 });
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("a notice longer than the horizon is refused with NOTICE_TOO_LONG and nothing is written", async ({ db, pro }) => {
  const now = new Date();
  const before = await settingsOf(db, pro.proId);
  const sevenDaysOneDay = { bookingHorizonDays: 1, minNoticeMinutes: 10080, cancelDeadlineHours: 24 };
  assert.deepEqual(await updateBookingSettingsCore(db, proCtx(pro), sevenDaysOneDay, now), { ok: false, error: NOTICE_TOO_LONG });
  // one minute over a one-day horizon
  assert.deepEqual(
    await updateBookingSettingsCore(db, proCtx(pro), { bookingHorizonDays: 1, minNoticeMinutes: 1441, cancelDeadlineHours: 24 }, now),
    { ok: false, error: NOTICE_TOO_LONG },
  );
  assert.deepEqual(await settingsOf(db, pro.proId), before);
});

dbTest("booking settings out of bounds speak French and write nothing", async ({ db, pro }) => {
  const now = new Date();
  const before = await settingsOf(db, pro.proId);
  const cases: [typeof DEFAULT_SETTINGS, string][] = [
    [{ ...DEFAULT_SETTINGS, bookingHorizonDays: 400 }, "Réservable jusqu'à : maximum 365."],
    [{ ...DEFAULT_SETTINGS, bookingHorizonDays: 0 }, "Réservable jusqu'à : minimum 1."],
    [{ ...DEFAULT_SETTINGS, bookingHorizonDays: Number.NaN }, "Réservable jusqu'à : indiquez un nombre."],
    [{ ...DEFAULT_SETTINGS, cancelDeadlineHours: 721 }, "Annulation par le client : maximum 720."],
  ];
  for (const [settings, error] of cases) {
    assert.deepEqual(await updateBookingSettingsCore(db, proCtx(pro), settings, now), { ok: false, error }, error);
  }
  assert.deepEqual(await settingsOf(db, pro.proId), before);
});

dbTest("saveAvailabilityCore replaces the global hours and leaves a type's hours and another pro's alone", async ({ db, pro }) => {
  const now = new Date();
  const typeId = await makeType(db, pro);
  const seeded = await setAvailabilityRules(db, {
    professionalId: pro.proId,
    ticketTypeId: typeId,
    rules: [{ dayOfWeek: 2, startMinute: 600, endMinute: 720 }],
  });
  assert.equal(seeded.ok, true);
  const globalSeeded = await setAvailabilityRules(db, {
    professionalId: pro.proId,
    ticketTypeId: null,
    rules: [
      { dayOfWeek: 1, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: 3, startMinute: 540, endMinute: 1020 },
    ],
  });
  assert.equal(globalSeeded.ok, true);

  const other = await createTestPro(db);
  try {
    const otherSeeded = await setAvailabilityRules(db, {
      professionalId: other.proId,
      ticketTypeId: null,
      rules: [{ dayOfWeek: 4, startMinute: 480, endMinute: 600 }],
    });
    assert.equal(otherSeeded.ok, true);

    const replaced = await saveAvailabilityCore(
      db,
      proCtx(pro),
      {
        rules: [
          { dayOfWeek: 5, startMinute: 480, endMinute: 720 },
          { dayOfWeek: 5, startMinute: 840, endMinute: 1080 },
        ],
      },
      now,
    );
    assert.deepEqual(replaced, OK);
    assert.deepEqual(await hoursOf(db, pro.proId, null), [
      [5, 480, 720],
      [5, 840, 1080],
    ]);
    assert.deepEqual(await hoursOf(db, pro.proId, typeId), [[2, 600, 720]], "the type's own hours are untouched");
    assert.deepEqual(await hoursOf(db, other.proId, null), [[4, 480, 600]], "the other pro's hours are untouched");

    // an empty list closes every day of the global hours, still without touching the type's
    assert.deepEqual(await saveAvailabilityCore(db, proCtx(pro), { rules: [] }, now), OK);
    assert.deepEqual(await hoursOf(db, pro.proId, null), []);
    assert.deepEqual(await hoursOf(db, pro.proId, typeId), [[2, 600, 720]]);
    assert.deepEqual(await hoursOf(db, other.proId, null), [[4, 480, 600]]);
  } finally {
    await deleteTestUser(db, other.userId);
  }
});

dbTest("saveAvailabilityCore stores overlapping and touching ranges of a day as one (an RDV must fit inside a single range)", async ({ db, pro }) => {
  const now = new Date();
  const saved = await saveAvailabilityCore(
    db,
    proCtx(pro),
    {
      rules: [
        { dayOfWeek: 1, startMinute: 720, endMinute: 840 },
        { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
        { dayOfWeek: 1, startMinute: 780, endMinute: 900 },
        { dayOfWeek: 1, startMinute: 1020, endMinute: 1080 },
        { dayOfWeek: 2, startMinute: 540, endMinute: 600 },
        { dayOfWeek: 2, startMinute: 540, endMinute: 600 },
      ],
    },
    now,
  );
  assert.deepEqual(saved, OK);
  assert.deepEqual(await hoursOf(db, pro.proId, null), [
    [1, 540, 900],
    [1, 1020, 1080],
    [2, 540, 600],
  ]);
});

dbTest("saveAvailabilityCore refuses an inverted or empty range with « Plage horaire invalide. » and keeps the old hours", async ({ db, pro }) => {
  const now = new Date();
  const seeded = await setAvailabilityRules(db, {
    professionalId: pro.proId,
    ticketTypeId: null,
    rules: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }],
  });
  assert.equal(seeded.ok, true);
  const invalid = { ok: false, error: "Plage horaire invalide." };

  assert.deepEqual(
    await saveAvailabilityCore(db, proCtx(pro), { rules: [{ dayOfWeek: 2, startMinute: 600, endMinute: 540 }] }, now),
    invalid,
  );
  assert.deepEqual(
    await saveAvailabilityCore(db, proCtx(pro), { rules: [{ dayOfWeek: 2, startMinute: 600, endMinute: 600 }] }, now),
    invalid,
  );
  assert.deepEqual(await hoursOf(db, pro.proId, null), [[1, 540, 1020]]);
});
