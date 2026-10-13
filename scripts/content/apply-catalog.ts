/**
 * Writes a CatalogContent through the engine (settings, RDV hours, types,
 * offers, RDV questions, events with their links, questions and séances).
 * Used by scripts/seed.ts and scripts/bootstrap-content.ts. Sends no e-mail.
 */
import { eq, sql } from "drizzle-orm";

import {
  createOffer,
  createTicketType,
  setAvailabilityRules,
  setTypeQuestions,
  updateBookingSettings,
} from "@/lib/booking/catalog";
import { createEvent } from "@/lib/booking/occurrences";
import type { EngineFail, EngineResult } from "@/lib/booking/types";
import { todayKey } from "@/lib/civil-date";
import type { Db } from "@/lib/db/atomic";
import { professional } from "@/lib/db/schema";

import { altinhaCatalog, type CatalogContent } from "./altinha";

export type AppliedCatalog = {
  typeIds: Record<string, string>;
  offerIds: Record<string, string[]>;
  eventIds: Record<string, string>;
};

/** Scripts treat any engine failure as fatal: the result, narrowed to ok, or a throw naming the step. */
export function expectOk<R extends EngineResult<object>>(label: string, result: R): Exclude<R, EngineFail> {
  const checked = result as EngineResult<object>;
  if (!checked.ok) {
    throw new Error(`${label}: ${checked.code}${checked.message ? ` (${checked.message})` : ""}`);
  }
  return result as Exclude<R, EngineFail>;
}

function idOf(ids: Record<string, string>, key: string): string {
  const id = ids[key];
  if (!id) throw new Error(`Unknown ticket type key "${key}" in the catalog`);
  return id;
}

/** Throws on the first failure (scripts only: there is no partial-write recovery). */
export async function applyCatalog(
  db: Db,
  professionalId: string,
  content: CatalogContent,
  now: Date,
): Promise<AppliedCatalog> {
  expectOk("settings", await updateBookingSettings(db, { professionalId, settings: content.settings }, now));
  expectOk(
    "global hours",
    await setAvailabilityRules(db, { professionalId, ticketTypeId: null, rules: content.availability }, now),
  );

  const typeIds: Record<string, string> = {};
  const offerIds: Record<string, string[]> = {};
  for (const entry of content.types) {
    const { ticketTypeId } = expectOk(
      `type ${entry.key}`,
      await createTicketType(db, { professionalId, type: entry.type }, now),
    );
    typeIds[entry.key] = ticketTypeId;
    offerIds[entry.key] = [];
    for (const offer of entry.offers) {
      const { offerId } = expectOk(
        `offer ${entry.key} ×${offer.quantity}`,
        await createOffer(db, { professionalId, offer: { ...offer, ticketTypeId } }, now),
      );
      offerIds[entry.key].push(offerId);
    }
    if (entry.availability) {
      expectOk(
        `hours ${entry.key}`,
        await setAvailabilityRules(db, { professionalId, ticketTypeId, rules: entry.availability }, now),
      );
    }
    if (entry.questions) {
      expectOk(
        `questions ${entry.key}`,
        await setTypeQuestions(db, { professionalId, ticketTypeId, questions: entry.questions }, now),
      );
    }
  }

  const eventIds: Record<string, string> = {};
  for (const entry of content.events) {
    const { eventId } = expectOk(
      `event ${entry.key}`,
      await createEvent(
        db,
        {
          professionalId,
          event: {
            title: entry.title,
            description: entry.description,
            location: entry.location,
            color: entry.color,
            bookingMode: entry.bookingMode,
            isPrivate: entry.isPrivate,
            capacity: entry.capacity,
            durationMin: entry.durationMin,
            rule: entry.rule,
            ticketTypeIds: entry.ticketTypeKeys.map((key) => idOf(typeIds, key)),
            questions: entry.questions ?? [],
          },
        },
        now,
      ),
    );
    eventIds[entry.key] = eventId;
  }

  return { typeIds, offerIds, eventIds };
}

export type BootstrapOutcome =
  | { ok: true; professionalId: string; applied: AppliedCatalog }
  | { ok: false; reason: "unknown_pro" | "has_data" };

/**
 * Catalog or clients already present. Unlike hasDomainData (catalog.ts), a
 * time off does not count: time_off is kept from v1 (spec § 6.1), never
 * conflicts with the catalog, and the owner's real page may have some (P6).
 */
async function hasCatalogOrClients(db: Db, professionalId: string): Promise<boolean> {
  const res = await db.execute<{ found: boolean }>(sql`select (
    exists (select 1 from ticket_type where professional_id = ${professionalId})
    or exists (select 1 from event where professional_id = ${professionalId})
    or exists (select 1 from customer where professional_id = ${professionalId})
  ) as found`);
  return res.rows[0]?.found === true;
}

/**
 * `bootstrap-content --pro <slug>` (spec § 15.4): the Altinha catalog only, on
 * an existing pro WITHOUT ticket types, events or customers (a v1 time off is fine).
 * No customer, purchase, ticket, booking or time off; no e-mail.
 */
export async function bootstrapCatalog(db: Db, slug: string, now: Date): Promise<BootstrapOutcome> {
  const [pro] = await db
    .select({ id: professional.id, timezone: professional.timezone })
    .from(professional)
    .where(eq(professional.slug, slug));
  if (!pro) return { ok: false, reason: "unknown_pro" };
  if (await hasCatalogOrClients(db, pro.id)) return { ok: false, reason: "has_data" };
  const applied = await applyCatalog(db, pro.id, altinhaCatalog(todayKey(now, pro.timezone)), now);
  return { ok: true, professionalId: pro.id, applied };
}
