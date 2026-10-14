/**
 * French messages for zod's built-in checks, applied per parse
 * (`schema.safeParse(value, { error: zodFr })`), never through `z.config()`:
 * Better Auth shares this zod instance and its own messages must not change.
 * A message the schema sets itself (refine, superRefine, `.min(1, "...")`)
 * always wins. Pure: cores, forms and their tests use it.
 */
import type { z } from "zod";

type AnyIssue = z.core.$ZodRawIssue | z.core.$ZodIssue;

/** The fields zodFrMessage reads, whatever the issue code. */
type IssueView = {
  code?: string;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  inclusive?: boolean;
  expected?: string;
  format?: string;
  divisor?: number | bigint;
  message?: string;
};

const fr = (n: number | bigint): string => n.toLocaleString("fr-FR");

/** French field names keyed by the LAST path segment of an issue. */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: "Nom",
  email: "Email",
  phone: "Téléphone",
  title: "Titre",
  description: "Description",
  location: "Lieu",
  locationOverride: "Lieu",
  color: "Couleur",
  label: "Libellé",
  quantity: "Quantité",
  priceCents: "Prix",
  validityCount: "Validité",
  capacity: "Places",
  durationMin: "Durée",
  rdvDurationMin: "Durée du rendez-vous",
  rdvBufferBeforeMin: "Marge avant",
  rdvBufferAfterMin: "Marge après",
  bookingHorizonDays: "Réservable jusqu'à",
  minNoticeMinutes: "Délai minimum",
  cancelDeadlineHours: "Annulation par le client",
  startDate: "Date de début",
  startMinute: "Heure de début",
  interval: "Intervalle",
  weekdays: "Jours",
  untilDate: "Date de fin",
  occurrenceCount: "Nombre de séances",
  options: "Options",
  questions: "Questions",
  ticketTypeIds: "Types de ticket acceptés",
  reason: "Motif",
  note: "Note",
  value: "Réponse",
  businessName: "Nom de l'activité",
  headline: "Accroche",
  bio: "Présentation",
  timezone: "Fuseau horaire",
  endDate: "Date de fin",
  startTime: "Heure de début",
  endTime: "Heure de fin",
  q: "Recherche",
};

function tooSmall(i: IssueView): string {
  const n = i.minimum ?? 0;
  switch (i.origin) {
    case "string":
      return Number(n) === 1 ? "Ce champ est obligatoire." : `${fr(n)} caractères au minimum.`;
    case "number":
    case "int":
      return i.inclusive === false ? `Doit être supérieur à ${fr(n)}.` : `Minimum ${fr(n)}.`;
    case "array":
      return Number(n) === 1 ? "Choisissez au moins un élément." : `${fr(n)} éléments au minimum.`;
    default:
      return "Valeur invalide.";
  }
}

function tooBig(i: IssueView): string {
  const n = i.maximum ?? 0;
  switch (i.origin) {
    case "string":
      return `${fr(n)} caractères au maximum.`;
    case "number":
    case "int":
      return i.inclusive === false ? `Doit être inférieur à ${fr(n)}.` : `Maximum ${fr(n)}.`;
    case "array":
      return `${fr(n)} éléments au maximum.`;
    default:
      return "Valeur invalide.";
  }
}

function invalidType(expected: string | undefined): string {
  switch (expected) {
    case "number":
      return "Indiquez un nombre.";
    case "int":
      return "Indiquez un nombre entier.";
    case "string":
      return "Ce champ est obligatoire.";
    default:
      return "Valeur invalide.";
  }
}

function invalidFormat(format: string | undefined): string {
  switch (format) {
    case "email":
      return "Adresse email invalide.";
    case "date":
      return "Date invalide.";
    case "datetime":
      return "Date et heure invalides.";
    default:
      return "Format invalide.";
  }
}

/** Generic French text for a zod issue that carries no message of its own (no field name in it). */
export function zodFrMessage(issue: AnyIssue): string {
  const i = issue as unknown as IssueView;
  switch (i.code) {
    case "too_small":
      return tooSmall(i);
    case "too_big":
      return tooBig(i);
    case "not_multiple_of":
      return `Choisissez un multiple de ${fr(i.divisor ?? 1)}.`;
    case "invalid_type":
      return invalidType(i.expected);
    case "invalid_format":
      return invalidFormat(i.format);
    case "invalid_value":
      return "Choix invalide.";
    case "invalid_union":
      return "Valeur invalide.";
    case "unrecognized_keys":
      return "Champ inattendu.";
    case "custom":
      return i.message ? i.message : "Valeur invalide.";
    default:
      return "Valeur invalide.";
  }
}

/** Per-parse error map: `schema.safeParse(value, { error: zodFr })`; schema-level messages (refine / superRefine) still win. */
export const zodFr: z.core.$ZodErrorMap = (issue) => zodFrMessage(issue);

export type ParseFrResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors: Record<string, string> };

/** The text parseFr compares a final message with: a custom issue is generic only when it had no message of its own. */
function genericText(issue: z.core.$ZodIssue): string {
  return issue.code === "custom" ? "Valeur invalide." : zodFrMessage(issue);
}

/** Label of the last named segment (array indexes are skipped: `options.1` reads « Options »). */
function labelOf(path: readonly PropertyKey[]): string | null {
  for (let k = path.length - 1; k >= 0; k--) {
    const segment = path[k];
    if (typeof segment === "string") {
      return Object.prototype.hasOwnProperty.call(FIELD_LABELS, segment) ? FIELD_LABELS[segment] : null;
    }
  }
  return null;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The message shown for one issue: « {label} : {generic text} », or the schema's own message verbatim. */
function frenchError(issue: z.core.$ZodIssue): string {
  const generic = genericText(issue);
  if (issue.message !== generic) return issue.message;
  const label = labelOf(issue.path);
  return label ? `${label} : ${lowerFirst(generic)}` : generic;
}

/** safeParse with zodFr; `error` = first issue, prefixed « {label} : » when its text is the generic one; fieldErrors keyed by path.join("."). */
export function parseFr<S extends z.ZodType>(schema: S, value: unknown): ParseFrResult<z.output<S>> {
  const res = schema.safeParse(value, { error: zodFr });
  if (res.success) return { ok: true, data: res.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = issue.path.map(String).join(".");
    if (!Object.prototype.hasOwnProperty.call(fieldErrors, key)) fieldErrors[key] = issue.message;
  }
  return { ok: false, error: frenchError(res.error.issues[0]), fieldErrors };
}
