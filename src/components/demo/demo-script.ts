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
