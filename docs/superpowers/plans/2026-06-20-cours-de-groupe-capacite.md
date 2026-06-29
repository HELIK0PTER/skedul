# Cours de groupe / capacité par créneau — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire passer Skedul du 1:1 strict à des séances collectives à capacité N, avec « X places restantes », blocage atomique du dernier siège, questionnaire d'inscription par prestation, roster pro et notification e-mail au pro.

**Architecture:** Une séance est matérialisée dans une nouvelle table `session` (clé `(eventTypeId, startAt)`) qui porte un compteur `seatsRemaining`. Réserver un siège = un seul `INSERT … ON CONFLICT DO UPDATE … WHERE seats_remaining > 0` atomique (calque l'idiome de dépense de crédit, seul pattern sûr sous Neon HTTP sans transaction interactive). Le 1:1 devient le cas particulier capacité 1. Le calcul de créneaux devient « séance-aware » : une séance occupe le pro pour les autres prestations, mais ses propres sièges sont partagés.

**Tech Stack:** Next.js 16 (App Router, server actions `"use server"`), Drizzle ORM + Neon HTTP (`drizzle-orm/neon-http`), PostgreSQL, React 19, Tailwind v4, tests `node:test` lancés via `tsx --test`.

**Spec de référence:** [docs/superpowers/specs/2026-06-20-cours-de-groupe-capacite-design.md](../specs/2026-06-20-cours-de-groupe-capacite-design.md)

## Global Constraints

- **Branche de travail:** `feat/cours-de-groupe` (déjà créée, spec déjà commitée dessus).
- **Pas de transaction interactive** (driver `neon-http`) : toute garantie de concurrence passe par un `UPDATE`/upsert gardé atomique avec `RETURNING`, jamais par `SELECT … FOR UPDATE` ni `db.transaction`.
- **`pnpm typecheck` et `pnpm build` doivent rester verts** à la fin de chaque tâche.
- **Tests:** lancer un fichier avec `pnpm test <chemin>` (= `tsx --test <chemin>`). Framework = `node:test` + `node:assert/strict` (cf. `src/lib/availability.test.ts`). **Pas de vitest.**
- **Changement de schéma** → `pnpm db:generate` puis `pnpm db:migrate` (cible `DATABASE_URL`, branche Neon `development` en dev).
- **Langue:** tous les nouveaux libellés UI et e-mails en **français** (l'i18n est le P0 #2, hors périmètre ici).
- **Argent:** entiers en cents + `currency`, formatage via `formatMoney` (`@/lib/utils`).
- **1:1 = capacité 1** : `eventType.capacity` a pour défaut `1` ; aucune prestation existante ne doit changer de comportement.
- **`fulfillBooking` est idempotent** : ne pas casser cette propriété (les e-mails ne partent qu'une fois).

---

## File Structure

**Créés :**
- `src/lib/sessions.ts` — helpers DB atomiques `claimSeat` / `releaseSeat`.
- `src/lib/sessions.test.ts` — test d'intégration du claim/release (gated sur `DATABASE_URL`).
- `scripts/backfill-sessions.ts` — backfill des bookings existants vers des séances.

**Modifiés :**
- `src/lib/db/schema.ts` — table `session`, `eventType.capacity`, `booking.sessionId`, enum `question_type`, tables `question` + `booking_answer`, relations.
- `src/lib/availability.ts` — `computeSlots` devient séance-aware ; `Slot` porte `seatsRemaining` + `capacity`.
- `src/lib/availability.test.ts` — tests étendus pour la capacité.
- `src/lib/slots.ts` — `loadBookableSlots` / `isSlotAvailable` chargent les séances.
- `src/server/public.ts` — `bookWithPayment` / `bookWithCredit` claiment un siège + `sessionId` + réponses.
- `src/server/pro.ts` — `capacity` dans `saveEventType` ; CRUD questions.
- `src/server/queries.ts` — `getEventTypeQuestions`, `getProSessions`.
- `src/lib/payments.ts` — notif pro dans `fulfillBooking`.
- `src/lib/email.ts` — template `proNewBookingEmail`.
- `src/app/[slug]/book/[eventTypeId]/page.tsx` — passe sièges + questions à la UI.
- `src/components/public/booking-flow.tsx` — places restantes, complet, questionnaire, prix/pers.
- `src/components/dashboard/event-types-manager.tsx` — champ capacité + builder de questions.
- `src/app/dashboard/bookings/page.tsx` — roster groupé par séance.

---

## Task 1: Schéma — séances, capacité, questionnaire

**Files:**
- Modify: `src/lib/db/schema.ts`
- Generate: nouveau fichier sous `drizzle/` (via `pnpm db:generate`)

**Interfaces:**
- Produces: tables Drizzle `session`, `question`, `bookingAnswer` ; colonnes `eventType.capacity`, `booking.sessionId` ; enum `questionType`. Colonnes clés : `session.{id,professionalId,eventTypeId,startAt,endAt,capacity,seatsRemaining}`, `question.{id,eventTypeId,label,type,options,required,position}`, `bookingAnswer.{id,bookingId,questionId,questionLabel,value}`.

- [ ] **Step 1: Ajouter l'enum `question_type` près des autres enums**

Dans `src/lib/db/schema.ts`, après le bloc des enums existants (après `purchaseStatus`, ~ligne 43) :

```ts
export const questionType = pgEnum("question_type", ["text", "choice", "boolean"]);
```

- [ ] **Step 2: Ajouter `capacity` à `eventType`**

Dans la définition de `eventType` (`src/lib/db/schema.ts`), juste après `priceCents` (~ligne 154) :

```ts
    capacity: integer("capacity").default(1).notNull(),
```

- [ ] **Step 3: Ajouter la table `session`**

Après la table `eventType` et avant `availabilityRule` (~ligne 166), ajouter :

```ts
/** A materialised class session: the seat-counter that makes group capacity atomic. */
export const session = pgTable(
  "session",
  {
    id: id(),
    professionalId: text("professional_id")
      .notNull()
      .references(() => professional.id, { onDelete: "cascade" }),
    eventTypeId: text("event_type_id")
      .notNull()
      .references(() => eventType.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    seatsRemaining: integer("seats_remaining").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("session_event_start_unique").on(t.eventTypeId, t.startAt),
    index("session_pro_start_idx").on(t.professionalId, t.startAt),
  ],
);
```

- [ ] **Step 4: Ajouter `sessionId` à `booking`**

Dans la table `booking` (`src/lib/db/schema.ts`), après `eventTypeId` (~ligne 274) :

```ts
    sessionId: text("session_id").references(() => session.id, {
      onDelete: "restrict",
    }),
```

- [ ] **Step 5: Ajouter les tables `question` et `booking_answer`**

Après la table `timeOff` (~ligne 315), avant le bloc Relations :

```ts
/** A custom registration question attached to an event type. */
export const question = pgTable(
  "question",
  {
    id: id(),
    eventTypeId: text("event_type_id")
      .notNull()
      .references(() => eventType.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    type: questionType("type").notNull(),
    options: text("options").array(),
    required: boolean("required").default(false).notNull(),
    position: integer("position").default(0).notNull(),
    ...timestamps,
  },
  (t) => [index("question_event_type_idx").on(t.eventTypeId)],
);

/** A customer's answer to a question, snapshotted onto the booking. */
export const bookingAnswer = pgTable(
  "booking_answer",
  {
    id: id(),
    bookingId: text("booking_id")
      .notNull()
      .references(() => booking.id, { onDelete: "cascade" }),
    questionId: text("question_id").references(() => question.id, {
      onDelete: "set null",
    }),
    questionLabel: text("question_label").notNull(),
    value: text("value").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("booking_answer_unique").on(t.bookingId, t.questionId),
    index("booking_answer_booking_idx").on(t.bookingId),
  ],
);
```

- [ ] **Step 6: Ajouter les relations**

Dans le bloc Relations de `src/lib/db/schema.ts` :

- Ajouter à `eventTypeRelations` (dans le `many`) : `sessions: many(session)` et `questions: many(question)`.
- Ajouter à `bookingRelations` (dans le `one`) :

```ts
  session: one(session, {
    fields: [booking.sessionId],
    references: [session.id],
  }),
```

- Ajouter les nouvelles relations après `timeOffRelations` :

```ts
export const sessionRelations = relations(session, ({ one, many }) => ({
  professional: one(professional, {
    fields: [session.professionalId],
    references: [professional.id],
  }),
  eventType: one(eventType, {
    fields: [session.eventTypeId],
    references: [eventType.id],
  }),
  bookings: many(booking),
}));

export const questionRelations = relations(question, ({ one, many }) => ({
  eventType: one(eventType, {
    fields: [question.eventTypeId],
    references: [eventType.id],
  }),
  answers: many(bookingAnswer),
}));

export const bookingAnswerRelations = relations(bookingAnswer, ({ one }) => ({
  booking: one(booking, {
    fields: [bookingAnswer.bookingId],
    references: [booking.id],
  }),
  question: one(question, {
    fields: [bookingAnswer.questionId],
    references: [question.id],
  }),
}));
```

Ajouter aussi `sessions: many(session)` dans `professionalRelations`.

- [ ] **Step 7: Vérifier le typecheck**

Run: `pnpm typecheck`
Expected: PASS (aucune erreur). Si `text(...).array()` pose souci de type, c'est supporté par drizzle-orm 0.45 ; vérifier l'import de `integer`, `boolean`, `unique`, `index` déjà présents en tête de fichier.

- [ ] **Step 8: Générer la migration**

Run: `pnpm db:generate`
Expected: un nouveau fichier SQL sous `drizzle/` contenant `CREATE TABLE "session"`, `CREATE TABLE "question"`, `CREATE TABLE "booking_answer"`, `ALTER TABLE "event_type" ADD COLUMN "capacity"`, `ALTER TABLE "booking" ADD COLUMN "session_id"`, et `CREATE TYPE … "question_type"`.

- [ ] **Step 9: Appliquer la migration sur la branche dev**

Run: `pnpm db:migrate`
Expected: migration appliquée sans erreur sur la base pointée par `DATABASE_URL`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/db/schema.ts drizzle
git commit -m "feat(db): séances, capacité, questionnaire (schéma P0 #1)"
```

---

## Task 2: Backfill des bookings existants vers des séances

**Files:**
- Create: `scripts/backfill-sessions.ts`

**Interfaces:**
- Consumes: tables `session`, `booking`, `eventType` (Task 1).
- Produces: chaque booking futur `pending|confirmed` a un `sessionId` ; une séance `capacity=1, seatsRemaining=0` par booking 1:1 existant.

**Note de design:** chaque booking 1:1 existant occupait déjà tout son créneau → on crée une séance pleine (`seatsRemaining = 0`). Une séance par `(eventTypeId, startAt)` ; si deux bookings partageaient déjà un même `(eventTypeId, startAt)` (ne devrait pas arriver en 1:1), ils pointent vers la même séance et `seatsRemaining` reste 0.

- [ ] **Step 1: Écrire le script de backfill**

Create `scripts/backfill-sessions.ts` :

```ts
import "dotenv/config";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { booking, eventType, session } from "@/lib/db/schema";

async function main() {
  const now = new Date();
  const rows = await db
    .select({
      id: booking.id,
      professionalId: booking.professionalId,
      eventTypeId: booking.eventTypeId,
      startAt: booking.startAt,
      endAt: booking.endAt,
    })
    .from(booking)
    .where(
      and(
        isNull(booking.sessionId),
        inArray(booking.status, ["pending", "confirmed"]),
      ),
    );

  let created = 0;
  for (const b of rows) {
    if (b.startAt < now) continue; // on n'ouvre des séances que pour le futur

    // 1:1 existant → séance pleine (capacity 1, 0 siège restant)
    const [sess] = await db
      .insert(session)
      .values({
        professionalId: b.professionalId,
        eventTypeId: b.eventTypeId,
        startAt: b.startAt,
        endAt: b.endAt,
        capacity: 1,
        seatsRemaining: 0,
      })
      .onConflictDoNothing({
        target: [session.eventTypeId, session.startAt],
      })
      .returning({ id: session.id });

    // si conflit (séance déjà créée par un booking précédent), la récupérer
    const sessionId =
      sess?.id ??
      (
        await db
          .select({ id: session.id })
          .from(session)
          .where(
            and(
              eq(session.eventTypeId, b.eventTypeId),
              eq(session.startAt, b.startAt),
            ),
          )
          .limit(1)
      )[0]?.id;

    if (!sessionId) continue;
    await db.update(booking).set({ sessionId }).where(eq(booking.id, b.id));
    created++;
  }

  console.info(`Backfill terminé : ${created} booking(s) reliés à une séance.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Vérifier le typecheck**

Run: `pnpm typecheck`
Expected: PASS. (`onConflictDoNothing` est supporté par drizzle-orm.)

- [ ] **Step 3: Exécuter le backfill sur la branche dev**

Run: `pnpm tsx scripts/backfill-sessions.ts`
Expected: log `Backfill terminé : N booking(s) reliés à une séance.` sans erreur.

- [ ] **Step 4: Vérifier en base (sanity check)**

Run: `pnpm db:studio` (ou une requête SQL ad hoc)
Expected: chaque booking futur `pending|confirmed` a un `session_id` non nul ; les séances correspondantes ont `seats_remaining = 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-sessions.ts
git commit -m "feat(db): script de backfill des séances pour les bookings existants"
```

---

## Task 3: `computeSlots` séance-aware (pur, TDD)

**Files:**
- Modify: `src/lib/availability.ts`
- Test: `src/lib/availability.test.ts`

**Interfaces:**
- Produces:
  - `interface Slot { start: Date; end: Date; seatsRemaining: number; capacity: number }`
  - `interface SessionInfo { eventTypeId: string; startMs: number; endMs: number; seatsRemaining: number; capacity: number }`
  - `computeSlots(args)` où `args` gagne `eventTypeId: string`, `defaultCapacity: number`, `sessions: SessionInfo[]`, et `busy` ne contient plus que les `timeOff` (intervalles d'indispo). Règle : un slot candidat `(eventTypeId, T)` est bloqué si un `timeOff` chevauche **ou** si une séance d'un autre `(eventTypeId, startMs)` chevauche `[T-bufferBefore, fin+bufferAfter]`. La séance exactement à `(eventTypeId, T)` ne bloque pas : elle fixe `seatsRemaining`/`capacity`, et le slot disparaît seulement si `seatsRemaining <= 0`.

- [ ] **Step 1: Écrire les tests qui échouent**

Remplacer le contenu de `src/lib/availability.test.ts` par (conserve les 2 cas existants, en ajoutant les nouveaux champs d'API et 3 cas capacité) :

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { computeSlots } from "./availability";

const TZ = "Europe/Paris";
// Fixed "now": Wed 2026-07-01 06:00 UTC (08:00 Paris)
const NOW = new Date("2026-07-01T06:00:00.000Z");
const EVT = "evt_1";

const rules = [
  { dayOfWeek: 5, startMinute: 540, endMinute: 660 }, // Friday 09:00–11:00
];

// Friday 2026-07-03 09:00 Paris = 07:00 UTC
const FRI_0900 = new Date("2026-07-03T07:00:00.000Z");

function base(overrides = {}) {
  return {
    rules,
    busy: [],
    sessions: [],
    eventTypeId: EVT,
    defaultCapacity: 1,
    durationMinutes: 60,
    timezone: TZ,
    daysAhead: 14,
    now: NOW,
    ...overrides,
  };
}

test("an all-day time-off interval removes that day's slots", () => {
  const busy = [
    {
      startAt: new Date("2026-07-02T22:00:00.000Z"),
      endAt: new Date("2026-07-03T22:00:00.000Z"),
    },
  ];
  const slots = computeSlots(base({ busy }));
  const onFriday = slots.filter(
    (s) => s.start >= busy[0].startAt && s.start < busy[0].endAt,
  );
  assert.equal(onFriday.length, 0);
});

test("without time-off, the Friday slots exist", () => {
  const slots = computeSlots(base());
  const fri = slots.filter(
    (s) =>
      s.start >= new Date("2026-07-02T22:00:00.000Z") &&
      s.start < new Date("2026-07-03T22:00:00.000Z"),
  );
  assert.equal(fri.length, 2);
});

test("a fresh slot reports full capacity as seats remaining", () => {
  const slots = computeSlots(base({ defaultCapacity: 6 }));
  const s = slots.find((x) => x.start.getTime() === FRI_0900.getTime());
  assert.ok(s);
  assert.equal(s.seatsRemaining, 6);
  assert.equal(s.capacity, 6);
});

test("a partially-filled session is still bookable with its remaining seats", () => {
  const sessions = [
    {
      eventTypeId: EVT,
      startMs: FRI_0900.getTime(),
      endMs: FRI_0900.getTime() + 60 * 60_000,
      seatsRemaining: 2,
      capacity: 6,
    },
  ];
  const slots = computeSlots(base({ defaultCapacity: 6, sessions }));
  const s = slots.find((x) => x.start.getTime() === FRI_0900.getTime());
  assert.ok(s);
  assert.equal(s.seatsRemaining, 2);
  assert.equal(s.capacity, 6);
});

test("a full session removes its slot", () => {
  const sessions = [
    {
      eventTypeId: EVT,
      startMs: FRI_0900.getTime(),
      endMs: FRI_0900.getTime() + 60 * 60_000,
      seatsRemaining: 0,
      capacity: 6,
    },
  ];
  const slots = computeSlots(base({ defaultCapacity: 6, sessions }));
  const s = slots.find((x) => x.start.getTime() === FRI_0900.getTime());
  assert.equal(s, undefined);
});

test("a session of another event type blocks this event's overlapping slot", () => {
  const sessions = [
    {
      eventTypeId: "evt_other",
      startMs: FRI_0900.getTime(),
      endMs: FRI_0900.getTime() + 60 * 60_000,
      seatsRemaining: 3,
      capacity: 6,
    },
  ];
  const slots = computeSlots(base({ defaultCapacity: 6, sessions }));
  const s = slots.find((x) => x.start.getTime() === FRI_0900.getTime());
  assert.equal(s, undefined);
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm test src/lib/availability.test.ts`
Expected: FAIL (la signature `computeSlots` ne connaît pas encore `sessions`/`eventTypeId`/`defaultCapacity` et `Slot` n'a pas `seatsRemaining`).

- [ ] **Step 3: Réécrire `computeSlots` (et les interfaces) dans `src/lib/availability.ts`**

Remplacer le haut du fichier (interfaces + `computeSlots`) par :

```ts
import { dayKeyInTz, instantFromWallClock } from "@/lib/datetime";

export interface Rule {
  dayOfWeek: number; // 0=Sunday … 6=Saturday
  startMinute: number;
  endMinute: number;
}

export interface BusyInterval {
  startAt: Date;
  endAt: Date;
}

export interface SessionInfo {
  eventTypeId: string;
  startMs: number;
  endMs: number;
  seatsRemaining: number;
  capacity: number;
}

export interface Slot {
  start: Date;
  end: Date;
  seatsRemaining: number;
  capacity: number;
}

interface ComputeArgs {
  rules: Rule[];
  busy: BusyInterval[]; // time-off only
  sessions: SessionInfo[]; // all of the pro's future sessions
  eventTypeId: string; // the event type we are computing slots for
  defaultCapacity: number; // eventType.capacity (used when no session exists yet)
  durationMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  timezone: string;
  daysAhead?: number;
  now?: Date;
  /** smallest gap from now before a slot is bookable (minutes) */
  minNoticeMinutes?: number;
}

/** Computes bookable slots over the next `daysAhead` days, capacity-aware. */
export function computeSlots({
  rules,
  busy,
  sessions,
  eventTypeId,
  defaultCapacity,
  durationMinutes,
  bufferBeforeMinutes = 0,
  bufferAfterMinutes = 0,
  timezone,
  daysAhead = 21,
  now = new Date(),
  minNoticeMinutes = 60,
}: ComputeArgs): Slot[] {
  const slots: Slot[] = [];
  const seen = new Set<number>();
  const earliest = now.getTime() + minNoticeMinutes * 60_000;
  const step = durationMinutes;

  for (let offset = 0; offset < daysAhead; offset++) {
    const baseDate = new Date(now.getTime() + offset * 86_400_000);
    const ymd = dayKeyInTz(baseDate, timezone); // YYYY-MM-DD (local to tz)
    const [year, month, day] = ymd.split("-").map(Number);
    const dow = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();

    for (const rule of rules) {
      if (rule.dayOfWeek !== dow) continue;
      for (
        let t = rule.startMinute;
        t + durationMinutes <= rule.endMinute;
        t += step
      ) {
        const start = instantFromWallClock(year, month, day, t, timezone);
        const startMs = start.getTime();
        if (startMs < earliest) continue;
        if (seen.has(startMs)) continue;

        const end = instantFromWallClock(
          year,
          month,
          day,
          t + durationMinutes,
          timezone,
        );

        const blockStart = startMs - bufferBeforeMinutes * 60_000;
        const blockEnd = end.getTime() + bufferAfterMinutes * 60_000;

        // time-off blocks
        const timeOffOverlap = busy.some(
          (b) =>
            b.startAt.getTime() < blockEnd && b.endAt.getTime() > blockStart,
        );
        if (timeOffOverlap) continue;

        // any OTHER session occupies the pro ("one class at a time")
        const otherSessionOverlap = sessions.some(
          (s) =>
            !(s.eventTypeId === eventTypeId && s.startMs === startMs) &&
            s.startMs < blockEnd &&
            s.endMs > blockStart,
        );
        if (otherSessionOverlap) continue;

        // the session exactly at this (eventType, start), if any
        const exact = sessions.find(
          (s) => s.eventTypeId === eventTypeId && s.startMs === startMs,
        );
        const seatsRemaining = exact ? exact.seatsRemaining : defaultCapacity;
        const capacity = exact ? exact.capacity : defaultCapacity;
        if (seatsRemaining <= 0) continue;

        seen.add(startMs);
        slots.push({ start, end, seatsRemaining, capacity });
      }
    }
  }

  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots;
}
```

`groupSlotsByDay` plus bas reste inchangé.

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `pnpm test src/lib/availability.test.ts`
Expected: PASS (tous les cas, dont les 4 nouveaux capacité).

- [ ] **Step 5: Commit**

```bash
git add src/lib/availability.ts src/lib/availability.test.ts
git commit -m "feat(slots): computeSlots séance-aware avec sièges restants"
```

---

## Task 4: `loadBookableSlots` / `isSlotAvailable` chargent les séances

**Files:**
- Modify: `src/lib/slots.ts`

**Interfaces:**
- Consumes: `computeSlots` (Task 3, signature `{ sessions, eventTypeId, defaultCapacity, busy=timeOff }`), table `session` (Task 1).
- Produces:
  - `loadBookableSlots(professionalId, timezone, evt, daysAhead?)` renvoie `Slot[]` (avec `seatsRemaining`/`capacity`). `evt` gagne le champ `capacity: number`.
  - `isSlotAvailable(professionalId, timezone, evt, startISO)` inchangé en signature, renvoie `true` si un slot avec siège dispo existe à `startISO`.

- [ ] **Step 1: Réécrire `src/lib/slots.ts`**

```ts
import "server-only";
import { and, eq, gte, isNull, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { availabilityRule, session, timeOff } from "@/lib/db/schema";
import { computeSlots, type Slot } from "@/lib/availability";

interface EventTypeLike {
  id: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  capacity: number;
}

/** Loads the bookable slots for a professional + event type over the next weeks. */
export async function loadBookableSlots(
  professionalId: string,
  timezone: string,
  evt: EventTypeLike,
  daysAhead = 21,
): Promise<Slot[]> {
  const now = new Date();

  const [allRules, sessions, busyTimeOff] = await Promise.all([
    db
      .select({
        eventTypeId: availabilityRule.eventTypeId,
        dayOfWeek: availabilityRule.dayOfWeek,
        startMinute: availabilityRule.startMinute,
        endMinute: availabilityRule.endMinute,
      })
      .from(availabilityRule)
      .where(
        and(
          eq(availabilityRule.professionalId, professionalId),
          or(
            isNull(availabilityRule.eventTypeId),
            eq(availabilityRule.eventTypeId, evt.id),
          ),
        ),
      ),
    db
      .select({
        eventTypeId: session.eventTypeId,
        startAt: session.startAt,
        endAt: session.endAt,
        seatsRemaining: session.seatsRemaining,
        capacity: session.capacity,
      })
      .from(session)
      .where(
        and(
          eq(session.professionalId, professionalId),
          gte(session.startAt, now),
        ),
      ),
    db
      .select({ startAt: timeOff.startAt, endAt: timeOff.endAt })
      .from(timeOff)
      .where(
        and(eq(timeOff.professionalId, professionalId), gte(timeOff.endAt, now)),
      ),
  ]);

  // Full replacement: if the event type has its own rules, ignore the global ones.
  const custom = allRules.filter((r) => r.eventTypeId === evt.id);
  const rules =
    custom.length > 0 ? custom : allRules.filter((r) => r.eventTypeId === null);

  return computeSlots({
    rules,
    busy: busyTimeOff,
    sessions: sessions.map((s) => ({
      eventTypeId: s.eventTypeId,
      startMs: s.startAt.getTime(),
      endMs: s.endAt.getTime(),
      seatsRemaining: s.seatsRemaining,
      capacity: s.capacity,
    })),
    eventTypeId: evt.id,
    defaultCapacity: evt.capacity,
    durationMinutes: evt.durationMinutes,
    bufferBeforeMinutes: evt.bufferBeforeMinutes,
    bufferAfterMinutes: evt.bufferAfterMinutes,
    timezone,
    daysAhead,
    now,
  });
}

/** Returns true if `startISO` is a currently bookable slot (seat available). */
export async function isSlotAvailable(
  professionalId: string,
  timezone: string,
  evt: EventTypeLike,
  startISO: string,
): Promise<boolean> {
  const slots = await loadBookableSlots(professionalId, timezone, evt);
  const target = new Date(startISO).getTime();
  return slots.some((s) => s.start.getTime() === target);
}
```

> Note : le chargement des règles réutilise **à l'identique** le `db.select(...).from(availabilityRule)` de l'ancien `slots.ts` (pattern éprouvé) ; seules les sources `sessions` (table `session`) et `busy` (timeOff seul) changent par rapport à l'original.

- [ ] **Step 2: Vérifier le typecheck**

Run: `pnpm typecheck`
Expected: PASS. Vérifier les imports `availabilityRule`, `session`, `timeOff` et `and, eq, gte, isNull, or`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/slots.ts
git commit -m "feat(slots): chargement des séances pour la dispo séance-aware"
```

---

## Task 5: Helpers atomiques `claimSeat` / `releaseSeat`

**Files:**
- Create: `src/lib/sessions.ts`
- Test: `src/lib/sessions.test.ts`

**Interfaces:**
- Consumes: table `session` (Task 1).
- Produces:
  - `claimSeat(args: { professionalId, eventTypeId, startAt: Date, endAt: Date, capacity: number }): Promise<{ ok: true; sessionId: string; seatsRemaining: number } | { ok: false }>` — réserve atomiquement un siège (upsert gardé). `ok:false` = séance complète.
  - `releaseSeat(sessionId: string): Promise<void>` — rend un siège (gardé `< capacity`).

- [ ] **Step 1: Écrire les helpers dans `src/lib/sessions.ts`**

```ts
import "server-only";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { session } from "@/lib/db/schema";

interface ClaimArgs {
  professionalId: string;
  eventTypeId: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
}

type ClaimResult =
  | { ok: true; sessionId: string; seatsRemaining: number }
  | { ok: false };

/**
 * Atomically claims one seat in the session at (eventTypeId, startAt).
 * Creates the session on first booking. Mirrors the guarded credit-spend
 * pattern — safe under Neon HTTP without an interactive transaction.
 */
export async function claimSeat(args: ClaimArgs): Promise<ClaimResult> {
  const claimed = await db
    .insert(session)
    .values({
      professionalId: args.professionalId,
      eventTypeId: args.eventTypeId,
      startAt: args.startAt,
      endAt: args.endAt,
      capacity: args.capacity,
      seatsRemaining: args.capacity - 1,
    })
    .onConflictDoUpdate({
      target: [session.eventTypeId, session.startAt],
      set: { seatsRemaining: sql`${session.seatsRemaining} - 1` },
      setWhere: sql`${session.seatsRemaining} > 0`,
    })
    .returning({
      id: session.id,
      seatsRemaining: session.seatsRemaining,
    });

  if (claimed.length === 0) return { ok: false };
  return {
    ok: true,
    sessionId: claimed[0].id,
    seatsRemaining: claimed[0].seatsRemaining,
  };
}

/** Returns one seat to a session (guarded so it never exceeds capacity). */
export async function releaseSeat(sessionId: string): Promise<void> {
  await db
    .update(session)
    .set({ seatsRemaining: sql`${session.seatsRemaining} + 1` })
    .where(
      sql`${session.id} = ${sessionId} AND ${session.seatsRemaining} < ${session.capacity}`,
    );
}
```

> Si TypeScript refuse `setWhere` sur `onConflictDoUpdate` (version de drizzle), remplacer l'appel par un `db.execute(sql\`INSERT INTO "session" (...) VALUES (...) ON CONFLICT ("event_type_id","start_at") DO UPDATE SET "seats_remaining" = "session"."seats_remaining" - 1 WHERE "session"."seats_remaining" > 0 RETURNING id, seats_remaining\`)` brut et lire `rows`.

- [ ] **Step 2: Écrire le test d'intégration (gated sur DATABASE_URL)**

Create `src/lib/sessions.test.ts` :

```ts
import test from "node:test";
import assert from "node:assert/strict";

// Integration test: requires a real DATABASE_URL (Neon dev branch).
// Skipped automatically when no DB is configured, to keep the offline suite green.
const HAS_DB = !!process.env.DATABASE_URL;

test(
  "claimSeat allocates exactly `capacity` seats then refuses the rest",
  { skip: !HAS_DB && "no DATABASE_URL" },
  async () => {
    const { db } = await import("@/lib/db");
    const { professional, user, eventType, session } = await import(
      "@/lib/db/schema"
    );
    const { claimSeat, releaseSeat } = await import("./sessions");
    const { eq } = await import("drizzle-orm");
    const { nanoid } = await import("nanoid");

    // minimal fixtures
    const uid = `test_${nanoid()}`;
    await db.insert(user).values({
      id: uid,
      name: "Test",
      email: `${uid}@test.local`,
    });
    const [pro] = await db
      .insert(professional)
      .values({ userId: uid, slug: `test-${nanoid()}`, businessName: "T" })
      .returning({ id: professional.id });
    const [evt] = await db
      .insert(eventType)
      .values({ professionalId: pro.id, title: "Groupe", slug: "g", capacity: 3 })
      .returning({ id: eventType.id });

    const start = new Date("2099-01-01T10:00:00.000Z");
    const end = new Date("2099-01-01T11:00:00.000Z");
    const claim = () =>
      claimSeat({
        professionalId: pro.id,
        eventTypeId: evt.id,
        startAt: start,
        endAt: end,
        capacity: 3,
      });

    const results = await Promise.all([claim(), claim(), claim(), claim()]);
    const okCount = results.filter((r) => r.ok).length;
    assert.equal(okCount, 3, "exactly capacity seats are granted");
    assert.equal(results.filter((r) => !r.ok).length, 1, "the 4th is refused");

    // release returns a seat
    const ok = results.find((r) => r.ok) as { ok: true; sessionId: string };
    await releaseSeat(ok.sessionId);
    const [s] = await db
      .select({ seatsRemaining: session.seatsRemaining })
      .from(session)
      .where(eq(session.id, ok.sessionId))
      .limit(1);
    assert.equal(s.seatsRemaining, 1);

    // cleanup
    await db.delete(professional).where(eq(professional.id, pro.id));
    await db.delete(user).where(eq(user.id, uid));
  },
);
```

- [ ] **Step 3: Lancer le test**

Run: `pnpm test src/lib/sessions.test.ts`
Expected (sans `DATABASE_URL`) : le test est **skipped** (suite verte). Avec `DATABASE_URL` pointant la branche dev : PASS (`okCount === 3`, 4e refusé, release rend 1 siège).

- [ ] **Step 4: Vérifier le typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sessions.ts src/lib/sessions.test.ts
git commit -m "feat(sessions): claim/release atomique des sièges"
```

---

## Task 6: `bookWithPayment` claime un siège

**Files:**
- Modify: `src/server/public.ts`

**Interfaces:**
- Consumes: `claimSeat` (Task 5), `loadEventType` (existant — sélectionne tout `eventType`, donc `capacity` inclus).
- Produces: `bookWithPayment(input)` inchangé en signature publique, mais crée la séance/siège et renseigne `booking.sessionId`.

- [ ] **Step 1: Importer `claimSeat`**

En tête de `src/server/public.ts`, ajouter à la liste d'imports :

```ts
import { claimSeat } from "@/lib/sessions";
```

- [ ] **Step 2: Insérer le claim dans `bookWithPayment`**

Dans `bookWithPayment`, **remplacer** le bloc qui va de `const cust = await getOrCreateCustomer(...)` jusqu'à l'insert du booking (`const [created] = await db.insert(booking)...returning();`) par :

```ts
  const cust = await getOrCreateCustomer(row.professional.id, input.customer);
  const start = new Date(input.startISO);
  const end = new Date(start.getTime() + row.eventType.durationMinutes * 60_000);
  const free = row.eventType.priceCents <= 0;

  const seat = await claimSeat({
    professionalId: row.professional.id,
    eventTypeId: row.eventType.id,
    startAt: start,
    endAt: end,
    capacity: row.eventType.capacity,
  });
  if (!seat.ok) return { ok: false, error: "Cette séance est complète." };

  const [created] = await db
    .insert(booking)
    .values({
      professionalId: row.professional.id,
      eventTypeId: row.eventType.id,
      customerId: cust.id,
      sessionId: seat.sessionId,
      startAt: start,
      endAt: end,
      status: free ? "confirmed" : "pending",
      paymentType: free ? "free" : "direct",
      amountPaidCents: free ? 0 : row.eventType.priceCents,
      customerNotes: input.notes ?? null,
    })
    .returning();
```

(Le reste de la fonction — branche `free` puis création du checkout — reste inchangé.)

- [ ] **Step 3: Vérifier le typecheck et le build**

Run: `pnpm typecheck`
Expected: PASS. `row.eventType.capacity` doit être reconnu (colonne ajoutée Task 1).

- [ ] **Step 4: Commit**

```bash
git add src/server/public.ts
git commit -m "feat(booking): claim d'un siège dans bookWithPayment"
```

---

## Task 7: `bookWithCredit` claime un siège (+ release si le crédit échoue)

**Files:**
- Modify: `src/server/public.ts`

**Interfaces:**
- Consumes: `claimSeat`, `releaseSeat` (Task 5).
- Produces: `bookWithCredit(input)` inchangé en signature, claime un siège **avant** la dépense de crédit et le **release** si la dépense échoue.

- [ ] **Step 1: Importer `releaseSeat`**

Compléter l'import des sessions en tête de `src/server/public.ts` :

```ts
import { claimSeat, releaseSeat } from "@/lib/sessions";
```

- [ ] **Step 2: Réordonner `bookWithCredit` : valider → claim siège → crédit → booking**

Dans `bookWithCredit`, **remplacer** tout le bloc depuis `const available = await isSlotAvailable(...)` (juste après la sélection du `purchaseId`) jusqu'à l'insert du booking inclus — **sans** la ligne `await fulfillBooking(created.id);` ni le `return` final, qui restent tels quels après le bloc — par :

```ts
  const available = await isSlotAvailable(
    row.professional.id,
    row.professional.timezone,
    row.eventType,
    input.startISO,
  );
  if (!available)
    return { ok: false, error: "Ce créneau n'est plus disponible." };

  const start = new Date(input.startISO);
  const end = new Date(start.getTime() + row.eventType.durationMinutes * 60_000);

  // 1) claim a seat atomically (authority against oversell)
  const seat = await claimSeat({
    professionalId: row.professional.id,
    eventTypeId: row.eventType.id,
    startAt: start,
    endAt: end,
    capacity: row.eventType.capacity,
  });
  if (!seat.ok) return { ok: false, error: "Cette séance est complète." };

  // 2) atomic credit decrement; if it fails, give the seat back
  const decremented = await db
    .update(packPurchase)
    .set({ creditsRemaining: sql`${packPurchase.creditsRemaining} - 1` })
    .where(
      and(eq(packPurchase.id, purchaseId), gt(packPurchase.creditsRemaining, 0)),
    )
    .returning({ id: packPurchase.id });

  if (decremented.length === 0) {
    await releaseSeat(seat.sessionId);
    return { ok: false, error: "Crédit indisponible, réessayez." };
  }

  // 3) create the booking
  const [created] = await db
    .insert(booking)
    .values({
      professionalId: row.professional.id,
      eventTypeId: row.eventType.id,
      customerId: cust.id,
      sessionId: seat.sessionId,
      startAt: start,
      endAt: end,
      status: "confirmed",
      paymentType: "credit",
      amountPaidCents: 0,
      packPurchaseId: purchaseId,
      customerNotes: input.notes ?? null,
    })
    .returning();
```

(La fin de la fonction — `await fulfillBooking(created.id);` puis `return { ok: true, ... }` — reste inchangée. Supprimer l'ancien bloc `decremented`/`start`/`end`/insert dupliqué pour ne pas le déclarer deux fois.)

- [ ] **Step 3: Vérifier le typecheck**

Run: `pnpm typecheck`
Expected: PASS. Vérifier qu'il ne reste pas de double déclaration de `start`/`end`/`decremented`.

- [ ] **Step 4: Commit**

```bash
git add src/server/public.ts
git commit -m "feat(booking): claim + rollback de siège dans bookWithCredit"
```

---

## Task 8: Capacité éditable + CRUD des questions (pro.ts + queries.ts)

**Files:**
- Modify: `src/server/pro.ts`
- Modify: `src/server/queries.ts`

**Interfaces:**
- Produces:
  - `saveEventType` accepte `capacity?: number` (≥ 1).
  - `saveQuestion(input: { id?: string; eventTypeId: string; label: string; type: "text"|"choice"|"boolean"; options?: string[]; required?: boolean; position?: number }): Promise<void>`
  - `deleteQuestion(id: string): Promise<void>`
  - `getEventTypeQuestions(eventTypeId: string)` → `{ id, label, type, options, required, position }[]` triées par `position`.

- [ ] **Step 1: Ajouter `capacity` à `saveEventType`**

Dans `src/server/pro.ts`, étendre le type d'input de `saveEventType` avec `capacity?: number;`, puis ajouter `capacity` dans les deux `.set({...})` (update) et `.values({...})` (insert) :

```ts
        capacity: Math.max(1, Math.floor(input.capacity ?? 1)),
```

(à placer à côté de `priceCents` dans les deux blocs).

- [ ] **Step 2: Ajouter les actions questions dans `pro.ts`**

Importer `question` depuis le schéma (ajouter à l'import existant `@/lib/db/schema`), puis ajouter en fin de fichier :

```ts
/* ─────────────────────────── Questions ─────────────────────────── */

export async function saveQuestion(input: {
  id?: string;
  eventTypeId: string;
  label: string;
  type: "text" | "choice" | "boolean";
  options?: string[];
  required?: boolean;
  position?: number;
}) {
  const pro = await requirePro();
  // ownership check: the event type must belong to this pro
  const owns = await db
    .select({ id: eventType.id })
    .from(eventType)
    .where(
      and(
        eq(eventType.id, input.eventTypeId),
        eq(eventType.professionalId, pro.id),
      ),
    )
    .limit(1);
  if (owns.length === 0) return;

  const options =
    input.type === "choice"
      ? (input.options ?? []).map((o) => o.trim()).filter(Boolean)
      : null;

  if (input.id) {
    await db
      .update(question)
      .set({
        label: input.label,
        type: input.type,
        options,
        required: input.required ?? false,
        position: input.position ?? 0,
      })
      .where(eq(question.id, input.id));
  } else {
    await db.insert(question).values({
      eventTypeId: input.eventTypeId,
      label: input.label,
      type: input.type,
      options,
      required: input.required ?? false,
      position: input.position ?? 0,
    });
  }
  revalidatePath("/dashboard/event-types");
}

export async function deleteQuestion(id: string) {
  const pro = await requirePro();
  // ownership via join on the pro's event types
  const owned = await db
    .select({ id: question.id })
    .from(question)
    .innerJoin(eventType, eq(eventType.id, question.eventTypeId))
    .where(and(eq(question.id, id), eq(eventType.professionalId, pro.id)))
    .limit(1);
  if (owned.length === 0) return;
  await db.delete(question).where(eq(question.id, id));
  revalidatePath("/dashboard/event-types");
}
```

- [ ] **Step 3: Ajouter `getEventTypeQuestions` dans `queries.ts`**

Importer `question` dans `src/server/queries.ts`, puis ajouter :

```ts
export function getEventTypeQuestions(eventTypeId: string) {
  return db
    .select({
      id: question.id,
      label: question.label,
      type: question.type,
      options: question.options,
      required: question.required,
      position: question.position,
    })
    .from(question)
    .where(eq(question.eventTypeId, eventTypeId))
    .orderBy(asc(question.position), asc(question.createdAt));
}
```

- [ ] **Step 4: Vérifier le typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/pro.ts src/server/queries.ts
git commit -m "feat(pro): capacité éditable + CRUD des questions d'inscription"
```

---

## Task 9: Réponses au questionnaire dans les actions de booking

**Files:**
- Modify: `src/server/public.ts`

**Interfaces:**
- Consumes: tables `question`, `bookingAnswer` (Task 1).
- Produces: `bookWithPayment` et `bookWithCredit` acceptent `answers?: { questionId: string; value: string }[]` ; valident les questions `required` ; insèrent les réponses (avec snapshot du libellé) après création du booking.

- [ ] **Step 1: Ajouter un helper de réponses + validation dans `public.ts`**

Importer `question` et `bookingAnswer` dans l'import `@/lib/db/schema`, puis ajouter ce helper au-dessus de `bookWithPayment` :

```ts
/** Validates required questions and returns rows to insert into booking_answer. */
async function buildAnswers(
  eventTypeId: string,
  answers: { questionId: string; value: string }[] | undefined,
): Promise<
  | { ok: true; rows: { questionId: string; questionLabel: string; value: string }[] }
  | { ok: false; error: string }
> {
  const questions = await db
    .select({
      id: question.id,
      label: question.label,
      required: question.required,
    })
    .from(question)
    .where(eq(question.eventTypeId, eventTypeId));

  if (questions.length === 0) return { ok: true, rows: [] };

  const byId = new Map(answers?.map((a) => [a.questionId, a.value.trim()]));
  const rows: { questionId: string; questionLabel: string; value: string }[] = [];
  for (const q of questions) {
    const value = byId.get(q.id) ?? "";
    if (q.required && !value)
      return { ok: false, error: `Merci de répondre à : ${q.label}` };
    if (value) rows.push({ questionId: q.id, questionLabel: q.label, value });
  }
  return { ok: true, rows };
}

async function insertAnswers(
  bookingId: string,
  rows: { questionId: string; questionLabel: string; value: string }[],
) {
  if (rows.length === 0) return;
  await db.insert(bookingAnswer).values(rows.map((r) => ({ bookingId, ...r })));
}
```

- [ ] **Step 2: Étendre les inputs des deux actions + brancher la validation**

Dans `bookWithPayment` et `bookWithCredit`, ajouter `answers?: { questionId: string; value: string }[];` à l'input. Dans chaque action, **avant le claim de siège**, ajouter :

```ts
  const answers = await buildAnswers(row.eventType.id, input.answers);
  if (!answers.ok) return { ok: false, error: answers.error };
```

Puis, **juste après** chaque `const [created] = await db.insert(booking)...returning();`, ajouter :

```ts
  await insertAnswers(created.id, answers.rows);
```

(Dans `bookWithPayment`, l'insert des réponses doit précéder le `fulfillBooking`/redirect ; dans la branche `free` aussi.)

- [ ] **Step 3: Vérifier le typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/public.ts
git commit -m "feat(booking): réponses au questionnaire (validation + snapshot)"
```

---

## Task 10: UI publique — places restantes, complet, questionnaire, prix/pers

**Files:**
- Modify: `src/app/[slug]/book/[eventTypeId]/page.tsx`
- Modify: `src/components/public/booking-flow.tsx`

**Interfaces:**
- Consumes: `loadBookableSlots` (slots avec `seatsRemaining`/`capacity`), `getEventTypeQuestions` (Task 8), actions de booking avec `answers` (Task 9).
- Produces: la page passe `seatsRemaining`/`capacity`/`questions` à `BookingFlow` ; le flux affiche les places, désactive les créneaux pleins, rend le questionnaire et envoie `answers`.

- [ ] **Step 1: Page — charger questions et enrichir les jours**

Dans `src/app/[slug]/book/[eventTypeId]/page.tsx` :

- Importer : `import { getPublicEventType, getEventTypeQuestions } from "@/server/queries";`
- Charger les questions en parallèle des slots :

```ts
  const [slots, questions] = await Promise.all([
    loadBookableSlots(professional.id, professional.timezone, eventType),
    getEventTypeQuestions(eventType.id),
  ]);
```

- Inclure les sièges dans chaque slot du mapping `days` :

```ts
      slots: g.slots.map((s) => ({
        iso: s.start.toISOString(),
        time: formatTime(s.start, professional.timezone),
        seatsRemaining: s.seatsRemaining,
        capacity: s.capacity,
      })),
```

- Passer `capacity` et `questions` à `BookingFlow` :

```tsx
      <BookingFlow
        professionalId={professional.id}
        eventType={{
          id: eventType.id,
          title: eventType.title,
          durationMinutes: eventType.durationMinutes,
          priceCents: eventType.priceCents,
          capacity: eventType.capacity,
        }}
        questions={questions}
        days={days}
      />
```

- [ ] **Step 2: `BookingFlow` — types, état des réponses, affichage des sièges, questionnaire**

Dans `src/components/public/booking-flow.tsx` :

- Étendre les interfaces :

```ts
interface Day {
  key: string;
  label: string;
  slots: { iso: string; time: string; seatsRemaining: number; capacity: number }[];
}

interface Question {
  id: string;
  label: string;
  type: "text" | "choice" | "boolean";
  options: string[] | null;
  required: boolean;
}

interface Props {
  professionalId: string;
  eventType: {
    id: string;
    title: string;
    durationMinutes: number;
    priceCents: number;
    capacity: number;
  };
  questions: Question[];
  days: Day[];
}
```

- Mettre à jour la signature : `export function BookingFlow({ professionalId, eventType, questions, days }: Props) {` et ajouter l'état des réponses :

```ts
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const isGroup = eventType.capacity > 1;
```

- Dans `submit`, construire et transmettre `answers` :

```ts
    const answerList = questions.map((q) => ({
      questionId: q.id,
      value: answers[q.id] ?? "",
    }));
    // ... dans startTransition, ajouter answers: answerList à l'objet passé à action(...)
```

c.-à-d. :

```ts
      const res = await action({
        eventTypeId: eventType.id,
        startISO: selectedIso,
        customer,
        notes,
        answers: answerList,
      });
```

- Rendu des créneaux (remplacer le bouton de slot dans la grille) pour montrer les places et bloquer les pleins :

```tsx
            {day?.slots.map((s) => {
              const full = s.seatsRemaining <= 0;
              return (
                <button
                  key={s.iso}
                  type="button"
                  disabled={full}
                  onClick={() => setSelectedIso(s.iso)}
                  className={cn(
                    "flex flex-col items-center rounded-xl border px-2 py-2 text-sm font-medium transition-colors",
                    full && "cursor-not-allowed opacity-40",
                    selectedIso === s.iso
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:border-primary hover:bg-accent",
                  )}
                >
                  {s.time}
                  {isGroup && (
                    <span className="text-[11px] font-normal opacity-80">
                      {full ? "Complet" : `${s.seatsRemaining} place${s.seatsRemaining > 1 ? "s" : ""}`}
                    </span>
                  )}
                </button>
              );
            })}
```

- Insérer le bloc questionnaire dans le `<form>`, juste après le champ `notes` :

```tsx
            {questions.map((q) => (
              <div key={q.id} className="space-y-1.5">
                <Label htmlFor={`q_${q.id}`}>
                  {q.label}
                  {q.required && <span className="text-destructive"> *</span>}
                </Label>
                {q.type === "text" && (
                  <Input
                    id={`q_${q.id}`}
                    value={answers[q.id] ?? ""}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                    }
                  />
                )}
                {q.type === "boolean" && (
                  <select
                    id={`q_${q.id}`}
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
                    value={answers[q.id] ?? ""}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                    }
                  >
                    <option value="">—</option>
                    <option value="Oui">Oui</option>
                    <option value="Non">Non</option>
                  </select>
                )}
                {q.type === "choice" && (
                  <select
                    id={`q_${q.id}`}
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
                    value={answers[q.id] ?? ""}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                    }
                  >
                    <option value="">—</option>
                    {(q.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
```

- Libellé prix « / personne » : dans le bouton de paiement, remplacer le label payant par :

```tsx
                {free
                  ? "Confirmer la réservation"
                  : `Payer ${formatMoney(eventType.priceCents)}${isGroup ? " / pers." : ""}`}
```

- [ ] **Step 3: Vérifier le typecheck et le build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS. La page de booking compile, `BookingFlow` reçoit `questions`/`capacity`.

- [ ] **Step 4: Commit**

```bash
git add src/app/[slug]/book/[eventTypeId]/page.tsx src/components/public/booking-flow.tsx
git commit -m "feat(public): places restantes, questionnaire et prix par personne"
```

---

## Task 11: Builder pro — champ capacité + gestion des questions

**Files:**
- Modify: `src/components/dashboard/event-types-manager.tsx`
- Modify: `src/app/dashboard/event-types/page.tsx` (charger les questions par prestation)

**Interfaces:**
- Consumes: `saveEventType` (avec `capacity`), `saveQuestion`, `deleteQuestion`, `getEventTypeQuestions`.
- Produces: l'écran prestation expose un champ « Capacité » et une liste de questions (ajout/suppression).

> **Avant d'éditer :** lire `src/components/dashboard/event-types-manager.tsx` et `src/app/dashboard/event-types/page.tsx` en entier pour suivre les conventions du composant (state du formulaire, appel des server actions, primitives UI). Le composant gère déjà `saveEventType`/`deleteEventType` ; on s'aligne sur ce pattern.

- [ ] **Step 1: Page — fournir les questions au manager**

Dans `src/app/dashboard/event-types/page.tsx`, charger pour chaque prestation ses questions via `getEventTypeQuestions(evt.id)` (en parallèle avec `Promise.all`) et passer un map `questionsByEventType: Record<string, Question[]>` au composant `EventTypesManager`. Suivre la forme de données déjà passée à ce composant.

- [ ] **Step 2: Manager — champ Capacité dans le formulaire de prestation**

Dans le formulaire d'édition/création de prestation de `event-types-manager.tsx`, à côté du champ prix, ajouter un champ numérique « Capacité » (min 1), stocké dans le state du formulaire et envoyé dans l'appel `saveEventType({ ..., capacity })`. Légende : « 1 = rendez-vous individuel ; ≥ 2 = cours de groupe ».

```tsx
<div className="space-y-1.5">
  <Label htmlFor="capacity">Capacité</Label>
  <Input
    id="capacity"
    type="number"
    min={1}
    value={form.capacity}
    onChange={(e) => setForm((f) => ({ ...f, capacity: Number(e.target.value) }))}
  />
  <p className="text-xs text-muted-foreground">
    1 = rendez-vous individuel ; ≥ 2 = cours de groupe.
  </p>
</div>
```

(Initialiser `capacity` à `evt.capacity ?? 1` à l'ouverture du formulaire.)

- [ ] **Step 3: Manager — section « Questions d'inscription »**

Sous le formulaire de prestation (uniquement en édition d'une prestation existante, car `saveQuestion` requiert un `eventTypeId`), ajouter une sous-section listant `questionsByEventType[evt.id]` avec, par ligne : libellé, type, requis, et un bouton supprimer (appelle `deleteQuestion(id)`). Un mini-formulaire d'ajout (libellé + select type `text|choice|boolean` + cases `requis` + champ options si `choice`, séparées par des virgules) appelle :

```ts
await saveQuestion({
  eventTypeId: evt.id,
  label,
  type,
  options: type === "choice" ? optionsCsv.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
  required,
  position: questionsByEventType[evt.id]?.length ?? 0,
});
```

Wrapper les appels dans `useTransition` + `router.refresh()` comme les autres mutations du composant.

- [ ] **Step 4: Vérifier le typecheck et le build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/event-types-manager.tsx src/app/dashboard/event-types/page.tsx
git commit -m "feat(dashboard): capacité et builder de questions par prestation"
```

---

## Task 12: Roster pro — séances groupées, inscrits, réponses, surcharge de capacité

**Files:**
- Modify: `src/server/queries.ts`
- Modify: `src/server/pro.ts`
- Modify: `src/app/dashboard/bookings/page.tsx`

**Interfaces:**
- Consumes: tables `session`, `booking`, `customer`, `bookingAnswer`.
- Produces:
  - `getProSessions(proId)` → séances **à venir** de capacité > 1 avec `{ id, startAt, endAt, capacity, seatsRemaining, eventTitle, eventColor, attendees: { name, email, answers: { label, value }[] }[] }`.
  - `updateSessionCapacity(input: { sessionId: string; capacity: number }): Promise<void>` — surcharge la capacité d'**une** séance (décision spec « par prestation, surchargeable »), recalcule `seatsRemaining = max(0, newCapacity − inscrits)`, ne désinscrit jamais personne.

> **Avant d'éditer la page :** lire `src/app/dashboard/bookings/page.tsx` en entier pour suivre son rendu actuel (il consomme `getProBookings`). On **ajoute** une section « Séances de groupe » au-dessus de la liste existante, sans casser l'affichage 1:1.

- [ ] **Step 1: `getProSessions` dans `queries.ts`**

Importer `session` et `bookingAnswer`. Ajouter :

```ts
export async function getProSessions(proId: string) {
  const now = new Date();
  const sessions = await db
    .select({
      id: session.id,
      startAt: session.startAt,
      endAt: session.endAt,
      capacity: session.capacity,
      seatsRemaining: session.seatsRemaining,
      eventTitle: eventType.title,
      eventColor: eventType.color,
    })
    .from(session)
    .innerJoin(eventType, eq(eventType.id, session.eventTypeId))
    .where(
      and(
        eq(session.professionalId, proId),
        gte(session.startAt, now),
        gt(session.capacity, 1),
      ),
    )
    .orderBy(asc(session.startAt));

  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);
  const rows = await db
    .select({
      sessionId: booking.sessionId,
      bookingId: booking.id,
      name: customer.name,
      email: customer.email,
      status: booking.status,
    })
    .from(booking)
    .innerJoin(customer, eq(customer.id, booking.customerId))
    .where(
      and(
        inArray(booking.sessionId, sessionIds),
        inArray(booking.status, ["pending", "confirmed"]),
      ),
    );

  const bookingIds = rows.map((r) => r.bookingId);
  const answerRows = bookingIds.length
    ? await db
        .select({
          bookingId: bookingAnswer.bookingId,
          label: bookingAnswer.questionLabel,
          value: bookingAnswer.value,
        })
        .from(bookingAnswer)
        .where(inArray(bookingAnswer.bookingId, bookingIds))
    : [];

  const answersByBooking = new Map<string, { label: string; value: string }[]>();
  for (const a of answerRows) {
    const arr = answersByBooking.get(a.bookingId) ?? [];
    arr.push({ label: a.label, value: a.value });
    answersByBooking.set(a.bookingId, arr);
  }

  return sessions.map((s) => ({
    ...s,
    attendees: rows
      .filter((r) => r.sessionId === s.id)
      .map((r) => ({
        name: r.name,
        email: r.email,
        answers: answersByBooking.get(r.bookingId) ?? [],
      })),
  }));
}
```

(Vérifier que `gt`, `inArray`, `asc`, `gte` sont importés en tête de `queries.ts` — `gt` est à ajouter.)

- [ ] **Step 2: Action `updateSessionCapacity` dans `pro.ts`**

Importer `session` (schéma) et `sql` (drizzle) dans `src/server/pro.ts`, puis ajouter :

```ts
/* ─────────────────────────── Séances ───────────────────────────── */

export async function updateSessionCapacity(input: {
  sessionId: string;
  capacity: number;
}) {
  const pro = await requirePro();
  const next = Math.max(1, Math.floor(input.capacity));
  // booked = capacity - seatsRemaining ; new seatsRemaining = max(0, next - booked).
  // Guarded by professionalId so a pro can only touch their own sessions.
  await db
    .update(session)
    .set({
      capacity: next,
      seatsRemaining: sql`GREATEST(0, ${next} - (${session.capacity} - ${session.seatsRemaining}))`,
    })
    .where(
      and(eq(session.id, input.sessionId), eq(session.professionalId, pro.id)),
    );
  revalidatePath("/dashboard/bookings");
}
```

- [ ] **Step 3: Page bookings — section « Séances de groupe » + surcharge de capacité**

Dans `src/app/dashboard/bookings/page.tsx`, charger `getProSessions(pro.id)` en parallèle de `getProBookings(pro.id)` et, au-dessus de la liste 1:1 existante, rendre une carte par séance avec : titre + date/heure (`formatSlot`), badge `inscrits/capacité` (= `capacity - seatsRemaining` / `capacity`), la liste des inscrits (nom, email, et leurs réponses `label: value`), et un petit contrôle d'édition de capacité (input numérique min 1) qui appelle `updateSessionCapacity({ sessionId, capacity })`. Réutiliser `Card`/`CardContent`, `Badge`, `formatSlot` (déjà importables). N'afficher la section que si `sessions.length > 0`. Le contrôle d'édition étant interactif, l'extraire dans un petit composant client (`"use client"`) qui enveloppe l'appel dans `useTransition` + `router.refresh()`, à l'image des autres mutations du dashboard.

- [ ] **Step 4: Vérifier le typecheck et le build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/queries.ts src/server/pro.ts src/app/dashboard/bookings/page.tsx
git commit -m "feat(dashboard): roster des séances de groupe + surcharge de capacité"
```

---

## Task 13: Notification e-mail au pro à chaque résa confirmée

**Files:**
- Modify: `src/lib/email.ts`
- Modify: `src/lib/payments.ts`

**Interfaces:**
- Consumes: `sendEmail`, `layout` (existants), table `session`, `user`.
- Produces: `proNewBookingEmail(args)` ; `fulfillBooking` envoie un e-mail au pro (en plus de la confirmation client), une seule fois (idempotence préservée).

- [ ] **Step 1: Template `proNewBookingEmail` dans `email.ts`**

Ajouter après `bookingConfirmationEmail` :

```ts
export function proNewBookingEmail(args: {
  businessName: string;
  eventTitle: string;
  whenLabel: string;
  customerName: string;
  customerEmail: string;
  fillLabel: string; // ex. "3/6 inscrits"
  paidLabel: string;
}) {
  return layout("Nouvelle réservation 📅", `
    <p>Bonjour ${args.businessName},</p>
    <p>Nouvelle réservation pour <strong>${args.eventTitle}</strong>.</p>
    <table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#71717a">Quand</td><td style="text-align:right">${args.whenLabel}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Client</td><td style="text-align:right">${args.customerName} (${args.customerEmail})</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Remplissage</td><td style="text-align:right">${args.fillLabel}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Paiement</td><td style="text-align:right">${args.paidLabel}</td></tr>
    </table>
  `);
}
```

- [ ] **Step 2: Envoyer la notif dans `fulfillBooking`**

Dans `src/lib/payments.ts` :

- Étendre l'import schéma : ajouter `session`, `user`.
- Importer le template : `proNewBookingEmail` (compléter l'import `@/lib/email`).
- Dans `fulfillBooking`, enrichir la requête `rows` pour récupérer l'e-mail du pro et la séance. Remplacer le `select` par un join supplémentaire :

```ts
  const rows = await db
    .select({
      booking: booking,
      eventType: eventType,
      customer: customer,
      professional: professional,
      proEmail: user.email,
      session: session,
    })
    .from(booking)
    .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
    .innerJoin(customer, eq(customer.id, booking.customerId))
    .innerJoin(professional, eq(professional.id, booking.professionalId))
    .innerJoin(user, eq(user.id, professional.userId))
    .leftJoin(session, eq(session.id, booking.sessionId))
    .where(eq(booking.id, bookingId))
    .limit(1);
```

- Après l'envoi de l'e-mail de confirmation client (toujours dans le `if (row.booking.status !== "confirmed")` — c.-à-d. après le `update` qui passe le statut à `confirmed`), ajouter l'envoi au pro :

```ts
  const cap = row.session?.capacity ?? 1;
  const filled = cap - (row.session?.seatsRemaining ?? 0);
  await sendEmail({
    to: row.proEmail,
    subject: `Nouvelle réservation — ${row.eventType.title}`,
    html: proNewBookingEmail({
      businessName: row.professional.businessName,
      eventTitle: row.eventType.title,
      whenLabel: formatSlot(
        row.booking.startAt,
        row.booking.endAt,
        row.professional.timezone,
      ),
      customerName: row.customer.name,
      customerEmail: row.customer.email,
      fillLabel: cap > 1 ? `${filled}/${cap} inscrits` : "Individuel",
      paidLabel:
        row.booking.amountPaidCents && row.booking.amountPaidCents > 0
          ? new Intl.NumberFormat("fr-FR", {
              style: "currency",
              currency: "EUR",
            }).format(row.booking.amountPaidCents / 100)
          : "Crédit de pack",
    }),
  });
```

> L'idempotence est préservée : `fulfillBooking` sort tôt si `status === "confirmed"`, donc cette notif (comme la confirmation client) ne part qu'une fois.

- [ ] **Step 3: Vérifier le typecheck et le build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/email.ts src/lib/payments.ts
git commit -m "feat(email): notification au pro à chaque réservation confirmée"
```

---

## Task 14: Validation de bout en bout + mise à jour de la TODO

**Files:**
- Modify: `TODO.md` (cocher le #1)

- [ ] **Step 1: Suite de tests complète**

Run: `pnpm test src/lib/availability.test.ts && pnpm test src/lib/timeoff.test.ts`
Expected: PASS. (Lancer aussi `pnpm test src/lib/sessions.test.ts` ; skipped sans `DATABASE_URL`, PASS avec.)

- [ ] **Step 2: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS, sans warning bloquant.

- [ ] **Step 3: Test manuel guidé (dev) — checklist**

Démarrer `pnpm dev`, se connecter avec le compte démo (`pro@skedul.app` / `password123`) puis :
1. Créer/éditer une prestation « Cours groupe » à capacité 3 + 1 question requise (choix : Débutant/Inter/Avancé).
2. Sur la page publique `/studio-camille`, réserver 3 fois ce créneau (e-mails différents) → la 3e doit afficher « 1 place » puis « Complet » ; une 4e tentative est refusée (« Cette séance est complète. »).
3. La question requise non remplie bloque la réservation.
4. Le dashboard `/dashboard/bookings` montre la séance avec `3/3 inscrits` et leurs réponses.
5. En mode mock e-mail (`RESEND_ENABLED=false`), la console logue une notif pro à chaque résa.
6. Une prestation laissée à capacité 1 se comporte exactement comme avant (1 résa ferme le créneau).

- [ ] **Step 4: Cocher le P0 #1 dans la TODO**

Dans `TODO.md`, passer la case du **#1** à `- [x]` (Cours de groupe / capacité par créneau).

- [ ] **Step 5: Commit**

```bash
git add TODO.md
git commit -m "chore(todo): P0 #1 cours de groupe livré"
```

---

## Notes de mise en œuvre

- **Dette préexistante (hors périmètre) :** un booking `pending` (checkout Stripe abandonné) tient son siège jusqu'à abandon manuel. Le comportement n'est pas aggravé (un `pending` bloquait déjà le créneau en 1:1). Follow-up possible : expiration des `pending` + `releaseSeat` à l'annulation de checkout (lié au TODO #13).
- **Annulation :** `releaseSeat` existe et est déjà câblé dans le rollback crédit ; son branchement sur un futur flux d'annulation client/pro relève du TODO #13.
- **Ordre des tâches :** 1→2 (socle), puis 3→4→5 (moteur), 6→7 (flux paiement/crédit), 8→9 (questionnaire backend), 10→11 (UI), 12 (roster), 13 (notif), 14 (validation). Chaque tâche se termine verte et commitée.
