import { CARNET_OFFER_ID, DEMO_CARNET, DEMO_CLIENT, DEMO_CODE, LEA_RDV, LEA_SEANCE_IDS, type DemoSeance } from "./demo-data";

export type ScreenId =
  | "client-page"
  | "client-seance"
  | "client-merci"
  | "client-rdv"
  | "client-espace"
  | "pro-planning"
  | "pro-events"
  | "pro-tickets"
  | "pro-availability"
  | "pro-client"
  | "pro-branding"
  | "outro";

/**
 * Everything the screens draw. The tour is a scripted simulation: a state only says what to show, it never calls the
 * booking engine, never writes the database and never signs anyone in.
 */
export interface DemoState {
  screen: ScreenId;
  url: string;
  /** The public page: its planning at the top, or its lower part (the rendez-vous cards and the Boutique). */
  pageSection: "planning" | "lower";
  /** The « J'ai déjà des tickets » dialog: closed, asking for the address, or for the code. */
  signIn: "closed" | "email" | "code";
  /** Léa is signed in with the code: the page shows her tickets instead of the « J'ai déjà des tickets » bar. */
  signedIn: boolean;
  /** Which séance page is open. */
  seance: "monday" | "wednesday";
  /** The offer chosen in « Acheter et réserver »; null keeps the first one (as the real form does). */
  offerPicked: string | null;
  formName: string;
  formEmail: string;
  formCode: string;
  paying: boolean;
  /** The seat is held while the payment runs. */
  held: boolean;
  mondayBooked: boolean;
  wednesdayBooked: boolean;
  rdvDayIndex: number | null;
  rdvTime: string | null;
  rdvBooked: boolean;
  /** Léa's rendez-vous shows in the pro planning. */
  planningHasLea: boolean;
  planningSeanceOpen: boolean;
  eventEditorOpen: boolean;
  ticketTypeOpen: boolean;
  saturdayEnabled: boolean;
  giveOpen: boolean;
  ticketGiven: boolean;
  brandColor: string;
  headerLayout: "profil" | "vitrine";
}

export type Patch = Partial<DemoState>;
export type TextField = "formName" | "formEmail" | "formCode";
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
  /** Patch appliqué à l'entrée de l'étape (changement d'écran, remises à zéro). */
  enter?: Patch;
  timeline: DemoAction[];
}

const SITE = "myskedul.com";
const AT = `${SITE}/altinha-paris`;
const DASH = `${SITE}/dashboard`;

export const INITIAL_STATE: DemoState = {
  screen: "client-page",
  url: AT,
  pageSection: "planning",
  signIn: "closed",
  signedIn: false,
  seance: "monday",
  offerPicked: null,
  formName: "",
  formEmail: "",
  formCode: "",
  paying: false,
  held: false,
  mondayBooked: false,
  wednesdayBooked: false,
  rdvDayIndex: null,
  rdvTime: null,
  rdvBooked: false,
  planningHasLea: false,
  planningSeanceOpen: false,
  eventEditorOpen: false,
  ticketTypeOpen: false,
  saturdayEnabled: false,
  giveOpen: false,
  ticketGiven: false,
  brandColor: "#6d5cf6",
  headerLayout: "profil",
};

/** Léa's Cours collectif tickets: her carnet of 4, one per séance she booked, plus the one the pro gave her. */
export function leaTicketsLeft(state: DemoState): number {
  const fromCarnet = state.mondayBooked ? DEMO_CARNET.quantity - 1 - (state.wednesdayBooked ? 1 : 0) : 0;
  return fromCarnet + (state.ticketGiven ? 1 : 0);
}

/** Places left on a séance of the shown week, once Léa's own bookings are counted. */
export function seatsLeft(seance: DemoSeance, state: DemoState): number {
  const lea =
    (seance.id === LEA_SEANCE_IDS.monday && state.mondayBooked) ||
    (seance.id === LEA_SEANCE_IDS.wednesday && state.wednesdayBooked);
  return seance.capacity - seance.taken - (lea ? 1 : 0);
}

/** Interrupteur du samedi dans le WeeklyHoursEditor (le libellé du jour est dans le bouton). */
const saturdayToggle: TargetFinder = (frame) =>
  Array.from(frame.querySelectorAll<HTMLButtonElement>('[data-demo="availability"] button')).find((b) =>
    b.textContent?.includes("Samedi"),
  ) ?? null;

export const DEMO_STEPS: DemoStep[] = [
  {
    id: "page-publique",
    chapter: "client",
    title: "La page publique",
    description:
      "Le planning de la semaine, les rendez-vous à prendre et la Boutique des tickets : vos clients trouvent tout sur une seule page.",
    timeline: [
      { type: "move", target: "week-grid" },
      { type: "wait", delay: 500 },
      { type: "apply", patch: { pageSection: "lower" }, delay: 900 },
      { type: "move", target: "boutique-collectif" },
    ],
  },
  {
    id: "carnet",
    chapter: "client",
    title: "Un carnet dès la première séance",
    description:
      "Léa s'inscrit au cours débutants de lundi. Elle prend un carnet de 4 tickets : un pour ce cours, trois pour la suite.",
    enter: { screen: "client-page", url: AT, pageSection: "planning" },
    timeline: [
      { type: "move", target: "seance-debutants-0" },
      {
        type: "click",
        target: "seance-debutants-0",
        patch: { screen: "client-seance", url: `${AT}/seance/debutants-lundi`, seance: "monday" },
      },
      { type: "move", target: `offer-${CARNET_OFFER_ID}` },
      { type: "click", target: `offer-${CARNET_OFFER_ID}`, patch: { offerPicked: CARNET_OFFER_ID } },
      { type: "type", target: "field-name", field: "formName", text: DEMO_CLIENT.name, delay: 150 },
      { type: "type", target: "field-email", field: "formEmail", text: DEMO_CLIENT.email, delay: 150 },
    ],
  },
  {
    id: "paiement",
    chapter: "client",
    title: "Une place gardée pendant le paiement",
    description:
      "Le temps du paiement en ligne, sa place est réservée : personne ne peut la prendre. Le paiement reçu, l'inscription est confirmée.",
    timeline: [
      { type: "move", target: "pay-button" },
      { type: "click", target: "pay-button", patch: { paying: true, held: true }, delay: 1800 },
      {
        type: "apply",
        patch: { paying: false, held: false, mondayBooked: true, screen: "client-merci", url: `${AT}/merci` },
      },
      { type: "move", target: "merci-tickets" },
    ],
  },
  {
    id: "deja-des-tickets",
    chapter: "client",
    title: "« J'ai déjà des tickets »",
    description:
      "Quelques jours plus tard, Léa revient. Un code reçu par email suffit pour retrouver ses tickets, rien à retenir.",
    enter: { screen: "client-page", url: AT, pageSection: "planning", formName: "", formEmail: "", formCode: "" },
    timeline: [
      { type: "move", target: "have-tickets" },
      { type: "click", target: "have-tickets", patch: { signIn: "email" } },
      { type: "type", target: "code-email", field: "formEmail", text: DEMO_CLIENT.email, delay: 150 },
      { type: "move", target: "send-code" },
      { type: "click", target: "send-code", patch: { signIn: "code" } },
      { type: "type", target: "code-field", field: "formCode", text: DEMO_CODE, delay: 150 },
      { type: "move", target: "check-code" },
      { type: "click", target: "check-code", patch: { signIn: "closed", signedIn: true } },
      { type: "move", target: "wallet-panel" },
    ],
  },
  {
    id: "utiliser-un-ticket",
    chapter: "client",
    title: "Réserver avec un ticket",
    description:
      "Connectée, Léa réserve le cours de mercredi en un clic : un ticket de son carnet est utilisé, il lui en reste deux.",
    enter: { screen: "client-page", url: AT, pageSection: "planning" },
    timeline: [
      { type: "move", target: "seance-debutants-2" },
      {
        type: "click",
        target: "seance-debutants-2",
        patch: { screen: "client-seance", url: `${AT}/seance/debutants-mercredi`, seance: "wednesday" },
      },
      { type: "move", target: "spend-button" },
      { type: "click", target: "spend-button", patch: { paying: true }, delay: 800 },
      { type: "apply", patch: { paying: false, wednesdayBooked: true } },
    ],
  },
  {
    id: "rendez-vous",
    chapter: "client",
    title: "Prendre rendez-vous",
    description:
      "Pour un appel découverte gratuit, Léa choisit un créneau libre. Les créneaux se calculent depuis vos disponibilités.",
    enter: { screen: "client-page", url: AT, pageSection: "lower" },
    timeline: [
      { type: "move", target: "rdv-card-decouverte" },
      {
        type: "click",
        target: "rdv-card-decouverte",
        patch: { screen: "client-rdv", url: `${AT}/rdv/appel-decouverte` },
      },
      { type: "move", target: `rdv-day-${LEA_RDV.dayIndex}` },
      { type: "click", target: `rdv-day-${LEA_RDV.dayIndex}`, patch: { rdvDayIndex: LEA_RDV.dayIndex } },
      { type: "move", target: `rdv-slot-${LEA_RDV.time}` },
      { type: "click", target: `rdv-slot-${LEA_RDV.time}`, patch: { rdvTime: LEA_RDV.time } },
      { type: "move", target: "rdv-book" },
      { type: "click", target: "rdv-book", patch: { paying: true }, delay: 700 },
      { type: "apply", patch: { paying: false, rdvBooked: true } },
    ],
  },
  {
    id: "espace-client",
    chapter: "client",
    title: "Son espace client",
    description:
      "Ses réservations à venir et ses tickets, au même endroit. Elle peut annuler en ligne jusqu'au délai que vous fixez.",
    enter: { screen: "client-espace", url: `${AT}/espace` },
    timeline: [
      { type: "move", target: "espace-upcoming" },
      { type: "wait", delay: 600 },
      { type: "move", target: "espace-tickets" },
    ],
  },
  {
    id: "planning",
    chapter: "pro",
    title: "Le planning",
    description:
      "Côté pro, les séances de vos événements et les rendez-vous remplissent la semaine. Un clic sur une séance montre ses inscrits.",
    enter: { screen: "pro-planning", url: `${DASH}/planning` },
    timeline: [
      { type: "wait", delay: 600 },
      { type: "apply", patch: { planningHasLea: true }, delay: 400 },
      { type: "move", target: "rdv-lea" },
      { type: "wait", delay: 400 },
      { type: "move", target: "pro-seance-debutants-0" },
      { type: "click", target: "pro-seance-debutants-0", patch: { planningSeanceOpen: true } },
      { type: "move", target: "seance-attendees" },
    ],
  },
  {
    id: "evenements",
    chapter: "pro",
    title: "Des événements récurrents",
    description:
      "Un cours chaque lundi et mercredi, un atelier le 1er dimanche du mois : chaque événement crée ses séances, avec ses places et les tickets acceptés.",
    enter: { screen: "pro-events", url: `${DASH}/events` },
    timeline: [
      { type: "move", target: "event-debutants" },
      {
        type: "click",
        target: "event-debutants",
        patch: { eventEditorOpen: true, url: `${DASH}/events/altinha-debutants` },
      },
      { type: "move", target: "event-recurrence" },
    ],
  },
  {
    id: "tickets",
    chapter: "pro",
    title: "Tickets et offres",
    description:
      "Un type de ticket, c'est ce qu'une séance accepte. Ses offres le vendent à l'unité ou en carnet, avec une validité si vous le souhaitez.",
    enter: { screen: "pro-tickets", url: `${DASH}/tickets` },
    timeline: [
      { type: "move", target: "edit-collectif" },
      {
        type: "click",
        target: "edit-collectif",
        patch: { ticketTypeOpen: true, url: `${DASH}/tickets/cours-collectif` },
      },
      { type: "move", target: `pro-offer-${CARNET_OFFER_ID}` },
    ],
  },
  {
    id: "disponibilites",
    chapter: "pro",
    title: "Vos disponibilités",
    description:
      "Les rendez-vous se prennent dans vos horaires, en dehors de vos séances. On ouvre le samedi matin ?",
    enter: { screen: "pro-availability", url: `${DASH}/availability` },
    timeline: [
      { type: "move", target: "saturday-toggle", find: saturdayToggle },
      { type: "click", target: "saturday-toggle", find: saturdayToggle, patch: { saturdayEnabled: true } },
    ],
  },
  {
    id: "fiche-client",
    chapter: "pro",
    title: "La fiche client",
    description:
      "Les tickets de Léa par type avec leur échéance, ses inscriptions et ses achats. Un geste commercial ? Offrez-lui un ticket.",
    enter: { screen: "pro-client", url: `${DASH}/clients/lea-martin` },
    timeline: [
      { type: "move", target: "give-ticket" },
      { type: "click", target: "give-ticket", patch: { giveOpen: true } },
      { type: "move", target: "give-confirm" },
      { type: "click", target: "give-confirm", patch: { giveOpen: false, ticketGiven: true } },
      { type: "move", target: "wallet-collectif" },
    ],
  },
  {
    id: "couleurs",
    chapter: "pro",
    title: "Votre page à vos couleurs",
    description: "Couleur, mise en page, avatar : la page publique se personnalise avec un aperçu en direct.",
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
    id: "a-vous",
    chapter: "outro",
    title: "À vous",
    description: "Créez votre page en quelques minutes, gratuitement pour démarrer.",
    enter: { screen: "outro", url: SITE },
    timeline: [],
  },
];

/** Lien vers la visite, ouverte sur l'étape `id` (`/demo?step=tickets`). */
export function demoHref(id?: string): string {
  return id ? `/demo?step=${encodeURIComponent(id)}` : "/demo";
}

/** Index de l'étape `?step=` ; la première si le paramètre est absent ou inconnu. */
export function stepIndex(id: string | string[] | undefined): number {
  if (typeof id !== "string") return 0;
  return Math.max(
    DEMO_STEPS.findIndex((s) => s.id === id),
    0,
  );
}

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
