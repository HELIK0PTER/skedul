import assert from "node:assert/strict";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { altinhaCatalog } from "../../../scripts/content/altinha";
import { applyCatalog, bootstrapCatalog } from "../../../scripts/content/apply-catalog";
import { dbTest } from "../../test/db";
import { dayOfWeek, diffDays, instantAt, todayKey } from "../civil-date";
import type { Db } from "../db/atomic";
import * as schema from "../db/schema";
import { hasDomainData } from "./catalog";

async function countRows(db: Db, table: string, professionalId: string): Promise<number> {
  const res = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)} where professional_id = ${professionalId}`,
  );
  return Number(res.rows[0]?.n ?? 0);
}

async function seances(db: Db, eventId: string) {
  return db
    .select()
    .from(schema.occurrence)
    .where(eq(schema.occurrence.eventId, eventId))
    .orderBy(asc(schema.occurrence.startsAt));
}

dbTest("applyCatalog writes the Altinha catalog through the engine", async ({ db, pro }) => {
  const now = new Date();
  assert.equal(await hasDomainData(db, pro.proId), false);
  const applied = await applyCatalog(db, pro.proId, altinhaCatalog(todayKey(now, pro.tz)), now);

  assert.deepEqual(Object.keys(applied.typeIds).sort(), ["collectif", "decouverte", "essai", "particulier"]);
  assert.deepEqual(Object.keys(applied.eventIds).sort(), ["atelier", "competition", "debutants", "intermediaires", "roda"]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(applied.offerIds).map(([key, ids]) => [key, ids.length])),
    { collectif: 3, essai: 1, particulier: 2, decouverte: 0 },
  );
  assert.equal(await countRows(db, "ticket_type", pro.proId), 4);
  assert.equal(await countRows(db, "ticket_offer", pro.proId), 6);
  assert.equal(await countRows(db, "event", pro.proId), 5);
  assert.equal(await countRows(db, "event_ticket_type", pro.proId), 5);
  assert.equal(await countRows(db, "question", pro.proId), 2);
  assert.equal(await countRows(db, "availability_rule", pro.proId), 17);

  const [settings] = await db
    .select({
      horizon: schema.professional.bookingHorizonDays,
      notice: schema.professional.minNoticeMinutes,
      cancel: schema.professional.cancelDeadlineHours,
    })
    .from(schema.professional)
    .where(eq(schema.professional.id, pro.proId));
  assert.deepEqual(settings, { horizon: 60, notice: 60, cancel: 24 });

  const globalRules = await db
    .select()
    .from(schema.availabilityRule)
    .where(and(eq(schema.availabilityRule.professionalId, pro.proId), isNull(schema.availabilityRule.ticketTypeId)));
  assert.equal(globalRules.length, 12);

  const [decouverte] = await db
    .select()
    .from(schema.ticketType)
    .where(eq(schema.ticketType.id, applied.typeIds.decouverte));
  assert.equal(decouverte.rdvEnabled, true);
  assert.equal(decouverte.rdvFree, true);
  assert.equal(decouverte.rdvDurationMin, 15);

  const debutants = await seances(db, applied.eventIds.debutants);
  assert.ok(debutants.length > 100, String(debutants.length));
  for (const o of debutants) {
    assert.ok([1, 3].includes(dayOfWeek(o.seriesDate!)), o.seriesDate!);
    assert.equal(o.startsAt.getTime(), instantAt(o.seriesDate!, 1140, pro.tz).getTime());
    assert.equal(o.capacity, 12);
  }

  const roda = await seances(db, applied.eventIds.roda);
  assert.ok(roda.length > 20, String(roda.length));
  for (let i = 0; i < roda.length; i++) {
    assert.equal(dayOfWeek(roda[i].seriesDate!), 6);
    if (i > 0) assert.equal(diffDays(roda[i - 1].seriesDate!, roda[i].seriesDate!), 14);
  }

  const atelier = await seances(db, applied.eventIds.atelier);
  assert.ok(atelier.length >= 12, String(atelier.length));
  for (const o of atelier) {
    assert.equal(dayOfWeek(o.seriesDate!), 0);
    assert.ok(Number(o.seriesDate!.slice(8)) <= 7, o.seriesDate!);
  }

  const [competition] = await db.select().from(schema.event).where(eq(schema.event.id, applied.eventIds.competition));
  assert.equal(competition.isPrivate, true);
  const [rodaEvent] = await db.select().from(schema.event).where(eq(schema.event.id, applied.eventIds.roda));
  assert.equal(rodaEvent.bookingMode, "free");

  assert.equal(await hasDomainData(db, pro.proId), true);
});

dbTest("bootstrapCatalog accepts a v1 time off, refuses an unknown page and a page that has data", async ({ db, pro }) => {
  const now = new Date();
  assert.deepEqual(await bootstrapCatalog(db, `${pro.slug}-inconnu`, now), { ok: false, reason: "unknown_pro" });

  // A time off kept from v1 is not catalog data: the owner's real page may have one (P6).
  await db.insert(schema.timeOff).values({
    professionalId: pro.proId,
    startAt: new Date("2026-01-05T00:00:00Z"),
    endAt: new Date("2026-01-06T00:00:00Z"),
    allDay: true,
    reason: "Vacances",
  });

  const first = await bootstrapCatalog(db, pro.slug, now);
  assert.equal(first.ok, true);
  assert.deepEqual(await bootstrapCatalog(db, pro.slug, now), { ok: false, reason: "has_data" });
  assert.equal(await countRows(db, "ticket_type", pro.proId), 4, "the refused run wrote nothing");
  assert.equal(await countRows(db, "time_off", pro.proId), 1, "bootstrap creates no time off");

  for (const table of ["customer", "ticket_purchase", "ticket", "booking"]) {
    assert.equal(await countRows(db, table, pro.proId), 0, table);
  }
});
