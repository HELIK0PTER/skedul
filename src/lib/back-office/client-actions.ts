/**
 * Client and wallet cores (spec § 11 E8, § 13.1). Thin wrappers in
 * src/server/pro-clients.ts add the session, the revalidation and the effects.
 * Every core: parseFr BEFORE the engine (no English zod message reaches the UI),
 * the refusals only this layer can make, then the engine, then fromEngine.
 * professionalId and actorUserId come from `ctx`, never from the input; every
 * id of the input is checked against that pro by the engine or by the read of
 * the core. Wallet actions take EXPLICIT ticket ids (OUT L125).
 */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { CLIENT_FILTERS } from "@/lib/back-office/client-filters";
import { listClients, type ClientListRow } from "@/lib/back-office/client-reads";
import { actionFail, fromEngine, type ActionResult, type CoreResult, type ProCtx } from "@/lib/back-office/result";
import { LAST_CALENDAR_DAY, LAST_DAY_PAST, LAST_DAY_TOO_FAR } from "@/lib/back-office/wallet-form";
import {
  closeTickets,
  convertTickets,
  createCustomer,
  offerTickets,
  pointTickets,
  revokeLinks,
  unpointTickets,
  updateCustomer,
} from "@/lib/booking/wallet";
import type { DateKey } from "@/lib/civil-date";
import type { Db } from "@/lib/db/atomic";
import { ticket, ticketType } from "@/lib/db/schema";
import { expiryFromLastDay } from "@/lib/ticket-expiry";
import { BOUNDS, customerInputSchema, dateKeySchema, idSchema } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";

export const OFFER_RDV_FREE = "Un type « Gratuit » n'utilise pas de tickets : choisissez un autre type.";
export const CONVERT_TARGET_UNAVAILABLE = "Ce type ne peut pas recevoir de tickets.";
/** The picker only offers other types, so this is a stale tab: the tickets were already converted. */
export const CONVERT_SAME_TYPE = "Un de ces tickets a déjà ce type : rafraîchissez la page.";
/** The wording and the last calendar day live in wallet-form.ts, so that the offer dialog checks the same rule in the browser. */
export const EXPIRY_IN_PAST = LAST_DAY_PAST;
const EXPIRY_TOO_FAR = LAST_DAY_TOO_FAR;

/** The explicit ticket ids of a wallet action: 1 to 100. */
export const ticketIdsSchema = z.array(idSchema).min(1).max(BOUNDS.walletQuantity);

const noteSchema = z.string().trim().max(BOUNDS.note).nullable();

/** Same name and phone rules as the engine's updateCustomer (src/lib/booking/wallet.ts). */
const customerEditSchema = z.object({
  customerId: idSchema,
  name: z.string().trim().min(1).max(BOUNDS.name),
  phone: z.string().trim().max(BOUNDS.phone).nullable(),
});

const customerIdSchema = z.object({ customerId: idSchema });

/** The client search: strict, so a smuggled key (professionalId, userId) is refused whole instead of ignored. */
const searchClientsSchema = z.object({ q: z.string().trim().max(100), filter: z.enum(CLIENT_FILTERS) }).strict();

const offerTicketsSchema = z.object({
  customerId: idSchema,
  ticketTypeId: idSchema,
  quantity: z.number().int().min(1).max(BOUNDS.walletQuantity),
  lastValidDay: dateKeySchema.nullable(),
  reason: noteSchema,
  notify: z.boolean(),
});

const convertTicketsSchema = z.object({
  customerId: idSchema,
  ticketIds: ticketIdsSchema,
  toTicketTypeId: idSchema,
});

const closeTicketsSchema = z.object({
  customerId: idSchema,
  ticketIds: ticketIdsSchema,
  reason: z.enum(["rembourse", "compense", "autre"]),
  note: noteSchema,
});

const noteTicketsSchema = z.object({ customerId: idSchema, ticketIds: ticketIdsSchema, note: noteSchema });

const plainTicketsSchema = z.object({ customerId: idSchema, ticketIds: ticketIdsSchema });

/** A string trimmed, anything else as is (parseFr then reports it). */
const trimmed = (value: unknown): unknown => (typeof value === "string" ? value.trim() : value);

/** Each id once, first-seen order: a repeated id must not make the engine refuse a valid selection. */
const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

/** « Nouveau client »: parseFr(customerInputSchema); the pro's name (and phone, when given) win on an existing e-mail. */
export async function createCustomerCore(
  db: Db,
  ctx: ProCtx,
  input: { name: string; email: string; phone: string | null },
  now: Date,
): Promise<CoreResult<{ customerId: string; created: boolean }>> {
  const parsed = parseFr(customerInputSchema, {
    name: input.name,
    email: trimmed(input.email),
    phone: input.phone ?? undefined,
  });
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await createCustomer(
    db,
    { professionalId: ctx.professionalId, name: parsed.data.name, email: parsed.data.email, phone: parsed.data.phone ?? null },
    now,
  );
  if (!res.ok) return fromEngine(res, "customer");
  return { ok: true, effects: res.effects, customerId: res.customerId, created: res.created };
}

/** Name and phone only (Q6: the e-mail is the record's key). */
export async function updateCustomerCore(
  db: Db,
  ctx: ProCtx,
  input: { customerId: string; name: string; phone: string | null },
  now: Date,
): Promise<CoreResult> {
  const parsed = parseFr(customerEditSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await updateCustomer(
    db,
    { professionalId: ctx.professionalId, customerId: parsed.data.customerId, name: parsed.data.name, phone: parsed.data.phone },
    now,
  );
  if (!res.ok) return fromEngine(res, "customer");
  return { ok: true, effects: res.effects };
}

/**
 * « Rechercher » on /dashboard/clients (Decision 73, FR:UI-13): the term never travels in a URL, so the search is a
 * read behind a Server Action. parseFr of the strict input first (nothing is read for a malformed one), then
 * listClients for THIS pro (ctx.professionalId, never input) with the filter and the term. The counts stay the
 * page's: listClients counts every client whatever `q`.
 */
export async function searchClientsCore(
  db: Db,
  ctx: ProCtx,
  input: unknown,
  now: Date,
): Promise<ActionResult<{ rows: ClientListRow[] }>> {
  const parsed = parseFr(searchClientsSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const { rows } = await listClients(db, ctx.professionalId, now, parsed.data);
  return { ok: true, rows };
}

/** « Déconnecter ses liens »: link_version + 1. */
export async function revokeLinksCore(db: Db, ctx: ProCtx, input: { customerId: string }, now: Date): Promise<CoreResult> {
  const parsed = parseFr(customerIdSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const res = await revokeLinks(db, { professionalId: ctx.professionalId, customerId: parsed.data.customerId }, now);
  if (!res.ok) return fromEngine(res, "customer");
  return { ok: true, effects: res.effects };
}

/**
 * « Offrir N »: an active non-rdv_free type (OFFER_RDV_FREE; a missing or
 * archived type is the engine's not_found); the chosen last valid day becomes
 * expiryFromLastDay(day, the pro's zone), which must be after now
 * (EXPIRY_IN_PAST; the last day of the calendar is refused as too far);
 * offerTickets, with the tickets_offered effect when `notify`.
 */
export async function offerTicketsCore(
  db: Db,
  ctx: ProCtx,
  input: {
    customerId: string;
    ticketTypeId: string;
    quantity: number;
    lastValidDay: DateKey | null;
    reason: string | null;
    notify: boolean;
  },
  now: Date,
): Promise<CoreResult<{ count: number }>> {
  const parsed = parseFr(offerTicketsSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const data = parsed.data;
  const [type] = await db
    .select({ rdvFree: ticketType.rdvFree, archivedAt: ticketType.archivedAt })
    .from(ticketType)
    .where(and(eq(ticketType.id, data.ticketTypeId), eq(ticketType.professionalId, ctx.professionalId)));
  if (type && type.archivedAt === null && type.rdvFree) return actionFail(OFFER_RDV_FREE);
  if (data.lastValidDay === LAST_CALENDAR_DAY) return actionFail(EXPIRY_TOO_FAR);
  const expiresAt = data.lastValidDay === null ? null : expiryFromLastDay(data.lastValidDay, ctx.timezone);
  if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) return actionFail(EXPIRY_IN_PAST);
  const res = await offerTickets(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      customerId: data.customerId,
      ticketTypeId: data.ticketTypeId,
      quantity: data.quantity,
      expiresAt,
      reason: data.reason,
      notify: data.notify,
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "wallet");
  return { ok: true, effects: res.effects, count: res.ticketIds.length };
}

/**
 * « Convertir »: explicit ids; the target must be an active, non-rdv_free type
 * of the pro (CONVERT_TARGET_UNAVAILABLE, also for an unknown or foreign id);
 * a selected ticket of the customer that already has the target type is
 * CONVERT_SAME_TYPE; then convertTickets (purchase and expiry are kept).
 */
export async function convertTicketsCore(
  db: Db,
  ctx: ProCtx,
  input: { customerId: string; ticketIds: string[]; toTicketTypeId: string },
  now: Date,
): Promise<CoreResult<{ count: number }>> {
  const parsed = parseFr(convertTicketsSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const data = parsed.data;
  const ticketIds = unique(data.ticketIds);
  const [target] = await db
    .select({ rdvFree: ticketType.rdvFree, archivedAt: ticketType.archivedAt })
    .from(ticketType)
    .where(and(eq(ticketType.id, data.toTicketTypeId), eq(ticketType.professionalId, ctx.professionalId)));
  if (!target || target.archivedAt !== null || target.rdvFree) return actionFail(CONVERT_TARGET_UNAVAILABLE);
  const same = await db
    .select({ id: ticket.id })
    .from(ticket)
    .where(
      and(
        eq(ticket.professionalId, ctx.professionalId),
        eq(ticket.customerId, data.customerId),
        inArray(ticket.id, ticketIds),
        eq(ticket.ticketTypeId, data.toTicketTypeId),
      ),
    );
  if (same.length > 0) return actionFail(CONVERT_SAME_TYPE);
  const res = await convertTickets(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      customerId: data.customerId,
      selection: { ticketIds },
      toTicketTypeId: data.toTicketTypeId,
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "wallet");
  return { ok: true, effects: res.effects, count: res.ticketIds.length };
}

/** « Clore » (rembourse / compense: paid tickets; autre: any ticket, the note is required); closeTickets. */
export async function closeTicketsCore(
  db: Db,
  ctx: ProCtx,
  input: { customerId: string; ticketIds: string[]; reason: "rembourse" | "compense" | "autre"; note: string | null },
  now: Date,
): Promise<CoreResult<{ count: number }>> {
  const parsed = parseFr(closeTicketsSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const data = parsed.data;
  const res = await closeTickets(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      customerId: data.customerId,
      selection: { ticketIds: unique(data.ticketIds) },
      reason: data.reason,
      note: data.note,
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "wallet");
  return { ok: true, effects: res.effects, count: res.ticketIds.length };
}

/** « Retirer » (offered tickets): closeTickets with the reason retire; a paid ticket is refused by the engine (retire_paid). */
export async function retireTicketsCore(
  db: Db,
  ctx: ProCtx,
  input: { customerId: string; ticketIds: string[]; note: string | null },
  now: Date,
): Promise<CoreResult<{ count: number }>> {
  const parsed = parseFr(noteTicketsSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const data = parsed.data;
  const res = await closeTickets(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      customerId: data.customerId,
      selection: { ticketIds: unique(data.ticketIds) },
      reason: "retire",
      note: data.note,
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "wallet");
  return { ok: true, effects: res.effects, count: res.ticketIds.length };
}

/** « Pointer »: explicit ids (OUT L125: never a quantity); the note goes to the movement's reason. */
export async function pointTicketsCore(
  db: Db,
  ctx: ProCtx,
  input: { customerId: string; ticketIds: string[]; note: string | null },
  now: Date,
): Promise<CoreResult<{ count: number }>> {
  const parsed = parseFr(noteTicketsSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const data = parsed.data;
  const res = await pointTickets(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      customerId: data.customerId,
      selection: { ticketIds: unique(data.ticketIds) },
      note: data.note,
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "wallet");
  return { ok: true, effects: res.effects, count: res.ticketIds.length };
}

/** « Annuler le pointage »: explicit ids. */
export async function unpointTicketsCore(
  db: Db,
  ctx: ProCtx,
  input: { customerId: string; ticketIds: string[] },
  now: Date,
): Promise<CoreResult<{ count: number }>> {
  const parsed = parseFr(plainTicketsSchema, input);
  if (!parsed.ok) return actionFail(parsed.error);
  const data = parsed.data;
  const res = await unpointTickets(
    db,
    {
      professionalId: ctx.professionalId,
      actorUserId: ctx.actorUserId,
      customerId: data.customerId,
      selection: { ticketIds: unique(data.ticketIds) },
    },
    now,
  );
  if (!res.ok) return fromEngine(res, "wallet");
  return { ok: true, effects: res.effects, count: res.ticketIds.length };
}
