import "./load-env";

import { betterAuth } from "better-auth";
import { and, asc, eq, gt, lt, sql } from "drizzle-orm";

import { buildAuthOptions } from "@/lib/auth-options";
import { loadQuestions } from "@/lib/booking/answers";
import { cancelOccurrence, createTimeOffWithConflicts } from "@/lib/booking/cancel";
import { createTicketType, setTicketTypeArchived } from "@/lib/booking/catalog";
import { bookRdv, bookWithHeldTicket, registerFree, registerPro, startBuyAndBook } from "@/lib/booking/claims";
import { fulfillPurchase, startPurchase } from "@/lib/booking/fulfillment";
import { checkInvariants } from "@/lib/booking/invariants";
import { expireTickets } from "@/lib/booking/nightly";
import { ensureHorizon } from "@/lib/booking/occurrences";
import {
  closeTickets,
  convertTickets,
  createCustomer,
  offerTickets,
  pointTickets,
  upsertCustomer,
} from "@/lib/booking/wallet";
import { addDays, dayOfWeek, instantAt, todayKey, type DateKey } from "@/lib/civil-date";
import { db } from "@/lib/db";
import { textArray } from "@/lib/db/atomic";
import { occurrence, professional, session, user } from "@/lib/db/schema";
import { env } from "@/lib/env";

import { ALTINHA_PROFILE, SEED_CLIENT_EMAILS, altinhaCatalog } from "./content/altinha";
import { applyCatalog, expectOk, type AppliedCatalog } from "./content/apply-catalog";

/**
 * Seed v2 (spec § 15.4): the Altinha Paris demo, written ONLY through the
 * engine with an injected clock, so the history (past séances, an expired
 * carnet, a cancelled séance) is real data that passes checkInvariants.
 *
 *   ./node_modules/.bin/tsx scripts/seed.ts --wipe
 *
 * Guards: never with APP_ENV=production; only on a DATABASE_URL host listed
 * in SEED_ALLOWED_HOSTS; --wipe deletes the demo users only (their pages
 * cascade), never a TRUNCATE; without --wipe it refuses if they exist.
 */

const PASSWORD = "password123";
const TZ = ALTINHA_PROFILE.timezone;
const DEMO_USERS = sql`email like '%@skedul.app' or email like '%@skedul.test' or email = any(${textArray(SEED_CLIENT_EMAILS)})`;

/** T = the real now; every other instant of the story is local wall-clock time. */
const T = new Date();
const TODAY = todayKey(T, TZ);
const at = (days: number, minute: number): Date => instantAt(addDays(TODAY, days), minute, TZ);
const plusMinutes = (d: Date, minutes: number): Date => new Date(d.getTime() + minutes * 60_000);
/** P: the pro opened the page 8 weeks ago, at 09:00. */
const P = at(-56, 540);

type Seance = typeof occurrence.$inferSelect;

async function guard(wipe: boolean): Promise<void> {
  const host = new URL(env.DATABASE_URL).host;
  console.info(`→ ${host}`);
  if (env.APP_ENV === "production") throw new Error("Refus : APP_ENV=production.");
  const allowed = (process.env.SEED_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (!allowed.includes(host)) throw new Error(`Refus : ${host} n'est pas dans SEED_ALLOWED_HOSTS.`);
  if (wipe) {
    const res = await db.execute(sql`delete from "user" where ${DEMO_USERS}`);
    console.info(`🧹 ${res.rowCount ?? 0} compte(s) de démo supprimé(s), avec leurs pages.`);
    return;
  }
  const res = await db.execute<{ n: number }>(sql`select count(*)::int as n from "user" where ${DEMO_USERS}`);
  if (Number(res.rows[0]?.n ?? 0) > 0) {
    throw new Error("Des comptes de démo existent déjà : relancez avec --wipe pour les remplacer.");
  }
}

const seedAuth = betterAuth(
  buildAuthOptions({ db, baseURL: env.APP_URL, secret: env.BETTER_AUTH_SECRET, sendEmail: async () => {} }),
);

/**
 * A password account with a confirmed address and its role. No e-mail leaves
 * (sendEmail is a no-op); the session auto-created by the sign-up and its
 * « Dernière connexion » stamp are removed: nobody has signed in yet.
 */
async function createUser(name: string, email: string, role: "admin" | "pro" | "client"): Promise<string> {
  const res = await seedAuth.api.signUpEmail({ body: { name, email, password: PASSWORD } });
  await db.update(user).set({ emailVerified: true, role, lastLoginAt: null }).where(eq(user.id, res.user.id));
  await db.delete(session).where(eq(session.userId, res.user.id));
  return res.user.id;
}

async function seancesOf(eventId: string): Promise<Seance[]> {
  return db.select().from(occurrence).where(eq(occurrence.eventId, eventId)).orderBy(asc(occurrence.startsAt));
}

function firstFrom(rows: readonly Seance[], from: Date, label: string): Seance {
  const row = rows.find((o) => o.status === "scheduled" && o.startsAt.getTime() >= from.getTime());
  if (!row) throw new Error(`Aucune séance ${label} après le ${from.toISOString()}`);
  return row;
}

/** First local date ≥ today + `days` whose weekday is listed. */
function dayFrom(days: number, weekdays: readonly number[]): DateKey {
  let key = addDays(TODAY, days);
  while (!weekdays.includes(dayOfWeek(key))) key = addDays(key, 1);
  return key;
}

/** First local date ≥ today + `days` without any séance holding a seat (the time off must cancel nothing). */
async function dayWithoutBookings(professionalId: string, days: number): Promise<DateKey> {
  for (let i = 0; i < 14; i++) {
    const key = addDays(TODAY, days + i);
    const start = instantAt(key, 0, TZ);
    const end = instantAt(addDays(key, 1), 0, TZ);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(occurrence)
      .where(
        and(
          eq(occurrence.professionalId, professionalId),
          eq(occurrence.status, "scheduled"),
          gt(occurrence.seatsTaken, 0),
          lt(occurrence.blockStart, end),
          gt(occurrence.blockEnd, start),
        ),
      );
    if (Number(row?.n ?? 0) === 0) return key;
  }
  throw new Error("Aucun jour libre pour l'indisponibilité");
}

function offerOf(catalog: AppliedCatalog, key: string, index: number): string {
  const id = catalog.offerIds[key]?.[index];
  if (!id) throw new Error(`Offre ${key}[${index}] introuvable`);
  return id;
}

async function main() {
  const wipe = process.argv.includes("--wipe");
  await guard(wipe);
  console.info("🌱 Seed Skedul v2 (tickets et événements)…");

  /* ── 1. Accounts ─────────────────────────────────────────────── */
  await createUser("Admin Skedul", "admin@skedul.test", "admin");
  const proUserId = await createUser("Altinha Paris", "pro@skedul.app", "pro");
  const beatrizUserId = await createUser("Beatriz Almeida", "beatriz@example.com", "client");

  /* ── 2. Pro page and catalog, as of 8 weeks ago ──────────────── */
  const [pro] = await db
    .insert(professional)
    .values({ userId: proUserId, ...ALTINHA_PROFILE })
    .returning({ id: professional.id });
  const professionalId = pro.id;
  const catalog = await applyCatalog(db, professionalId, altinhaCatalog(todayKey(P, TZ)), P);
  const typeIds = catalog.typeIds;
  const [debutantsQuestion] = await loadQuestions(db, { eventId: catalog.eventIds.debutants });
  const [objectiveQuestion] = await loadQuestions(db, { ticketTypeId: typeIds.particulier });
  if (!debutantsQuestion || !objectiveQuestion) throw new Error("Questions du catalogue introuvables");
  const debutants = await seancesOf(catalog.eventIds.debutants);
  const debutantsUpcoming = firstFrom(debutants, at(1, 0), "débutants");

  /** E9 + E10 (mock payment): the tickets of one paid purchase. */
  async function buy(customerId: string, offerId: string, paidAt: Date): Promise<string[]> {
    const started = expectOk("achat", await startPurchase(db, { professionalId, offerId, customerId }, paidAt));
    const paid = await fulfillPurchase(
      db,
      started.purchaseId,
      { sessionId: null, paymentIntentId: null, livemode: false },
      plusMinutes(paidAt, 2),
    );
    if (paid.outcome !== "fulfilled") throw new Error(`Paiement ${started.purchaseId} : ${paid.outcome}`);
    return paid.ticketIds;
  }

  /* ── 3. Customers ────────────────────────────────────────────── */
  const { customerId: beatriz } = await upsertCustomer(
    db,
    {
      professionalId,
      email: "beatriz@example.com",
      name: "Beatriz Almeida",
      phone: "+33 6 11 22 33 44",
      userId: beatrizUserId,
    },
    P,
  );
  const newCustomer = async (name: string, email: string, now: Date): Promise<string> =>
    expectOk(`client ${email}`, await createCustomer(db, { professionalId, name, email }, now)).customerId;
  const rafael = await newCustomer("Rafael Souza", "rafael@example.com", at(-120, 590));
  const thomas = await newCustomer("Thomas Leroy", "thomas@example.com", at(-53, 590));
  const lea = await newCustomer("Léa Martin", "lea@example.com", at(-51, 590));
  const marina = await newCustomer("Marina Costa", "marina@example.com", T);

  /* ── 4. Beatriz: carnet of 10, 3 past classes, pointed, converted, RDV, cancelled séance ── */
  await buy(beatriz, offerOf(catalog, "collectif", 2), at(-55, 600));
  const beatrizPast = debutants.filter((o) => o.startsAt >= at(-53, 0) && o.startsAt < T).slice(0, 3);
  if (beatrizPast.length < 3) throw new Error("Pas assez de séances débutants passées");
  for (const [i, o] of beatrizPast.entries()) {
    expectOk(
      "Beatriz, séance passée",
      await bookWithHeldTicket(
        db,
        {
          professionalId,
          occurrenceId: o.id,
          customerId: beatriz,
          seenStartsAt: o.startsAt,
          actorUserId: beatrizUserId,
          answers: [{ questionId: debutantsQuestion.id, value: "Oui" }],
          customerNotes: i === 0 ? "Bora! Tô amando as aulas 🙌" : null,
        },
        plusMinutes(o.startsAt, -2 * 24 * 60),
      ),
    );
  }
  expectOk(
    "Beatriz, pointage",
    await pointTickets(
      db,
      {
        professionalId,
        actorUserId: proUserId,
        customerId: beatriz,
        selection: { ticketTypeId: typeIds.collectif, quantity: 1 },
        note: "Cours rattrapé au parc",
      },
      at(-36, 600),
    ),
  );
  expectOk(
    "Beatriz, conversion",
    await convertTickets(
      db,
      {
        professionalId,
        actorUserId: proUserId,
        customerId: beatriz,
        selection: { ticketTypeId: typeIds.collectif, quantity: 1 },
        toTicketTypeId: typeIds.particulier,
      },
      at(-26, 600),
    ),
  );
  expectOk(
    "Beatriz, cours particulier",
    await bookRdv(
      db,
      {
        professionalId,
        ticketTypeId: typeIds.particulier,
        startsAt: instantAt(dayFrom(5, [1, 2, 3, 4, 5, 6]), 660, TZ),
        customerId: beatriz,
        answers: [{ questionId: objectiveQuestion.id, value: "Tenir 50 touches sans faire tomber la balle" }],
        actorUserId: beatrizUserId,
        mode: "held_ticket",
      },
      T,
    ),
  );
  const intermediaires = firstFrom(await seancesOf(catalog.eventIds.intermediaires), at(1, 0), "intermédiaires");
  expectOk(
    "Beatriz, intermédiaires",
    await bookWithHeldTicket(
      db,
      {
        professionalId,
        occurrenceId: intermediaires.id,
        customerId: beatriz,
        seenStartsAt: intermediaires.startsAt,
        actorUserId: beatrizUserId,
      },
      T,
    ),
  );
  expectOk(
    "séance annulée",
    await cancelOccurrence(db, { professionalId, actorUserId: proUserId, occurrenceId: intermediaires.id }, plusMinutes(T, 5)),
  );

  /* ── 5. Rafael: a carnet of 4 bought 4 months ago, expired unused ── */
  await buy(rafael, offerOf(catalog, "collectif", 1), at(-120, 600));

  /* ── 6. Thomas: a trial class, booked on the next débutants séance ── */
  await buy(thomas, offerOf(catalog, "essai", 0), at(-53, 600));
  expectOk(
    "Thomas, débutants",
    await bookWithHeldTicket(
      db,
      {
        professionalId,
        occurrenceId: debutantsUpcoming.id,
        customerId: thomas,
        seenStartsAt: debutantsUpcoming.startsAt,
        actorUserId: null,
        customerNotes: "Jamais joué, mais super curieux d'essayer !",
      },
      T,
    ),
  );

  /* ── 7. Marina: buy + book (T14 shape), one ticket closed, a free discovery call ── */
  const bought = expectOk(
    "Marina, achat + réservation",
    await startBuyAndBook(
      db,
      {
        professionalId,
        occurrenceId: debutantsUpcoming.id,
        customerId: marina,
        seenStartsAt: debutantsUpcoming.startsAt,
        offerId: offerOf(catalog, "collectif", 1),
        answers: [{ questionId: debutantsQuestion.id, value: "Non" }],
      },
      T,
    ),
  );
  const paid = await fulfillPurchase(
    db,
    bought.purchaseId,
    { sessionId: null, paymentIntentId: null, livemode: false },
    plusMinutes(T, 2),
  );
  if (paid.outcome !== "fulfilled" || !paid.bookingConfirmed) {
    throw new Error(`Marina : paiement ${paid.outcome}, inscription confirmée = ${paid.bookingConfirmed}`);
  }
  expectOk(
    "Marina, clôture",
    await closeTickets(
      db,
      {
        professionalId,
        actorUserId: proUserId,
        customerId: marina,
        selection: { ticketTypeId: typeIds.collectif, quantity: 1 },
        reason: "rembourse",
        note: "Remboursé en espèces",
      },
      plusMinutes(T, 3),
    ),
  );
  expectOk(
    "Marina, appel découverte",
    await bookRdv(
      db,
      {
        professionalId,
        ticketTypeId: typeIds.decouverte,
        startsAt: instantAt(dayFrom(6, [1, 2, 3, 4, 5]), 720, TZ),
        customerId: marina,
        actorUserId: null,
        mode: "free",
      },
      T,
    ),
  );

  /* ── 8. Léa: 2 trial tickets offered, registered by the pro, free roda ── */
  expectOk(
    "Léa, tickets offerts",
    await offerTickets(
      db,
      {
        professionalId,
        actorUserId: proUserId,
        customerId: lea,
        ticketTypeId: typeIds.essai,
        quantity: 2,
        expiresAt: null,
        reason: "Bienvenue chez Altinha Paris",
        notify: false,
      },
      at(-51, 600),
    ),
  );
  const leaSeance = debutants.find((o) => o.seriesDate !== null && o.seriesDate >= addDays(TODAY, -49));
  if (!leaSeance || leaSeance.startsAt >= T) throw new Error("Aucune séance débutants passée pour Léa");
  expectOk(
    "Léa, inscrite par le pro",
    await registerPro(
      db,
      { professionalId, actorUserId: proUserId, occurrenceId: leaSeance.id, customerId: lea, asGuest: false },
      plusMinutes(leaSeance.startsAt, 120),
    ),
  );
  const roda = firstFrom(await seancesOf(catalog.eventIds.roda), at(1, 0), "roda");
  expectOk(
    "Léa, roda",
    await registerFree(db, { professionalId, occurrenceId: roda.id, customerId: lea, seenStartsAt: roda.startsAt }, T),
  );

  /* ── 9. Alerts: 🔴 tickets of an archived type, 🟠 a type linked to nothing ── */
  const summer = expectOk(
    "type Stage d'été",
    await createTicketType(
      db,
      { professionalId, type: { name: "Stage d'été 2026", description: "Le stage intensif de juillet.", color: "#ef4444" } },
      at(-40, 600),
    ),
  ).ticketTypeId;
  expectOk(
    "Rafael, tickets du stage",
    await offerTickets(
      db,
      {
        professionalId,
        actorUserId: proUserId,
        customerId: rafael,
        ticketTypeId: summer,
        quantity: 2,
        expiresAt: null,
        reason: "Report du stage d'été",
        notify: false,
      },
      at(-40, 610),
    ),
  );
  expectOk(
    "archivage du stage",
    await setTicketTypeArchived(db, { professionalId, ticketTypeId: summer, archived: true }, at(-2, 600)),
  );
  const outdoor = expectOk(
    "type Cours en plein air",
    await createTicketType(db, { professionalId, type: { name: "Cours en plein air", color: "#84cc16" } }, at(-10, 600)),
  ).ticketTypeId;
  expectOk(
    "Thomas, ticket plein air",
    await offerTickets(
      db,
      {
        professionalId,
        actorUserId: proUserId,
        customerId: thomas,
        ticketTypeId: outdoor,
        quantity: 1,
        expiresAt: null,
        reason: "Geste commercial",
        notify: false,
      },
      at(-10, 610),
    ),
  );

  /* ── 10. A day off in 3 weeks, on a day nobody booked ── */
  const offDay = await dayWithoutBookings(professionalId, 21);
  expectOk(
    "indisponibilité",
    await createTimeOffWithConflicts(
      db,
      {
        professionalId,
        actorUserId: proUserId,
        startAt: instantAt(offDay, 0, TZ),
        endAt: instantAt(addDays(offDay, 1), 0, TZ),
        allDay: true,
        reason: "Vacances",
        seenOccurrenceIds: [],
        cancelBooked: false,
      },
      T,
    ),
  );

  /* ── 11. Today: nightly expiry, rolling horizon, invariants ── */
  const { expired } = await expireTickets(db, T);
  for (let i = 0; i < 5; i++) {
    if (expectOk("horizon", await ensureHorizon(db, professionalId, T)).complete) break;
  }
  const violations = await checkInvariants(db, { proId: professionalId });
  if (violations.length > 0) {
    throw new Error(
      `checkInvariants → ${violations.length}\n${violations.map((v) => `  ${v.invariant} ${v.rowId} ${v.detail}`).join("\n")}`,
    );
  }
  console.info(`✓ ${expired} ticket(s) expiré(s) ; checkInvariants → 0`);

  /* ── 12. Summary ── */
  console.info("\n✅ Seed terminé.\n");
  console.info(`Comptes de démonstration (mot de passe : ${PASSWORD}) :`);
  console.info("  • Admin  → admin@skedul.test");
  console.info("  • Pro    → pro@skedul.app");
  console.info("  • Client → beatriz@example.com");
  console.info(`\nPage publique : /${ALTINHA_PROFILE.slug}`);
  console.info("Back-office   : /dashboard\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Seed échoué :", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.cause) console.error(err.cause);
    process.exit(1);
  });
