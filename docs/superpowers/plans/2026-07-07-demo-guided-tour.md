# Demo Guided Tour (`/demo`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/demo` page — a 12-step scripted product tour where a fake cursor plays every action (booking, pack purchase, credit booking, then the pro back-office) inside a fake browser frame, driven by Suivant/Précédent/autoplay — and repoint the landing's demo links to it.

**Architecture:** A declarative script (`demo-script.ts`) defines 12 steps whose timelines patch a single `DemoState`; entering step N composes all previous patches, so jumps are instant and deterministic. An orchestrator (`demo-tour.tsx`) plays timelines with chained `setTimeout`s, positions a fake cursor on `[data-demo=…]` targets, and renders one of 10 screen replicas inside a scaled 960×840 browser frame. Replicas copy the real screens' markup but are fully prop-driven (no server actions) and `inert`.

**Tech Stack:** Next.js 16 App Router (client components), Tailwind v4 (existing bespoke tokens), `date-fns` + locale `fr`, `lucide-react`, pure CSS keyframes in `globals.css`, `node:test` via `pnpm test` for pure logic.

**Spec:** `docs/superpowers/specs/2026-07-07-demo-guided-tour-design.md`

## Global Constraints

- `pnpm typecheck` and `pnpm build` must stay green (AGENTS.md).
- **No new dependencies.**
- **No server coupling anywhere in the demo:** nothing under `src/app/demo/` or `src/components/demo/` may import `@/server/*`, `@/lib/env`, `@/lib/session`, `@/db/*`, or call `fetch`. Data is hardcoded in `demo-data.ts`.
- **No product component is modified.** Reused as-is (imports only): `DayCalendar`, `WeeklyHoursEditor` (+ its exported helpers `emptyByDay`/`toHHMM`), `Button`, `Card`/`CardContent`, `Badge`, `Input`, `Label`, `Logo`, `cn`, `formatMoney`, `THEME_PRESETS`, `brandThemeVars`, `toDayKey`/`parseDayKey`. The ONLY modified existing files are the three landing links (Task 14) and `globals.css` (Task 3, additions only).
- **Fixed frame geometry:** every screen replica must fit `960×840` design px (constants `FRAME_W`/`FRAME_H`). Replicas are compact adaptations of the real screens (smaller paddings, only the scenario's content) — visual fidelity of tokens/classes, not 1:1 completeness. Content overflowing 840px gets clipped — that is a bug.
- **All animation is pure CSS** gated behind `@media (prefers-reduced-motion: no-preference)` (repo convention); JS only orchestrates via `setTimeout`. With reduced motion, steps render their final state instantly.
- All copy is **French**; money via `formatMoney` (fr-FR EUR); dates via `date-fns` + `locale: fr`.
- Unit tests (`node:test`, colocated `*.test.ts`, run with `pnpm test`) cover pure logic only (`demo-data`, `demo-script`); screens are verified in the browser (Task 15).
- `Date.now`/`new Date()` are allowed (unlike some tooling contexts) — demo days derive from "today" so the tour never goes stale. Nothing date-dependent renders on the server for step 1 (profile screen has no dates), so there is no hydration mismatch.

---

### Task 1: Demo data (`demo-data.ts`)

**Files:**
- Create: `src/components/demo/demo-data.ts`
- Test: `src/components/demo/demo-data.test.ts`

**Interfaces:**
- Consumes: `toDayKey`, `parseDayKey` from `src/lib/calendar-grid.ts`; `addDays`, `startOfWeek`, `differenceInCalendarDays` from `date-fns`.
- Produces (used by demo-script, screens):
  - `DEMO_BRAND: { businessName: string; headline: string; brandColor: string }`
  - `DEMO_SERVICES: DemoService[]` — `DemoService = { id; title; description; durationMinutes; priceCents; color; capacity }`
  - `DEMO_PACK: { id; name; description; credits; priceCents; scope; sold }`
  - `DEMO_CLIENT: { name: string; email: string }`
  - `demoAvailableKeys(): string[]` — 8 bookable day-keys starting at J+2
  - `bookedDayKey(): string` (J+2), `creditDayKey(): string` (J+3)
  - `DEMO_SLOT_TIMES: string[]`, `BOOKED_TIME = "18:00"`, `CREDIT_TIME = "10:30"`, `BOOKED_RANGE = "18:00 – 19:00"`, `CREDIT_RANGE = "10:30 – 11:30"`
  - `planningWeekDays(): Date[]` — Mon→Sun week containing the booked day
  - `DemoSession = { id; dayIndex; startMinute; durationMinutes; title; color; subtitle }`
  - `DEMO_WEEK_SESSIONS: DemoSession[]`, `leaSession(): DemoSession`

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/demo/demo-data.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { addDays } from "date-fns";

import { toDayKey } from "../../lib/calendar-grid";
import {
  bookedDayKey,
  creditDayKey,
  demoAvailableKeys,
  leaSession,
  planningWeekDays,
} from "./demo-data";

test("demoAvailableKeys: 8 jours, le premier à J+2", () => {
  const keys = demoAvailableKeys();
  assert.equal(keys.length, 8);
  assert.equal(keys[0], toDayKey(addDays(new Date(), 2)));
});

test("bookedDayKey/creditDayKey: J+2 et J+3", () => {
  assert.equal(bookedDayKey(), toDayKey(addDays(new Date(), 2)));
  assert.equal(creditDayKey(), toDayKey(addDays(new Date(), 3)));
});

test("planningWeekDays: 7 jours, lundi en tête, contient le jour réservé", () => {
  const week = planningWeekDays();
  assert.equal(week.length, 7);
  assert.equal(week[0].getDay(), 1); // lundi
  assert.ok(week.map(toDayKey).includes(bookedDayKey()));
});

test("leaSession: positionnée sur le jour réservé à 18:00", () => {
  const s = leaSession();
  assert.ok(s.dayIndex >= 0 && s.dayIndex <= 6);
  assert.equal(toDayKey(planningWeekDays()[s.dayIndex]), bookedDayKey());
  assert.equal(s.startMinute, 18 * 60);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — cannot find module `./demo-data`.

- [ ] **Step 3: Write the implementation**

```ts
// src/components/demo/demo-data.ts
import { addDays, differenceInCalendarDays, startOfWeek } from "date-fns";

import { parseDayKey, toDayKey } from "@/lib/calendar-grid";

export interface DemoService {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
  color: string;
  capacity: number;
}

export const DEMO_BRAND = {
  businessName: "Altinha Paris",
  headline: "Altinha & footvolley — Canal Saint-Martin",
  brandColor: "#6d5cf6",
};

export const DEMO_SERVICES: DemoService[] = [
  {
    id: "decouverte",
    title: "Séance découverte",
    description: "Premier contact avec le ballon, tous niveaux.",
    durationMinutes: 60,
    priceCents: 2500,
    color: "#6d5cf6",
    capacity: 1,
  },
  {
    id: "collectif",
    title: "Cours collectif",
    description: "Jeu en cercle, 8 places par session.",
    durationMinutes: 90,
    priceCents: 1800,
    color: "#0ea5e9",
    capacity: 8,
  },
  {
    id: "coaching",
    title: "Coaching privé",
    description: "Technique individuelle, vidéo à l'appui.",
    durationMinutes: 60,
    priceCents: 4000,
    color: "#16a34a",
    capacity: 1,
  },
];

export const DEMO_PACK = {
  id: "pack-10h",
  name: "Pack 10 heures",
  description: "10 crédits à utiliser sur toutes les prestations.",
  credits: 10,
  priceCents: 20000,
  scope: "Toutes prestations",
  sold: 12,
};

export const DEMO_CLIENT = { name: "Léa Martin", email: "lea@exemple.com" };

/** Offsets (jours depuis aujourd'hui) des jours réservables — la démo reste d'actualité sans maintenance. */
const AVAILABLE_OFFSETS = [2, 3, 5, 7, 9, 12, 14, 16];

export function demoAvailableKeys(): string[] {
  const today = new Date();
  return AVAILABLE_OFFSETS.map((o) => toDayKey(addDays(today, o)));
}

/** Jour de la 1re réservation (payée) : J+2. */
export function bookedDayKey(): string {
  return demoAvailableKeys()[0];
}

/** Jour de la réservation à crédit : J+3. */
export function creditDayKey(): string {
  return demoAvailableKeys()[1];
}

export const DEMO_SLOT_TIMES = ["09:00", "10:30", "12:00", "14:00", "16:30", "18:00"];
export const BOOKED_TIME = "18:00";
export const CREDIT_TIME = "10:30";
export const BOOKED_RANGE = "18:00 – 19:00";
export const CREDIT_RANGE = "10:30 – 11:30";

/** Les 7 jours (lundi → dimanche) affichés par le planning pro : la semaine du jour réservé. */
export function planningWeekDays(): Date[] {
  const monday = startOfWeek(parseDayKey(bookedDayKey()), { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export interface DemoSession {
  id: string;
  dayIndex: number; // 0 = lundi
  startMinute: number;
  durationMinutes: number;
  title: string;
  color: string;
  subtitle: string;
}

/** Séances déjà présentes dans le planning (hors résa de Léa). */
export const DEMO_WEEK_SESSIONS: DemoSession[] = [
  { id: "s1", dayIndex: 0, startMinute: 10 * 60, durationMinutes: 90, title: "Cours collectif", color: "#0ea5e9", subtitle: "5/8" },
  { id: "s2", dayIndex: 1, startMinute: 12 * 60, durationMinutes: 60, title: "Coaching privé", color: "#16a34a", subtitle: "Marc D." },
  { id: "s3", dayIndex: 3, startMinute: 18 * 60 + 30, durationMinutes: 90, title: "Cours collectif", color: "#0ea5e9", subtitle: "8/8" },
  { id: "s4", dayIndex: 4, startMinute: 9 * 60 + 30, durationMinutes: 60, title: "Séance découverte", color: "#6d5cf6", subtitle: "Noé P." },
];

/** La séance de Léa — apparaît dans le planning à l'étape 7. */
export function leaSession(): DemoSession {
  const monday = planningWeekDays()[0];
  const dayIndex = differenceInCalendarDays(parseDayKey(bookedDayKey()), monday);
  return {
    id: "lea",
    dayIndex,
    startMinute: 18 * 60,
    durationMinutes: 60,
    title: "Séance découverte",
    color: "#6d5cf6",
    subtitle: DEMO_CLIENT.name,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS (all demo-data tests green, existing tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/components/demo/demo-data.ts src/components/demo/demo-data.test.ts
git commit -m "feat(demo): fake Altinha Paris universe for the guided tour"
```

---

### Task 2: Scenario script and state machine (`demo-script.ts`)

**Files:**
- Create: `src/components/demo/demo-script.ts`
- Test: `src/components/demo/demo-script.test.ts`

**Interfaces:**
- Consumes: `bookedDayKey`, `creditDayKey`, `BOOKED_TIME`, `CREDIT_TIME`, `DEMO_CLIENT` from `./demo-data` (Task 1).
- Produces (used by demo-tour, tour-controls, screens):
  - `type ScreenId = "client-profile" | "client-booking" | "client-pack" | "client-confirmation" | "pro-planning" | "pro-event-types" | "pro-packs" | "pro-availability" | "pro-branding" | "outro"`
  - `interface DemoState { screen: ScreenId; url: string; bookingSelectedDay: string | null; bookingSelectedTime: string | null; formName: string; formEmail: string; paying: boolean; hasCredits: boolean; creditsRemaining: number; confirmation: "booking-paid" | "pack" | "booking-credit" | null; planningHasLea: boolean; eventTypeFormOpen: boolean; packFormOpen: boolean; saturdayEnabled: boolean; brandColor: string; headerLayout: "profil" | "vitrine" }`
  - `type Patch = Partial<DemoState>`
  - `type TargetFinder = (frame: HTMLElement) => HTMLElement | null`
  - `type DemoAction` (variants `move` / `click` / `type` / `apply` / `wait` — see code)
  - `interface DemoStep { id: string; chapter: "client" | "pro" | "outro"; title: string; description: string; enter?: Patch; timeline: DemoAction[] }`
  - `INITIAL_STATE: DemoState`, `DEMO_STEPS: DemoStep[]` (12 steps)
  - `endPatch(step: DemoStep): Patch`, `stateEntering(index: number): DemoState`, `stateAfter(index: number): DemoState`

Note vs spec: the spec sketches actions `move|click|type|wait`; we add a fifth, `apply` (patch without cursor), needed for beats like "payment settles then the confirmation screen appears". `screen`/`url` live inside `DemoState` (patched by actions), and each step's starting screen comes from its `enter` patch — this is the concrete form of the spec's "l'état initial de l'étape N = état 1 + tous les patches précédents".

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/demo/demo-script.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { DEMO_CLIENT } from "./demo-data";
import {
  DEMO_STEPS,
  INITIAL_STATE,
  stateAfter,
  stateEntering,
} from "./demo-script";

test("12 étapes, la dernière est l'outro", () => {
  assert.equal(DEMO_STEPS.length, 12);
  assert.equal(DEMO_STEPS[11].chapter, "outro");
  assert.equal(stateEntering(11).screen, "outro");
});

test("stateEntering(0) = état initial", () => {
  assert.deepEqual(stateEntering(0), INITIAL_STATE);
});

test("parcours client : payé → pack → crédit", () => {
  assert.equal(stateAfter(3).confirmation, "booking-paid"); // étape 4 (index 3)
  assert.equal(stateAfter(4).confirmation, "pack");
  assert.equal(stateAfter(4).creditsRemaining, 10);
  assert.equal(stateAfter(4).hasCredits, true);
  assert.equal(stateAfter(5).confirmation, "booking-credit");
  assert.equal(stateAfter(5).creditsRemaining, 9);
});

test("étape 6 : email reconnu dès l'entrée (bannière crédits visible)", () => {
  const s = stateEntering(5);
  assert.equal(s.formEmail, DEMO_CLIENT.email);
  assert.equal(s.hasCredits, true);
});

test("côté pro : chaque étape démarre sur le bon écran", () => {
  assert.equal(stateEntering(6).screen, "pro-planning");
  assert.equal(stateAfter(6).planningHasLea, true);
  assert.equal(stateAfter(7).eventTypeFormOpen, true);
  assert.equal(stateAfter(8).packFormOpen, true);
  assert.equal(stateAfter(9).saturdayEnabled, true);
  assert.equal(stateAfter(10).brandColor, "#0d9488");
  assert.equal(stateAfter(10).headerLayout, "vitrine");
});

test("`paying` n'est jamais vrai à l'entrée d'une étape", () => {
  for (let i = 0; i < DEMO_STEPS.length; i++) {
    assert.equal(stateEntering(i).paying, false, `étape ${i + 1}`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — cannot find module `./demo-script`.

- [ ] **Step 3: Write the implementation**

```ts
// src/components/demo/demo-script.ts
import {
  BOOKED_TIME,
  CREDIT_TIME,
  DEMO_CLIENT,
  bookedDayKey,
  creditDayKey,
} from "./demo-data";

export type ScreenId =
  | "client-profile"
  | "client-booking"
  | "client-pack"
  | "client-confirmation"
  | "pro-planning"
  | "pro-event-types"
  | "pro-packs"
  | "pro-availability"
  | "pro-branding"
  | "outro";

export interface DemoState {
  screen: ScreenId;
  url: string;
  bookingSelectedDay: string | null;
  bookingSelectedTime: string | null;
  formName: string;
  formEmail: string;
  paying: boolean;
  hasCredits: boolean;
  creditsRemaining: number;
  confirmation: "booking-paid" | "pack" | "booking-credit" | null;
  planningHasLea: boolean;
  eventTypeFormOpen: boolean;
  packFormOpen: boolean;
  saturdayEnabled: boolean;
  brandColor: string;
  headerLayout: "profil" | "vitrine";
}

export type Patch = Partial<DemoState>;
export type TextField = "formName" | "formEmail";
export type TargetFinder = (frame: HTMLElement) => HTMLElement | null;

export type DemoAction =
  | { type: "move"; target: string; find?: TargetFinder; delay?: number }
  | { type: "click"; target: string; find?: TargetFinder; patch?: Patch; delay?: number }
  | { type: "type"; target: string; field: TextField; text: string; delay?: number }
  | { type: "apply"; patch: Patch; delay?: number }
  | { type: "wait"; delay: number };

export interface DemoStep {
  id: string;
  chapter: "client" | "pro" | "outro";
  title: string;
  description: string;
  /** Patch appliqué à l'entrée de l'étape (changement d'écran, resets…). */
  enter?: Patch;
  timeline: DemoAction[];
}

const AT = "skedul.app/altinha-paris";
const DASH = "skedul.app/dashboard";

export const INITIAL_STATE: DemoState = {
  screen: "client-profile",
  url: AT,
  bookingSelectedDay: null,
  bookingSelectedTime: null,
  formName: "",
  formEmail: "",
  paying: false,
  hasCredits: false,
  creditsRemaining: 0,
  confirmation: null,
  planningHasLea: false,
  eventTypeFormOpen: false,
  packFormOpen: false,
  saturdayEnabled: false,
  brandColor: "#6d5cf6",
  headerLayout: "profil",
};

/**
 * Nième bouton de jour cliquable du calendrier (ordre chronologique).
 * Le 1er jour disponible est toujours le jour réservé (J+2), le 2e = J+3.
 * On filtre sur `.grid-cols-7` pour exclure les chevrons de navigation.
 */
function availableCalendarDay(nth: number): TargetFinder {
  return (frame) => {
    const grid = frame.querySelector('[data-demo="calendar"]');
    if (!grid) return null;
    const buttons = Array.from(
      grid.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ).filter((b) => b.closest(".grid-cols-7"));
    return buttons[nth] ?? null;
  };
}

/** Interrupteur du samedi dans le WeeklyHoursEditor (le libellé du jour est dans le bouton). */
const saturdayToggle: TargetFinder = (frame) =>
  Array.from(
    frame.querySelectorAll<HTMLButtonElement>('[data-demo="availability"] button'),
  ).find((b) => b.textContent?.includes("Samedi")) ?? null;

export const DEMO_STEPS: DemoStep[] = [
  {
    id: "profile",
    chapter: "client",
    title: "La page publique",
    description:
      "Chaque pro dispose d'une page de réservation à son image : prestations, packs d'heures, disponibilités en temps réel.",
    timeline: [
      { type: "move", target: "service-decouverte" },
      { type: "wait", delay: 600 },
      { type: "move", target: "pack-card" },
    ],
  },
  {
    id: "choose-service",
    chapter: "client",
    title: "Réserver une prestation",
    description: "Léa choisit la séance découverte : 60 minutes, 25 €.",
    timeline: [
      { type: "move", target: "service-decouverte-cta" },
      {
        type: "click",
        target: "service-decouverte-cta",
        patch: { screen: "client-booking", url: `${AT}/book/decouverte` },
      },
    ],
  },
  {
    id: "pick-slot",
    chapter: "client",
    title: "Choisir un créneau",
    description:
      "Le calendrier ne montre que les jours réellement disponibles, calculés depuis les horaires du pro.",
    timeline: [
      { type: "move", target: "calendar-day", find: availableCalendarDay(0) },
      {
        type: "click",
        target: "calendar-day",
        find: availableCalendarDay(0),
        patch: { bookingSelectedDay: bookedDayKey() },
      },
      { type: "move", target: `slot-${BOOKED_TIME}` },
      {
        type: "click",
        target: `slot-${BOOKED_TIME}`,
        patch: { bookingSelectedTime: BOOKED_TIME },
      },
    ],
  },
  {
    id: "pay",
    chapter: "client",
    title: "Confirmer et payer",
    description:
      "Nom, email, paiement sécurisé — la réservation est confirmée en quelques secondes.",
    timeline: [
      { type: "type", target: "field-name", field: "formName", text: DEMO_CLIENT.name },
      { type: "type", target: "field-email", field: "formEmail", text: DEMO_CLIENT.email },
      { type: "move", target: "pay-button" },
      { type: "click", target: "pay-button", patch: { paying: true }, delay: 1000 },
      {
        type: "apply",
        patch: {
          paying: false,
          screen: "client-confirmation",
          confirmation: "booking-paid",
          url: `${AT}/merci`,
        },
      },
    ],
  },
  {
    id: "buy-pack",
    chapter: "client",
    title: "Acheter un pack d'heures",
    description:
      "Le différenciateur Skedul : des carnets prépayés. Léa prend 10 heures d'un coup.",
    enter: {
      screen: "client-profile",
      url: AT,
      confirmation: null,
      formName: "",
      formEmail: "",
    },
    timeline: [
      { type: "move", target: "pack-buy" },
      {
        type: "click",
        target: "pack-buy",
        patch: { screen: "client-pack", url: `${AT}/pack/10h` },
      },
      { type: "type", target: "field-name", field: "formName", text: DEMO_CLIENT.name, delay: 150 },
      { type: "type", target: "field-email", field: "formEmail", text: DEMO_CLIENT.email, delay: 150 },
      { type: "move", target: "pack-pay" },
      { type: "click", target: "pack-pay", patch: { paying: true }, delay: 1000 },
      {
        type: "apply",
        patch: {
          paying: false,
          screen: "client-confirmation",
          confirmation: "pack",
          creditsRemaining: 10,
          hasCredits: true,
          url: `${AT}/merci`,
        },
      },
    ],
  },
  {
    id: "book-credit",
    chapter: "client",
    title: "Réserver avec un crédit",
    description:
      "Son email est reconnu : plus de paiement, la réservation se règle en un clic avec un crédit du pack.",
    enter: { formName: DEMO_CLIENT.name, formEmail: DEMO_CLIENT.email },
    timeline: [
      { type: "move", target: "book-with-credit" },
      {
        type: "click",
        target: "book-with-credit",
        patch: {
          screen: "client-booking",
          url: `${AT}/book/decouverte`,
          bookingSelectedDay: null,
          bookingSelectedTime: null,
        },
      },
      { type: "move", target: "calendar-day", find: availableCalendarDay(1) },
      {
        type: "click",
        target: "calendar-day",
        find: availableCalendarDay(1),
        patch: { bookingSelectedDay: creditDayKey() },
      },
      { type: "move", target: `slot-${CREDIT_TIME}` },
      {
        type: "click",
        target: `slot-${CREDIT_TIME}`,
        patch: { bookingSelectedTime: CREDIT_TIME },
      },
      { type: "move", target: "credit-button" },
      { type: "click", target: "credit-button", patch: { paying: true }, delay: 700 },
      {
        type: "apply",
        patch: {
          paying: false,
          screen: "client-confirmation",
          confirmation: "booking-credit",
          creditsRemaining: 9,
          url: `${AT}/merci`,
        },
      },
    ],
  },
  {
    id: "planning",
    chapter: "pro",
    title: "Le planning",
    description:
      "Côté pro, la réservation de Léa vient d'arriver — séances, cours de groupe et jauges, tout est là.",
    enter: { screen: "pro-planning", url: `${DASH}/planning` },
    timeline: [
      { type: "wait", delay: 600 },
      { type: "apply", patch: { planningHasLea: true }, delay: 400 },
      { type: "move", target: "session-lea" },
    ],
  },
  {
    id: "event-types",
    chapter: "pro",
    title: "Vos prestations",
    description:
      "Durée, prix, capacité, couleur : chaque prestation se configure en quelques champs.",
    enter: { screen: "pro-event-types", url: `${DASH}/event-types` },
    timeline: [
      { type: "move", target: "edit-service" },
      { type: "click", target: "edit-service", patch: { eventTypeFormOpen: true } },
    ],
  },
  {
    id: "packs",
    chapter: "pro",
    title: "Vos packs",
    description:
      "Créez des carnets de crédits — prix, nombre de séances, prestations couvertes. Ici : déjà 12 vendus.",
    enter: { screen: "pro-packs", url: `${DASH}/packs` },
    timeline: [
      { type: "move", target: "edit-pack" },
      { type: "click", target: "edit-pack", patch: { packFormOpen: true } },
    ],
  },
  {
    id: "availability",
    chapter: "pro",
    title: "Vos disponibilités",
    description:
      "Les créneaux proposés aux clients découlent de vos horaires récurrents. On ouvre le samedi matin ?",
    enter: { screen: "pro-availability", url: `${DASH}/availability` },
    timeline: [
      { type: "move", target: "saturday-toggle", find: saturdayToggle },
      {
        type: "click",
        target: "saturday-toggle",
        find: saturdayToggle,
        patch: { saturdayEnabled: true },
      },
    ],
  },
  {
    id: "branding",
    chapter: "pro",
    title: "Votre image",
    description:
      "Couleur, mise en page, avatar : la page publique se personnalise avec un aperçu en direct.",
    enter: { screen: "pro-branding", url: `${DASH}/settings` },
    timeline: [
      { type: "move", target: "swatch-turquoise" },
      { type: "click", target: "swatch-turquoise", patch: { brandColor: "#0d9488" } },
      { type: "wait", delay: 500 },
      { type: "move", target: "layout-vitrine" },
      { type: "click", target: "layout-vitrine", patch: { headerLayout: "vitrine" } },
    ],
  },
  {
    id: "outro",
    chapter: "outro",
    title: "À vous",
    description: "Créez votre page en quelques minutes — gratuit pour démarrer.",
    enter: { screen: "outro", url: "skedul.app" },
    timeline: [],
  },
];

/** Fusion de tous les patches d'une timeline (les saisies comptent comme leur texte final). */
export function endPatch(step: DemoStep): Patch {
  const merged: Patch = {};
  for (const a of step.timeline) {
    if ((a.type === "click" || a.type === "apply") && a.patch) Object.assign(merged, a.patch);
    if (a.type === "type") merged[a.field] = a.text;
  }
  return merged;
}

/** État au moment où l'étape `index` commence (son patch `enter` inclus). */
export function stateEntering(index: number): DemoState {
  let state: DemoState = { ...INITIAL_STATE };
  for (let i = 0; i < index; i++) {
    state = { ...state, ...DEMO_STEPS[i].enter, ...endPatch(DEMO_STEPS[i]) };
  }
  return { ...state, ...DEMO_STEPS[index]?.enter };
}

/** État final de l'étape `index` (toutes ses actions jouées). */
export function stateAfter(index: number): DemoState {
  return { ...stateEntering(index), ...endPatch(DEMO_STEPS[index]) };
}
```

Note: the `TargetFinder` functions touch the DOM but are never executed by the node tests (only by the browser runtime), so `pnpm test` runs fine without a DOM.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/demo/demo-script.ts src/components/demo/demo-script.test.ts
git commit -m "feat(demo): declarative 12-step tour script with composable state"
```

---

### Task 3: CSS keyframes + fake cursor

**Files:**
- Modify: `src/app/globals.css` (additions only — append near the existing `stamp`/`tap-hint` blocks)
- Create: `src/components/demo/demo-cursor.tsx`

**Interfaces:**
- Produces:
  - CSS classes `.demo-click` (cursor click ring), `.demo-url` (URL pill fade-in), `.demo-pop` (planning block pop, reuses the existing `stamp-in` keyframes).
  - `interface CursorState { x: number; y: number; visible: boolean; clickCount: number }`
  - `function DemoCursor(props: CursorState): JSX.Element` — consumed by demo-tour (Task 6).

- [ ] **Step 1: Add the keyframes to `globals.css`**

Append after the existing `tear-hint` block, following the repo's reduced-motion convention:

```css
/* --- Visite guidée /demo --- */
.demo-click {
  opacity: 0;
}
@media (prefers-reduced-motion: no-preference) {
  .demo-click {
    animation: demo-click 0.45s ease-out both;
  }
  .demo-url {
    animation: demo-url-in 0.3s ease-out both;
  }
  .demo-pop {
    animation: stamp-in 0.4s cubic-bezier(0.2, 1.6, 0.4, 1) both;
  }
}
@keyframes demo-click {
  from {
    opacity: 0.8;
    transform: scale(0.4);
  }
  to {
    opacity: 0;
    transform: scale(1.4);
  }
}
@keyframes demo-url-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

- [ ] **Step 2: Write the cursor component**

```tsx
// src/components/demo/demo-cursor.tsx
"use client";

import { MousePointer2 } from "lucide-react";

import { cn } from "@/lib/utils";

export interface CursorState {
  x: number;
  y: number;
  visible: boolean;
  /** Incrémenté à chaque clic — sert de `key` pour rejouer l'anneau de pulsation. */
  clickCount: number;
}

export function DemoCursor({ x, y, visible, clickCount }: CursorState) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-0 top-0 z-20 transition-transform duration-700 ease-[cubic-bezier(0.3,0.9,0.3,1)]",
        !visible && "opacity-0",
      )}
      style={{ transform: `translate3d(${x}px, ${y}px, 0)` }}
    >
      {clickCount > 0 && (
        <span
          key={clickCount}
          className="demo-click absolute -left-3 -top-3 size-8 rounded-full border-2 border-primary"
        />
      )}
      <MousePointer2 className="size-5 text-primary drop-shadow-md" fill="currentColor" />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css src/components/demo/demo-cursor.tsx
git commit -m "feat(demo): tour keyframes and animated fake cursor"
```

---

### Task 4: Browser frame with scale-to-fit

**Files:**
- Create: `src/components/demo/browser-frame.tsx`

**Interfaces:**
- Produces:
  - `FRAME_W = 960`, `FRAME_H = 840` (design px — every screen must fit).
  - `function BrowserFrame(props: { url: string; contentRef: RefObject<HTMLDivElement | null>; children: ReactNode }): JSX.Element`
  - The `contentRef` div is the **coordinate space** for cursor targeting: demo-tour computes positions relative to it, divided by its current scale.

- [ ] **Step 1: Write the component**

```tsx
// src/components/demo/browser-frame.tsx
"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

export const FRAME_W = 960;
export const FRAME_H = 840;

interface BrowserFrameProps {
  url: string;
  /** Réf du conteneur 960×840 mis à l'échelle — repère de coordonnées du curseur. */
  contentRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

export function BrowserFrame({ url, contentRef, children }: BrowserFrameProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(entry.contentRect.width / FRAME_W, 1));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-(--shadow-card)">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-muted-foreground/25" />
          <span className="size-2.5 rounded-full bg-muted-foreground/25" />
          <span className="size-2.5 rounded-full bg-muted-foreground/25" />
        </span>
        <span
          key={url}
          className="demo-url flex-1 truncate rounded-full bg-muted px-3 py-1 text-center font-mono text-xs text-muted-foreground"
        >
          {url}
        </span>
        <span className="w-8" />
      </div>
      <div ref={outerRef}>
        <div className="relative overflow-hidden" style={{ height: FRAME_H * scale }}>
          <div
            ref={contentRef}
            inert
            className="absolute left-0 top-0 overflow-hidden bg-background"
            style={{
              width: FRAME_W,
              height: FRAME_H,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
```

Notes:
- `inert` (React 19 boolean prop) makes the whole simulated content unfocusable and hidden from assistive tech, per the spec's accessibility section.
- `key={url}` re-mounts the URL pill so `.demo-url` replays its fade at each simulated navigation.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/demo/browser-frame.tsx
git commit -m "feat(demo): fake browser frame with URL pill and scale-to-fit"
```

---

### Task 5: Ticket-stub controls with stamp progress

**Files:**
- Create: `src/components/demo/tour-controls.tsx`

**Interfaces:**
- Consumes: `DemoStep` from `./demo-script` (Task 2); `Button` from `@/components/ui/button`; existing `.stamp` CSS class (stamp-in animation) and `bg-stamp` token.
- Produces:
  ```ts
  interface TourControlsProps {
    steps: DemoStep[];
    index: number;
    playing: boolean;
    onPrev: () => void;
    onNext: () => void;
    onJump: (i: number) => void;
    onTogglePlay: () => void;
  }
  export function TourControls(props: TourControlsProps): JSX.Element;
  ```
  Consumed by demo-tour (Task 6).

- [ ] **Step 1: Write the component**

```tsx
// src/components/demo/tour-controls.tsx
"use client";

import Link from "next/link";
import { ArrowRight, Check, ChevronLeft, Pause, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DemoStep } from "./demo-script";

const CHAPTER_LABELS = {
  client: "Côté client",
  pro: "Côté pro",
  outro: "Et maintenant ?",
} as const;

interface TourControlsProps {
  steps: DemoStep[];
  index: number;
  playing: boolean;
  onPrev: () => void;
  onNext: () => void;
  onJump: (i: number) => void;
  onTogglePlay: () => void;
}

export function TourControls({
  steps,
  index,
  playing,
  onPrev,
  onNext,
  onJump,
  onTogglePlay,
}: TourControlsProps) {
  const step = steps[index];
  const isLast = index === steps.length - 1;

  return (
    <div className="relative rounded-2xl border border-dashed border-border bg-card p-5 shadow-(--shadow-card)">
      <p className="font-mono text-[11px] uppercase tracking-widest text-primary">
        {CHAPTER_LABELS[step.chapter]} · étape {index + 1}/{steps.length}
      </p>
      <div aria-live="polite">
        <h2 className="mt-1 font-display text-xl font-bold tracking-tight">{step.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
      </div>

      {/* Carnet à tampons : une case par étape, tamponnée quand elle est franchie. */}
      <div className="mt-4 flex flex-wrap gap-1.5 border-t border-dashed border-border pt-4">
        {steps.map((s, i) => (
          <button
            key={s.id}
            type="button"
            aria-label={`Étape ${i + 1} : ${s.title}`}
            aria-current={i === index ? "step" : undefined}
            onClick={() => onJump(i)}
            className={cn(
              "grid size-7 cursor-pointer place-items-center rounded-full border text-[10px] font-medium transition-colors",
              i < index && "stamp border-transparent bg-stamp text-white",
              i === index && "border-primary font-semibold text-primary ring-2 ring-ring/40",
              i > index && "border-dashed border-border text-muted-foreground hover:border-primary",
            )}
          >
            {i < index ? <Check className="size-3.5" /> : i + 1}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onPrev} disabled={index === 0}>
          <ChevronLeft /> Précédent
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onTogglePlay}
          disabled={isLast}
          aria-label={playing ? "Mettre en pause" : "Lecture automatique"}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <span className="flex-1" />
        {isLast ? (
          <Button asChild>
            <Link href="/sign-up">
              Créer ma page <ArrowRight />
            </Link>
          </Button>
        ) : (
          <Button onClick={onNext}>
            Suivant <ArrowRight />
          </Button>
        )}
      </div>
    </div>
  );
}
```

Note: check `.stamp` in `globals.css` before relying on it — it must only carry the `stamp-in` animation (behind reduced-motion) plus benign base styles. If it carries hero-specific styling that clashes here, use `demo-pop` (Task 3) on the stamp buttons instead.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/demo/tour-controls.tsx
git commit -m "feat(demo): ticket-stub controls with stamped step progress"
```

---

### Task 6: Orchestrator, screen registry stubs, and `/demo` page

**Files:**
- Create: `src/components/demo/screens/index.tsx` (registry with temporary stubs)
- Create: `src/components/demo/demo-tour.tsx`
- Create: `src/app/demo/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces:
  - `interface ScreenProps { state: DemoState }` and `function DemoScreen({ state }: ScreenProps)` from `screens/index.tsx` — Tasks 7–13 replace each stub case with the real screen, keeping this signature.
  - `function DemoTour(): JSX.Element` (default tour orchestrator).
  - Route `/demo` renders it.

- [ ] **Step 1: Write the screen registry with stubs**

```tsx
// src/components/demo/screens/index.tsx
"use client";

import type { DemoState } from "../demo-script";

export interface ScreenProps {
  state: DemoState;
}

/* Les stubs ci-dessous sont remplacés écran par écran (Tâches 7 à 12).
   Chaque stub expose les cibles data-demo de son étape pour que le
   squelette du tour soit déjà navigable de bout en bout. */
function Stub({ label, targets }: { label: string; targets: string[] }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 font-mono text-sm text-muted-foreground">
      <p>{label}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {targets.map((t) => (
          <span key={t} data-demo={t} className="rounded-lg border border-dashed border-border px-3 py-2 text-xs">
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DemoScreen({ state }: ScreenProps) {
  switch (state.screen) {
    case "client-profile":
      return <Stub label="client-profile" targets={["service-decouverte", "service-decouverte-cta", "pack-card", "pack-buy"]} />;
    case "client-booking":
      return <Stub label="client-booking" targets={["calendar", "slot-18:00", "slot-10:30", "field-name", "field-email", "pay-button", "credit-button"]} />;
    case "client-pack":
      return <Stub label="client-pack" targets={["field-name", "field-email", "pack-pay"]} />;
    case "client-confirmation":
      return <Stub label={`client-confirmation (${state.confirmation})`} targets={["book-with-credit"]} />;
    case "pro-planning":
      return <Stub label="pro-planning" targets={["session-lea"]} />;
    case "pro-event-types":
      return <Stub label="pro-event-types" targets={["edit-service"]} />;
    case "pro-packs":
      return <Stub label="pro-packs" targets={["edit-pack"]} />;
    case "pro-availability":
      return <Stub label="pro-availability" targets={["availability", "saturday-toggle"]} />;
    case "pro-branding":
      return <Stub label="pro-branding" targets={["swatch-turquoise", "layout-vitrine"]} />;
    case "outro":
      return null; // rendu hors cadre par DemoTour
  }
}
```

(The `calendar`/`availability` stubs are plain targets here; the real screens give them the wrapper semantics the `find` helpers expect. The stub tour will simply show the cursor idling near them — fine for the skeleton check.)

- [ ] **Step 2: Write the orchestrator**

```tsx
// src/components/demo/demo-tour.tsx
"use client";

import { useEffect, useRef, useState } from "react";

import { BrowserFrame, FRAME_W } from "./browser-frame";
import { DemoCursor } from "./demo-cursor";
import {
  DEMO_STEPS,
  stateAfter,
  stateEntering,
  type DemoAction,
  type DemoState,
} from "./demo-script";
import { DemoScreen } from "./screens";
import { Outro } from "./screens/outro";
import { TourControls } from "./tour-controls";

const TYPE_MS = 45;

export function DemoTour() {
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<DemoState>(() => stateEntering(0));
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState({ x: FRAME_W / 2, y: 260, visible: false, clickCount: 0 });

  const contentRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const indexRef = useRef(index);
  indexRef.current = index;

  function clearTimers() {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }

  function schedule(fn: () => void, delay: number) {
    timersRef.current.push(setTimeout(fn, delay));
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** Coordonnées (en px de design, repère du cadre) du centre de la cible d'une action. */
  function locate(action: { target: string; find?: (f: HTMLElement) => HTMLElement | null }) {
    const frame = contentRef.current;
    if (!frame) return null;
    const el = action.find
      ? action.find(frame)
      : frame.querySelector<HTMLElement>(`[data-demo="${action.target}"]`);
    if (!el) return null;
    const frameRect = frame.getBoundingClientRect();
    const scale = frameRect.width / FRAME_W;
    const rect = el.getBoundingClientRect();
    return {
      x: (rect.left - frameRect.left + rect.width / 2) / scale,
      y: (rect.top - frameRect.top + rect.height / 2) / scale,
    };
  }

  function runTimeline(actions: DemoAction[], onDone: () => void) {
    const run = (i: number) => {
      if (i >= actions.length) {
        onDone();
        return;
      }
      const action = actions[i];
      switch (action.type) {
        case "wait":
          schedule(() => run(i + 1), action.delay);
          return;
        case "apply":
          setState((s) => ({ ...s, ...action.patch }));
          schedule(() => run(i + 1), action.delay ?? 350);
          return;
        case "move": {
          const pos = locate(action);
          if (pos) setCursor((c) => ({ ...c, ...pos, visible: true }));
          schedule(() => run(i + 1), action.delay ?? 750);
          return;
        }
        case "click": {
          const pos = locate(action);
          setCursor((c) => ({ ...c, ...(pos ?? {}), visible: true, clickCount: c.clickCount + 1 }));
          schedule(() => {
            if (action.patch) setState((s) => ({ ...s, ...action.patch }));
            schedule(() => run(i + 1), action.delay ?? 550);
          }, 180);
          return;
        }
        case "type": {
          const pos = locate(action);
          if (pos) setCursor((c) => ({ ...c, ...pos, visible: true }));
          const typeChar = (n: number) => {
            setState((s) => ({ ...s, [action.field]: action.text.slice(0, n) }));
            if (n < action.text.length) schedule(() => typeChar(n + 1), TYPE_MS);
            else schedule(() => run(i + 1), action.delay ?? 350);
          };
          schedule(() => typeChar(1), 400);
          return;
        }
      }
    };
    run(0);
  }

  function goTo(next: number) {
    if (next < 0 || next >= DEMO_STEPS.length) return;
    clearTimers();
    setIndex(next);
    if (prefersReducedMotion()) {
      setState(stateAfter(next));
      setCursor((c) => ({ ...c, visible: false }));
      if (playingRef.current && next < DEMO_STEPS.length - 1) {
        schedule(() => goTo(next + 1), 4000);
      }
      return;
    }
    setState(stateEntering(next));
    // Laisse le nouvel écran se monter avant de chercher les cibles.
    schedule(() => {
      runTimeline(DEMO_STEPS[next].timeline, () => {
        if (playingRef.current && next < DEMO_STEPS.length - 1) {
          schedule(() => goTo(next + 1), 1400);
        }
      });
    }, 350);
  }

  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  // Joue l'étape 1 au montage ; nettoie tout au démontage.
  useEffect(() => {
    goToRef.current(0);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ← / → au clavier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        goToRef.current(indexRef.current + 1);
      } else if (e.key === "ArrowLeft") {
        setPlaying(false);
        goToRef.current(indexRef.current - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Pause automatique quand l'onglet est masqué.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const step = DEMO_STEPS[index];
  const isOutro = step.chapter === "outro";

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="mx-auto w-full max-w-[min(960px,calc((100dvh-240px)*960/840))]">
        {isOutro ? (
          <Outro
            onRestart={() => {
              setPlaying(false);
              goTo(0);
            }}
          />
        ) : (
          <BrowserFrame url={state.url} contentRef={contentRef}>
            <DemoScreen state={state} />
            <DemoCursor {...cursor} />
          </BrowserFrame>
        )}
      </div>
      <TourControls
        steps={DEMO_STEPS}
        index={index}
        playing={playing}
        onPrev={() => {
          setPlaying(false);
          goTo(index - 1);
        }}
        onNext={() => goTo(index + 1)}
        onJump={(i) => {
          setPlaying(false);
          goTo(i);
        }}
        onTogglePlay={() => {
          const next = !playing;
          setPlaying(next);
          if (next) goTo(index); // (re)joue l'étape courante puis enchaîne
        }}
      />
    </div>
  );
}
```

For this task only, `screens/outro.tsx` gets a minimal placeholder so the file compiles (replaced in Task 13):

```tsx
// src/components/demo/screens/outro.tsx
"use client";

export function Outro({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="grid h-64 place-items-center rounded-3xl bg-ink text-ink-foreground">
      <button type="button" onClick={onRestart} className="underline">
        Revoir la démo
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write the page**

```tsx
// src/app/demo/page.tsx
import type { Metadata } from "next";
import Link from "next/link";

import { DemoTour } from "@/components/demo/demo-tour";
import { Logo } from "@/components/ui/logo";

export const metadata: Metadata = {
  title: "Démo — Skedul",
  description:
    "Visite guidée : réservation, packs d'heures prépayées et back-office pro, en 2 minutes.",
};

export default function DemoPage() {
  return (
    <div className="bg-aurora flex min-h-screen flex-col">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
        <Link href="/" className="hover:opacity-80">
          <Logo />
        </Link>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          Quitter la démo
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center pb-10 pt-4">
        <DemoTour />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Verify the skeleton in the browser**

Start the dev server (preview tools, `pnpm dev` config) and open `/demo`. Check:
- The frame renders with the URL pill `skedul.app/altinha-paris`, the stub screen, and the ticket-stub controls with 12 stamp slots.
- "Suivant" advances (stub screens change, URL pill updates and replays its fade, stamps get stamped in rose with the pop animation).
- "Précédent", stamp-jumping, and ← / → keys work; play chains steps automatically and pause stops the chaining.
- The cursor appears and glides toward stub targets on steps that have `move` actions.
- Step 12 swaps the frame for the placeholder outro; the controls show "Créer ma page".
- No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/demo/screens/index.tsx src/components/demo/screens/outro.tsx src/components/demo/demo-tour.tsx src/app/demo/page.tsx
git commit -m "feat(demo): tour orchestrator, /demo page and screen registry skeleton"
```

---
### Task 7: Client shell + public profile screen

**Files:**
- Create: `src/components/demo/screens/client-shell.tsx`
- Create: `src/components/demo/screens/client-profile.tsx`
- Modify: `src/components/demo/screens/index.tsx` (swap the `client-profile` stub)

**Interfaces:**
- Consumes: `ScreenProps` from `./index`; `DEMO_BRAND`, `DEMO_SERVICES`, `DEMO_PACK` from `../demo-data`; UI primitives.
- Produces: `ClientShell({ children })` — mini PublicShell replica (brand banner + avatar header), reused by all client screens (Tasks 8–9). `ClientProfile(props: ScreenProps)`.
- data-demo targets exposed: `service-decouverte`, `service-decouverte-cta`, `pack-card`, `pack-buy`.

- [ ] **Step 1: Write the shell**

Visual reference: `src/components/public/public-shell.tsx` (compact adaptation — gradient banner, overlapping initials avatar, name + headline).

```tsx
// src/components/demo/screens/client-shell.tsx
import type { ReactNode } from "react";

import { DEMO_BRAND } from "../demo-data";

export function ClientShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border">
        <div
          className="h-14"
          style={{ background: `linear-gradient(180deg, ${DEMO_BRAND.brandColor}22, transparent)` }}
        />
        <div className="mx-auto flex w-full max-w-3xl items-end gap-3 px-6 pb-4">
          <span className="-mt-7 grid size-14 shrink-0 place-items-center rounded-2xl border-4 border-card bg-accent text-lg font-semibold text-accent-foreground shadow-sm">
            AP
          </span>
          <div className="pb-0.5">
            <p className="text-lg font-bold">{DEMO_BRAND.businessName}</p>
            <p className="text-xs text-muted-foreground">{DEMO_BRAND.headline}</p>
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-hidden px-6 py-5">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Write the profile screen**

Visual reference: `src/app/[slug]/page.tsx` (service rows + pack cards).

```tsx
// src/components/demo/screens/client-profile.tsx
import { ArrowRight, Clock, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { DEMO_PACK, DEMO_SERVICES } from "../demo-data";
import { ClientShell } from "./client-shell";
import type { ScreenProps } from "./index";

export function ClientProfile(_: ScreenProps) {
  return (
    <ClientShell>
      <h2 className="mb-3 text-base font-semibold">Réserver une prestation</h2>
      <div className="space-y-2.5">
        {DEMO_SERVICES.map((svc) => {
          const isTarget = svc.id === "decouverte";
          return (
            <Card key={svc.id} data-demo={isTarget ? "service-decouverte" : undefined}>
              <CardContent className="flex items-center gap-4 p-4">
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: svc.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{svc.title}</p>
                  <p className="mt-0.5 flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5" /> {svc.durationMinutes} min
                    </span>
                    <span className="font-medium text-foreground">
                      {formatMoney(svc.priceCents)}
                    </span>
                    {svc.capacity > 1 && <span>{svc.capacity} places</span>}
                  </p>
                </div>
                <Button size="sm" data-demo={isTarget ? "service-decouverte-cta" : undefined}>
                  Réserver <ArrowRight />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <h2 className="mb-1 mt-6 text-base font-semibold">Packs prépayés</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Payez une fois, réservez plusieurs créneaux quand vous voulez.
      </p>
      <Card data-demo="pack-card" className="max-w-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">
              <Ticket className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{DEMO_PACK.name}</p>
              <span className="mt-0.5 inline-flex gap-1.5">
                <Badge>{DEMO_PACK.credits} crédits</Badge>
                <Badge variant="neutral">{DEMO_PACK.scope}</Badge>
              </span>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xl font-bold">{formatMoney(DEMO_PACK.priceCents)}</p>
            <Button size="sm" data-demo="pack-buy">
              Acheter
            </Button>
          </div>
        </CardContent>
      </Card>
    </ClientShell>
  );
}
```

- [ ] **Step 3: Swap the registry case**

In `src/components/demo/screens/index.tsx`, add `import { ClientProfile } from "./client-profile";` and replace the `client-profile` case:

```tsx
    case "client-profile":
      return <ClientProfile state={state} />;
```

- [ ] **Step 4: Typecheck + browser check**

Run: `pnpm typecheck` → no errors.
In the browser on `/demo`: step 1 shows the Altinha Paris profile (banner, avatar AP, 3 services, pack card); the cursor glides over the découverte row then the pack card; step 2's click lands on the « Réserver » button. Content must not overflow the frame (no clipping at the bottom).

- [ ] **Step 5: Commit**

```bash
git add src/components/demo/screens/client-shell.tsx src/components/demo/screens/client-profile.tsx src/components/demo/screens/index.tsx
git commit -m "feat(demo): client shell and public profile screen"
```

---

### Task 8: Booking screen (calendar + form)

**Files:**
- Create: `src/components/demo/screens/client-booking.tsx`
- Modify: `src/components/demo/screens/index.tsx` (swap the `client-booking` stub)

**Interfaces:**
- Consumes: `DayCalendar` from `@/components/public/day-calendar` (reused as-is, controlled); `demoAvailableKeys`, `DEMO_SLOT_TIMES`, `DEMO_SERVICES` from `../demo-data`; `ScreenProps`, `ClientShell`.
- data-demo targets: `calendar` (wrapper the `availableCalendarDay` finder scopes into), `slot-09:00`…`slot-18:00`, `field-name`, `field-email`, `pay-button`, `credit-button`.

Layout note: the real booking page stacks its two cards vertically; to fit 960×840 the replica puts them side by side. Tokens, step headings and states (greyed step 2, solid violet selected slot, green credit banner, dual buttons) match `src/components/public/booking-flow.tsx`.

- [ ] **Step 1: Write the screen**

```tsx
// src/components/demo/screens/client-booking.tsx
import { Check, Clock, Loader2, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DayCalendar } from "@/components/public/day-calendar";
import { cn, formatMoney } from "@/lib/utils";
import { DEMO_SERVICES, DEMO_SLOT_TIMES, demoAvailableKeys } from "../demo-data";
import { ClientShell } from "./client-shell";
import type { ScreenProps } from "./index";

export function ClientBooking({ state }: ScreenProps) {
  const svc = DEMO_SERVICES[0]; // Séance découverte
  const slotPicked = state.bookingSelectedTime !== null;

  return (
    <ClientShell>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">{svc.title}</h1>
        <Badge variant="neutral">
          <Clock className="size-3.5" /> {svc.durationMinutes} min
        </Badge>
        <Badge>{formatMoney(svc.priceCents)}</Badge>
      </div>

      <div className="grid grid-cols-[1.05fr_1fr] gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Clock className="size-4 text-primary" /> 1. Choisissez un créneau
            </p>
            <div data-demo="calendar">
              <DayCalendar
                availableKeys={demoAvailableKeys()}
                selectedKey={state.bookingSelectedDay}
                onSelect={() => {}}
              />
            </div>
            {state.bookingSelectedDay && (
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {DEMO_SLOT_TIMES.map((t) => (
                  <span
                    key={t}
                    data-demo={`slot-${t}`}
                    className={cn(
                      "rounded-xl border px-2 py-1.5 text-center text-sm font-medium transition-colors",
                      state.bookingSelectedTime === t
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border",
                    )}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={cn("transition-opacity", !slotPicked && "opacity-50")}>
          <CardContent className="space-y-3 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Check className="size-4 text-primary" /> 2. Vos informations
            </p>
            <div className="space-y-1.5">
              <Label>Nom complet</Label>
              <Input data-demo="field-name" readOnly value={state.formName} placeholder="Jean Dupont" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input data-demo="field-email" readOnly value={state.formEmail} placeholder="jean@exemple.com" />
            </div>
            {state.hasCredits && (
              <p className="flex items-center gap-2 rounded-xl bg-success-muted px-3 py-2 text-sm text-success">
                <Ticket className="size-4" /> Vous avez {state.creditsRemaining} crédits
                applicables à cette prestation.
              </p>
            )}
            <div className="flex flex-col gap-2 pt-1">
              {state.hasCredits ? (
                <>
                  <Button data-demo="credit-button" className="w-full">
                    {state.paying ? <Loader2 className="animate-spin" /> : <Ticket />}
                    Réserver avec 1 crédit
                  </Button>
                  <Button variant="secondary" className="w-full">
                    Payer {formatMoney(svc.priceCents)}
                  </Button>
                </>
              ) : (
                <Button data-demo="pay-button" className="w-full">
                  {state.paying && <Loader2 className="animate-spin" />}
                  Payer {formatMoney(svc.priceCents)}
                </Button>
              )}
              <p className="text-center text-xs text-muted-foreground">
                Paiement sécurisé via Stripe.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </ClientShell>
  );
}
```

- [ ] **Step 2: Swap the registry case**

In `screens/index.tsx`: `import { ClientBooking } from "./client-booking";` and

```tsx
    case "client-booking":
      return <ClientBooking state={state} />;
```

- [ ] **Step 3: Typecheck + browser check**

Run: `pnpm typecheck` → no errors.
In the browser: play steps 2–4. The cursor must land precisely on the booked day cell (first enabled day of the month grid — the `availableCalendarDay(0)` finder), the day gets the tinted selected style and the slot grid appears; the cursor clicks `18:00` (turns solid violet); step 2's card un-greys; typing fills the two fields character by character; « Payer 25 € » shows the spinner beat. Also jump directly to step 6 via its stamp: the calendar must show the J+3 day selected, the green credit banner, and the primary « Réserver avec 1 crédit ».

- [ ] **Step 4: Commit**

```bash
git add src/components/demo/screens/client-booking.tsx src/components/demo/screens/index.tsx
git commit -m "feat(demo): booking screen with reused month calendar"
```

---

### Task 9: Pack purchase + confirmation screens

**Files:**
- Create: `src/components/demo/screens/client-pack.tsx`
- Create: `src/components/demo/screens/client-confirmation.tsx`
- Modify: `src/components/demo/screens/index.tsx` (swap both stubs)

**Interfaces:**
- Consumes: `ScreenProps`, `ClientShell`, demo-data constants (`DEMO_PACK`, `BOOKED_RANGE`, `CREDIT_RANGE`, `bookedDayKey`, `creditDayKey`), `parseDayKey` from `@/lib/calendar-grid`, `format`+`fr` from date-fns.
- data-demo targets: `field-name`, `field-email`, `pack-pay` (pack screen); `book-with-credit` (pack confirmation).

Visual references: `src/app/[slug]/pack/[packId]/page.tsx` and `src/app/[slug]/merci/page.tsx`.

- [ ] **Step 1: Write the pack screen**

```tsx
// src/components/demo/screens/client-pack.tsx
import { Loader2, ShoppingCart, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/utils";
import { DEMO_PACK } from "../demo-data";
import { ClientShell } from "./client-shell";
import type { ScreenProps } from "./index";

export function ClientPack({ state }: ScreenProps) {
  return (
    <ClientShell>
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <span className="grid size-12 place-items-center rounded-xl bg-accent text-accent-foreground">
              <Ticket className="size-6" />
            </span>
            <h1 className="mt-3 text-xl font-bold tracking-tight">{DEMO_PACK.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{DEMO_PACK.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge>{DEMO_PACK.credits} crédits</Badge>
              <Badge variant="neutral">{DEMO_PACK.scope}</Badge>
              <Badge variant="success">
                {formatMoney(DEMO_PACK.priceCents / DEMO_PACK.credits)} / séance
              </Badge>
            </div>
            <p className="mt-5 flex items-baseline gap-2">
              <span className="text-3xl font-bold">{formatMoney(DEMO_PACK.priceCents)}</span>
              <span className="text-sm text-muted-foreground">payé une seule fois</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-5">
            <h2 className="font-semibold">Finaliser l'achat</h2>
            <div className="space-y-1.5">
              <Label>Nom complet</Label>
              <Input data-demo="field-name" readOnly value={state.formName} placeholder="Jean Dupont" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input data-demo="field-email" readOnly value={state.formEmail} placeholder="jean@exemple.com" />
            </div>
            <Button data-demo="pack-pay" className="w-full">
              {state.paying ? <Loader2 className="animate-spin" /> : <ShoppingCart />}
              Payer {formatMoney(DEMO_PACK.priceCents)}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Paiement sécurisé via Stripe. Vos crédits sont activés immédiatement.
            </p>
          </CardContent>
        </Card>
      </div>
    </ClientShell>
  );
}
```

- [ ] **Step 2: Write the confirmation screen**

```tsx
// src/components/demo/screens/client-confirmation.tsx
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { CheckCircle2, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { parseDayKey } from "@/lib/calendar-grid";
import { formatMoney } from "@/lib/utils";
import {
  BOOKED_RANGE,
  CREDIT_RANGE,
  DEMO_PACK,
  DEMO_SERVICES,
  bookedDayKey,
  creditDayKey,
} from "../demo-data";
import { ClientShell } from "./client-shell";
import type { ScreenProps } from "./index";

export function ClientConfirmation({ state }: ScreenProps) {
  const isPack = state.confirmation === "pack";
  const isCredit = state.confirmation === "booking-credit";
  const dayKey = isCredit ? creditDayKey() : bookedDayKey();
  const range = isCredit ? CREDIT_RANGE : BOOKED_RANGE;
  const dayLabel = format(parseDayKey(dayKey), "EEEE d MMMM", { locale: fr });

  return (
    <ClientShell>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="size-12 text-success" />
          <h1 className="text-2xl font-bold tracking-tight">
            {isPack ? "Pack activé !" : "Réservation confirmée !"}
          </h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Un email de confirmation vient de vous être envoyé.
          </p>
          <div className="mt-1 rounded-xl bg-muted px-6 py-4">
            {isPack ? (
              <>
                <p className="flex items-center justify-center gap-2 font-semibold">
                  <Ticket className="size-4 text-primary" /> {DEMO_PACK.name}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {DEMO_PACK.credits} crédits · {formatMoney(DEMO_PACK.priceCents)}
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold">{DEMO_SERVICES[0].title}</p>
                <p className="text-sm capitalize text-muted-foreground">
                  {dayLabel} · {range}
                </p>
                {isCredit && (
                  <Badge variant="success" className="mt-2">
                    1 crédit utilisé · solde : {state.creditsRemaining} crédits
                  </Badge>
                )}
              </>
            )}
          </div>
          {isPack && (
            <Button data-demo="book-with-credit" className="mt-2">
              Réserver un créneau
            </Button>
          )}
        </CardContent>
      </Card>
    </ClientShell>
  );
}
```

- [ ] **Step 3: Swap both registry cases**

```tsx
    case "client-pack":
      return <ClientPack state={state} />;
    case "client-confirmation":
      return <ClientConfirmation state={state} />;
```

- [ ] **Step 4: Typecheck + browser check**

Run: `pnpm typecheck` → no errors.
In the browser: play steps 4–6 end to end. Step 4 ends on « Réservation confirmée ! » with the J+2 date and « 18:00 – 19:00 »; step 5 walks profile → pack page (typing, spinner) → « Pack activé ! » with the « Réserver un créneau » button; step 6's click starts from that button and its credit confirmation shows the green badge « 1 crédit utilisé · solde : 9 crédits ».

- [ ] **Step 5: Commit**

```bash
git add src/components/demo/screens/client-pack.tsx src/components/demo/screens/client-confirmation.tsx src/components/demo/screens/index.tsx
git commit -m "feat(demo): pack purchase and confirmation screens"
```

---

### Task 10: Pro shell + planning screen

**Files:**
- Create: `src/components/demo/screens/pro-shell.tsx`
- Create: `src/components/demo/screens/pro-planning.tsx`
- Modify: `src/components/demo/screens/index.tsx` (swap the `pro-planning` stub)

**Interfaces:**
- Consumes: `Logo`, `cn`, `toHHMM` from `@/components/dashboard/weekly-hours-editor`; `DEMO_WEEK_SESSIONS`, `leaSession`, `planningWeekDays` from `../demo-data`.
- Produces: `ProShell({ active, children })` with `active: "planning" | "event-types" | "availability" | "settings"` — reused by Tasks 11–12. `ProPlanning(props: ScreenProps)`.
- data-demo target: `session-lea`.

Visual reference: `src/components/dashboard/sidebar.tsx` and `src/components/dashboard/planning-calendar.tsx` (compact grid: hours 9→20, 52px/hour).

- [ ] **Step 1: Write the pro shell**

```tsx
// src/components/demo/screens/pro-shell.tsx
import type { ReactNode } from "react";
import {
  CalendarDays,
  CalendarRange,
  Clock,
  LayoutDashboard,
  Settings,
} from "lucide-react";

import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

const NAV = [
  { id: "overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { id: "planning", label: "Planning", icon: CalendarRange },
  { id: "event-types", label: "Prestations", icon: CalendarDays },
  { id: "availability", label: "Disponibilités", icon: Clock },
  { id: "settings", label: "Réglages", icon: Settings },
] as const;

export function ProShell({
  active,
  children,
}: {
  active: (typeof NAV)[number]["id"];
  children: ReactNode;
}) {
  return (
    <div className="flex h-full bg-background">
      <aside className="flex w-52 shrink-0 flex-col gap-1 border-r border-border bg-card p-3">
        <Logo className="mb-1 px-1" />
        <p className="mb-2 truncate px-1 text-xs text-muted-foreground">Altinha Paris</p>
        {NAV.map(({ id, label, icon: Icon }) => (
          <span
            key={id}
            className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium",
              id === active ? "bg-accent text-accent-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className="size-4" /> {label}
          </span>
        ))}
      </aside>
      <main className="flex-1 overflow-hidden px-6 py-5">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Write the planning screen**

```tsx
// src/components/demo/screens/pro-planning.tsx
import { format } from "date-fns";
import { fr } from "date-fns/locale";

import { toHHMM } from "@/components/dashboard/weekly-hours-editor";
import { cn } from "@/lib/utils";
import { DEMO_WEEK_SESSIONS, leaSession, planningWeekDays } from "../demo-data";
import { ProShell } from "./pro-shell";
import type { ScreenProps } from "./index";

const START_HOUR = 9;
const END_HOUR = 20;
const HOUR_PX = 52;

export function ProPlanning({ state }: ScreenProps) {
  const week = planningWeekDays();
  const sessions = state.planningHasLea
    ? [...DEMO_WEEK_SESSIONS, leaSession()]
    : DEMO_WEEK_SESSIONS;
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const weekLabel = `${format(week[0], "d", { locale: fr })} – ${format(week[6], "d MMMM yyyy", { locale: fr })}`;

  return (
    <ProShell active="planning">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Planning</h1>
          <p className="text-sm text-muted-foreground">
            Vos séances et rendez-vous de la semaine.
          </p>
        </div>
        <p className="text-sm font-medium">{weekLabel}</p>
      </div>

      <div className="mt-3 flex">
        <div className="relative w-10 shrink-0 pt-7">
          {hours.slice(0, -1).map((h) => (
            <div key={h} className="relative" style={{ height: HOUR_PX }}>
              <span className="absolute -top-1.5 right-1.5 text-[10px] text-muted-foreground">
                {String(h).padStart(2, "0")}:00
              </span>
            </div>
          ))}
        </div>
        {week.map((day, di) => (
          <div key={di} className="flex-1 border-l border-border">
            <p className="flex h-7 items-center justify-center text-xs font-medium capitalize">
              {format(day, "EEE d", { locale: fr })}
            </p>
            <div className="relative" style={{ height: (END_HOUR - START_HOUR) * HOUR_PX }}>
              {hours.slice(1).map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-border/60"
                  style={{ top: (h - START_HOUR) * HOUR_PX }}
                />
              ))}
              {sessions
                .filter((s) => s.dayIndex === di)
                .map((s) => (
                  <span
                    key={s.id}
                    data-demo={s.id === "lea" ? "session-lea" : undefined}
                    className={cn(
                      "absolute inset-x-0.5 block rounded-lg border border-black/10 p-1 text-left text-[11px] leading-tight text-white shadow-sm",
                      s.id === "lea" && "demo-pop",
                    )}
                    style={{
                      top: (s.startMinute - START_HOUR * 60) * (HOUR_PX / 60),
                      height: Math.max(s.durationMinutes * (HOUR_PX / 60), 22),
                      backgroundColor: s.color,
                    }}
                  >
                    <span className="font-medium">
                      {toHHMM(s.startMinute)} {s.title}
                    </span>
                    <span className="block opacity-90">{s.subtitle}</span>
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
    </ProShell>
  );
}
```

- [ ] **Step 3: Swap the registry case**

```tsx
    case "pro-planning":
      return <ProPlanning state={state} />;
```

- [ ] **Step 4: Typecheck + browser check**

Run: `pnpm typecheck` → no errors.
In the browser: step 7 shows the dashboard sidebar (Planning active) and the week grid with the 4 existing sessions (including « Cours collectif · 5/8 »); after ~1s, Léa's violet block pops in at 18:00 on the booked day with the stamp-in animation, and the cursor moves to it. Grid must fit inside the frame (no vertical clipping).

- [ ] **Step 5: Commit**

```bash
git add src/components/demo/screens/pro-shell.tsx src/components/demo/screens/pro-planning.tsx src/components/demo/screens/index.tsx
git commit -m "feat(demo): pro shell and live planning screen"
```

---

### Task 11: Prestations + packs config screens

**Files:**
- Create: `src/components/demo/screens/pro-event-types.tsx`
- Create: `src/components/demo/screens/pro-packs.tsx`
- Modify: `src/components/demo/screens/index.tsx` (swap both stubs)

**Interfaces:**
- Consumes: `ProShell`, `ScreenProps`, `DEMO_SERVICES` + `DemoService` + `DEMO_PACK` from `../demo-data`.
- data-demo targets: `edit-service` (pencil of the first service row), `edit-pack` (pencil of the pack row).

Visual references: `src/components/dashboard/event-types-manager.tsx`, `src/components/dashboard/packs-manager.tsx`.

- [ ] **Step 1: Write the prestations screen**

```tsx
// src/components/demo/screens/pro-event-types.tsx
import { Clock, Pencil, Plus, Ticket, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatMoney } from "@/lib/utils";
import { DEMO_SERVICES, type DemoService } from "../demo-data";
import { ProShell } from "./pro-shell";
import type { ScreenProps } from "./index";

const COLOR_CHOICES = ["#6d5cf6", "#0ea5e9", "#16a34a", "#f59e0b", "#ec4899", "#ef4444"];

function ServiceRow({ svc, demoTarget }: { svc: DemoService; demoTarget?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: svc.color }} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{svc.title}</p>
          <p className="mt-0.5 flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" /> {svc.durationMinutes} min
            </span>
            <span>{formatMoney(svc.priceCents)}</span>
            {svc.capacity > 1 && <span>{svc.capacity} places</span>}
          </p>
        </div>
        <span
          data-demo={demoTarget}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground"
        >
          <Pencil className="size-4" />
        </span>
        <span className="grid size-8 place-items-center rounded-lg text-destructive">
          <Trash2 className="size-4" />
        </span>
      </CardContent>
    </Card>
  );
}

export function ProEventTypes({ state }: ScreenProps) {
  return (
    <ProShell active="event-types">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Prestations</h1>
          <p className="text-sm text-muted-foreground">
            Les types de rendez-vous que vos clients peuvent réserver.
          </p>
        </div>
        <Button variant="outline" size="sm">
          <Ticket /> Packs prépayés
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        {state.eventTypeFormOpen ? (
          <Card className="border-primary/40">
            <CardContent className="space-y-3 p-4">
              <div className="space-y-1.5">
                <Label>Titre</Label>
                <Input readOnly value="Séance découverte" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Durée (min)</Label>
                  <Input readOnly value="60" />
                </div>
                <div className="space-y-1.5">
                  <Label>Prix (€)</Label>
                  <Input readOnly value="25" />
                </div>
                <div className="space-y-1.5">
                  <Label>Capacité</Label>
                  <Input readOnly value="1" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Couleur</Label>
                <div className="flex gap-2">
                  {COLOR_CHOICES.map((c, i) => (
                    <span
                      key={c}
                      className={cn(
                        "size-7 rounded-full",
                        i === 0 && "ring-2 ring-foreground ring-offset-2",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm">Enregistrer</Button>
                <Button size="sm" variant="ghost">
                  Annuler
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <ServiceRow svc={DEMO_SERVICES[0]} demoTarget="edit-service" />
        )}
        <ServiceRow svc={DEMO_SERVICES[1]} />
        <ServiceRow svc={DEMO_SERVICES[2]} />
        <Button variant="secondary" size="sm">
          <Plus /> Nouvelle prestation
        </Button>
      </div>
    </ProShell>
  );
}
```

- [ ] **Step 2: Write the packs screen**

```tsx
// src/components/demo/screens/pro-packs.tsx
import { ArrowLeft, Pencil, Plus, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/utils";
import { DEMO_PACK } from "../demo-data";
import { ProShell } from "./pro-shell";
import type { ScreenProps } from "./index";

export function ProPacks({ state }: ScreenProps) {
  return (
    <ProShell active="event-types">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" /> Prestations
      </p>
      <h1 className="mt-2 text-xl font-bold tracking-tight">Packs prépayés</h1>
      <p className="text-sm text-muted-foreground">
        Vendez des lots de crédits que vos clients utilisent pour réserver.
      </p>

      <div className="mt-4 space-y-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
              <Ticket className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{DEMO_PACK.name}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {DEMO_PACK.credits} crédits · {formatMoney(DEMO_PACK.priceCents)} ·{" "}
                {DEMO_PACK.scope}
              </p>
            </div>
            <Badge variant="success">{DEMO_PACK.sold} vendus</Badge>
            <span
              data-demo="edit-pack"
              className="grid size-8 place-items-center rounded-lg text-muted-foreground"
            >
              <Pencil className="size-4" />
            </span>
          </CardContent>
        </Card>

        {state.packFormOpen && (
          <Card className="border-primary/40">
            <CardContent className="space-y-3 p-4">
              <div className="space-y-1.5">
                <Label>Nom du pack</Label>
                <Input readOnly value={DEMO_PACK.name} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Crédits (séances)</Label>
                  <Input readOnly value="10" />
                </div>
                <div className="space-y-1.5">
                  <Label>Prix total (€)</Label>
                  <Input readOnly value="200" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Prestation associée</Label>
                <Input readOnly value="Toutes les prestations" />
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm">Enregistrer</Button>
                <Button size="sm" variant="ghost">
                  Annuler
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        <Button variant="secondary" size="sm">
          <Plus /> Nouveau pack
        </Button>
      </div>
    </ProShell>
  );
}
```

- [ ] **Step 3: Swap both registry cases**

```tsx
    case "pro-event-types":
      return <ProEventTypes state={state} />;
    case "pro-packs":
      return <ProPacks state={state} />;
```

- [ ] **Step 4: Typecheck + browser check**

Run: `pnpm typecheck` → no errors.
In the browser: step 8 — cursor clicks the pencil of « Séance découverte », the row swaps for the tinted edit form (durée/prix/capacité/couleurs). Step 9 — packs list with « 12 vendus », the click opens the pack form below the row.

- [ ] **Step 5: Commit**

```bash
git add src/components/demo/screens/pro-event-types.tsx src/components/demo/screens/pro-packs.tsx src/components/demo/screens/index.tsx
git commit -m "feat(demo): prestations and packs config screens"
```

---

### Task 12: Availability + branding screens

**Files:**
- Create: `src/components/demo/screens/pro-availability.tsx`
- Create: `src/components/demo/screens/pro-branding.tsx`
- Modify: `src/components/demo/screens/index.tsx` (swap both stubs)

**Interfaces:**
- Consumes: `WeeklyHoursEditor`, `emptyByDay`, `type ByDay` from `@/components/dashboard/weekly-hours-editor` (reused as-is, controlled); `THEME_PRESETS`, `brandThemeVars` from `@/lib/color`; `DEMO_BRAND`.
- data-demo targets: `availability` (wrapper the `saturdayToggle` finder scopes into — the finder matches the button whose text contains « Samedi »), `swatch-turquoise` (the `#0d9488` preset), `layout-vitrine`.

- [ ] **Step 1: Write the availability screen**

```tsx
// src/components/demo/screens/pro-availability.tsx
import { useMemo } from "react";

import {
  WeeklyHoursEditor,
  emptyByDay,
  type ByDay,
} from "@/components/dashboard/weekly-hours-editor";
import { Button } from "@/components/ui/button";
import { ProShell } from "./pro-shell";
import type { ScreenProps } from "./index";

export function ProAvailability({ state }: ScreenProps) {
  const byDay = useMemo<ByDay>(() => {
    const value = emptyByDay();
    for (const d of [1, 2, 3, 4, 5]) value[d] = [{ start: "09:00", end: "17:00" }];
    if (state.saturdayEnabled) value[6] = [{ start: "09:00", end: "12:00" }];
    return value;
  }, [state.saturdayEnabled]);

  return (
    <ProShell active="availability">
      <h1 className="text-xl font-bold tracking-tight">Disponibilités</h1>
      <p className="text-sm text-muted-foreground">Vos horaires récurrents (fuseau Europe/Paris).</p>
      <div data-demo="availability" className="mt-4">
        <WeeklyHoursEditor value={byDay} onChange={() => {}} />
      </div>
      <Button className="mt-4" size="sm">
        Enregistrer les disponibilités
      </Button>
    </ProShell>
  );
}
```

Height check: the editor renders 7 compact day cards — if the total exceeds the frame (clipping visible in the browser check), remove the trailing `Button` first, then reduce `mt-4` spacing.

- [ ] **Step 2: Write the branding screen**

```tsx
// src/components/demo/screens/pro-branding.tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { THEME_PRESETS, brandThemeVars } from "@/lib/color";
import { cn } from "@/lib/utils";
import { DEMO_BRAND } from "../demo-data";
import { ProShell } from "./pro-shell";
import type { ScreenProps } from "./index";

export function ProBranding({ state }: ScreenProps) {
  const vitrine = state.headerLayout === "vitrine";

  return (
    <ProShell active="settings">
      <h1 className="text-xl font-bold tracking-tight">Réglages</h1>
      <p className="text-sm text-muted-foreground">Votre profil public et vos préférences.</p>

      <Card className="mt-4">
        <CardContent className="space-y-4 p-4">
          <div>
            <h2 className="font-semibold">Identité visuelle</h2>
            <p className="text-sm text-muted-foreground">
              Couleur et mise en page de votre page publique, avec aperçu en direct.
            </p>
          </div>

          {/* Aperçu en direct — se rethème instantanément via brandThemeVars */}
          <div
            className="overflow-hidden rounded-xl border border-border"
            style={brandThemeVars(state.brandColor)}
          >
            <div
              className="h-14"
              style={{
                background: `linear-gradient(180deg, ${state.brandColor}22, transparent)`,
              }}
            />
            <div
              className={cn(
                "px-4 pb-4",
                vitrine ? "flex flex-col items-center text-center" : "flex items-end gap-3",
              )}
            >
              <span className="-mt-6 grid size-12 shrink-0 place-items-center rounded-2xl border-4 border-card bg-accent text-sm font-semibold text-accent-foreground shadow-sm">
                AP
              </span>
              <div className={cn(vitrine ? "mt-2" : "pb-0.5")}>
                <p className="text-sm font-bold">{DEMO_BRAND.businessName}</p>
                <p className="text-xs text-muted-foreground">{DEMO_BRAND.headline}</p>
              </div>
              <span className={cn("flex gap-2", vitrine ? "mt-2" : "ml-auto pb-0.5")}>
                <span className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                  Réserver
                </span>
                <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
                  Pack 10 heures
                </span>
              </span>
            </div>
          </div>

          <div>
            <Label>Thème couleur</Label>
            <div className="mt-2 flex gap-2.5">
              {THEME_PRESETS.map((p) => (
                <span
                  key={p.id}
                  data-demo={p.color === "#0d9488" ? "swatch-turquoise" : undefined}
                  title={p.label}
                  className={cn(
                    "size-9 rounded-full transition-transform",
                    state.brandColor === p.color && "scale-110 border-2 border-foreground",
                  )}
                  style={{ backgroundColor: p.color }}
                />
              ))}
            </div>
          </div>

          <div>
            <Label>Mise en page</Label>
            <div className="mt-2 flex gap-2">
              {(["profil", "vitrine"] as const).map((l) => (
                <span
                  key={l}
                  data-demo={l === "vitrine" ? "layout-vitrine" : undefined}
                  className={cn(
                    "flex-1 rounded-xl border px-4 py-2 text-center text-sm font-medium capitalize",
                    state.headerLayout === l
                      ? "border-primary bg-primary-muted text-primary"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {l}
                </span>
              ))}
            </div>
          </div>

          <div className="flex gap-2 border-t border-border pt-3">
            <Button size="sm">Enregistrer</Button>
            <Button size="sm" variant="ghost">
              Annuler
            </Button>
          </div>
        </CardContent>
      </Card>
    </ProShell>
  );
}
```

Note: if `THEME_PRESETS` contains no `#0d9488` entry (verify in `src/lib/color.ts:22`), anchor `swatch-turquoise` to the actual turquoise/teal preset's color and update the `branding` step's patch in `demo-script.ts` to that same hex — the script test asserting `#0d9488` must be updated in the same commit.

- [ ] **Step 3: Swap both registry cases**

```tsx
    case "pro-availability":
      return <ProAvailability state={state} />;
    case "pro-branding":
      return <ProBranding state={state} />;
```

- [ ] **Step 4: Typecheck + browser check**

Run: `pnpm typecheck` → no errors.
In the browser: step 10 — the cursor finds the Samedi switch, clicks, the switch turns violet and the 09:00 – 12:00 range appears. Step 11 — click on the turquoise swatch instantly rethemes the live preview (banner tint, « Réserver » pill, accent chip), then the « vitrine » click recenters the preview.

- [ ] **Step 5: Commit**

```bash
git add src/components/demo/screens/pro-availability.tsx src/components/demo/screens/pro-branding.tsx src/components/demo/screens/index.tsx
git commit -m "feat(demo): availability and branding screens with live preview"
```

---

### Task 13: Final outro screen

**Files:**
- Modify: `src/components/demo/screens/outro.tsx` (replace the Task 6 placeholder entirely)

**Interfaces:**
- Consumes: `Button`, `Link`. Signature unchanged: `Outro({ onRestart }: { onRestart: () => void })` (demo-tour already wires it).

- [ ] **Step 1: Write the final version**

```tsx
// src/components/demo/screens/outro.tsx
"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function Outro({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="rounded-3xl bg-ink px-8 py-14 text-center text-ink-foreground shadow-(--shadow-card)">
      <p className="font-mono text-[11px] uppercase tracking-widest text-ink-foreground/70">
        Fin de la visite — à vous de jouer
      </p>
      <h2 className="mx-auto mt-3 max-w-md font-display text-3xl font-bold tracking-tight">
        Votre page de réservation, prête ce soir.
      </h2>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg" variant="secondary">
          <Link href="/sign-up">
            Créer ma page gratuitement <ArrowRight />
          </Link>
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="text-ink-foreground hover:bg-white/10 hover:text-ink-foreground"
          onClick={onRestart}
        >
          Revoir la démo
        </Button>
      </div>
      <p className="mt-6 text-xs text-ink-foreground/60">
        Envie de voir une vraie page ?{" "}
        <Link
          href="/altinha-paris"
          className="underline underline-offset-4 hover:text-ink-foreground"
        >
          altinha-paris
        </Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + browser check**

Run: `pnpm typecheck` → no errors.
In the browser: step 12 replaces the frame with the dark ink ticket; « Créer ma page gratuitement » navigates to `/sign-up`; « Revoir la démo » restarts at step 1 (stamps reset); the `altinha-paris` link opens the real public page. These links must be focusable (the outro is outside the `inert` frame).

- [ ] **Step 3: Commit**

```bash
git add src/components/demo/screens/outro.tsx
git commit -m "feat(demo): dark ticket outro with sign-up CTA"
```

---

### Task 14: Point the landing's demo links at `/demo`

**Files:**
- Modify: `src/app/page.tsx:233-235`
- Modify: `src/components/ticket-cta.tsx:130` (the revealed button's `href`)
- Modify: `src/components/site-footer.tsx` (the « Page de démo » link)

**Interfaces:** none (link swaps only). `/altinha-paris` itself, the hero credentials line, and `demo-quick-login.tsx` are untouched.

- [ ] **Step 1: Hero button**

In `src/app/page.tsx`, replace:

```tsx
                <Button asChild size="lg" variant="secondary">
                  <Link href="/altinha-paris">Voir une page de démo</Link>
                </Button>
```

with:

```tsx
                <Button asChild size="lg" variant="secondary">
                  <Link href="/demo">Voir la démo</Link>
                </Button>
```

- [ ] **Step 2: Ticket CTA revealed button**

In `src/components/ticket-cta.tsx` (~line 130), the torn-ticket reveal button links to `/altinha-paris` with label « Voir la démo ». Change only the `href` to `/demo` (keep label and everything else).

- [ ] **Step 3: Footer link**

In `src/components/site-footer.tsx` (~line 12), change the « Page de démo » link's `href` from `/altinha-paris` to `/demo` (keep the label).

- [ ] **Step 4: Typecheck + browser check**

Run: `pnpm typecheck` → no errors.
In the browser on `/`: the hero secondary button reads « Voir la démo » and lands on `/demo`; tearing the ticket CTA reveals a button that lands on `/demo`; the footer « Page de démo » link lands on `/demo`.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/components/ticket-cta.tsx src/components/site-footer.tsx
git commit -m "feat(landing): route demo links to the /demo guided tour"
```

---

### Task 15: Full verification pass

**Files:** none (verification only; fix root causes in the owning task's files if anything fails).

- [ ] **Step 1: Automated checks**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all green.

- [ ] **Step 2: Full manual run-through (desktop)**

On `/demo`, click « Suivant » through all 12 steps and verify against the spec's scenario table: each step's screen, URL pill value, cursor actions, and end state (screenshots at steps 1, 4, 6, 7, 11, 12). Verify the credit journey narrative: pack confirmation → « Réserver un créneau » → green banner + « Réserver avec 1 crédit » → instant confirmation with balance 9.

- [ ] **Step 3: Controls**

- « Précédent » from any step lands on the previous step's *starting* state instantly.
- Clicking stamp N jumps anywhere (forward and back) with a coherent screen.
- Spamming « Suivant » quickly through all steps never produces an incoherent screen (timers cancelled, patches composed).
- Autoplay: play from step 1 chains to step 12 unassisted; pause stops chaining; ← / → keys work.

- [ ] **Step 4: Responsive + robustness**

- Mobile viewport (~375px): frame scales down, controls stack below, stamps wrap, no horizontal page scroll.
- Resize mid-animation: no crash; next action re-locates its target.
- Console: no errors or warnings throughout the whole tour.
- Reduced motion: code-review the `prefersReducedMotion()` branch (cursor hidden, `stateAfter` applied directly); if the browser tooling allows emulating `prefers-reduced-motion`, verify visually too.

- [ ] **Step 5: Report**

Summarize the run with screenshots. Any failing check: fix in the owning file, re-run this task from Step 1.

