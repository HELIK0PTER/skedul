/**
 * The « RDV libre » form's model (spec § 13.1): typed strings converted to the
 * patch of updateTicketTypeAction, plus the « Gratuit » precondition. Pure and
 * unit-tested; the bounds and every business rule stay with the server.
 */
import type { TicketTypePatch } from "@/lib/back-office/catalog-actions";
import { plural } from "@/lib/back-office/format";
import type { WindowOverrides } from "@/lib/tickets";
import { BOUNDS } from "@/lib/tickets-vocab";

export type RdvField = "duration" | "before" | "after";

export type RdvFormValues = {
  enabled: boolean;
  free: boolean;
  duration: string;
  before: string;
  after: string;
  overrides: WindowOverrides;
};

export function rdvFormFromType(t: {
  rdvEnabled: boolean;
  rdvFree: boolean;
  rdvDurationMin: number | null;
  rdvBufferBeforeMin: number;
  rdvBufferAfterMin: number;
  rdvOverrides: WindowOverrides;
}): RdvFormValues {
  return {
    enabled: t.rdvEnabled,
    free: t.rdvFree,
    duration: String(t.rdvDurationMin ?? BOUNDS.rdvDurationMin.default),
    before: String(t.rdvBufferBeforeMin),
    after: String(t.rdvBufferAfterMin),
    overrides: t.rdvOverrides,
  };
}

export type RdvPatchResult = { ok: true; patch: TicketTypePatch } | { ok: false; field: RdvField; error: string };

const WHOLE = /^\d+$/;
const whole = (text: string): number | null => (WHOLE.test(text.trim()) ? Number(text.trim()) : null);

/** RDV off sends rdvFree false and no duration; RDV on sends every RDV field. */
export function rdvPatchFromForm(f: RdvFormValues): RdvPatchResult {
  if (!f.enabled) return { ok: true, patch: { rdvEnabled: false, rdvFree: false, rdvDurationMin: null } };
  const duration = whole(f.duration);
  if (duration === null) return { ok: false, field: "duration", error: "Durée du rendez-vous : indiquez un nombre entier." };
  const before = whole(f.before);
  if (before === null) return { ok: false, field: "before", error: "Marge avant : indiquez un nombre entier." };
  const after = whole(f.after);
  if (after === null) return { ok: false, field: "after", error: "Marge après : indiquez un nombre entier." };
  return {
    ok: true,
    patch: {
      rdvEnabled: true,
      rdvFree: f.free,
      rdvDurationMin: duration,
      rdvBufferBeforeMin: before,
      rdvBufferAfterMin: after,
      rdvOverrides: f.overrides,
    },
  };
}

/** The field a French server message belongs to (by its label prefix), null for a general message. */
export function rdvErrorField(error: string): RdvField | null {
  if (error.startsWith("Durée")) return "duration";
  if (error.startsWith("Marge avant")) return "before";
  if (error.startsWith("Marge après")) return "after";
  return null;
}

/**
 * True for the server's refusal of « Gratuit » (RDV_FREE_HAS_SALES), recognised by its opening words: the failure
 * carries no code, and a client file cannot import the constant from catalog-actions (server side). The unit test
 * checks it against the real constant, so a rewording cannot slip by.
 */
export function isFreeSalesRefusal(error: string): boolean {
  return error.startsWith("Ce type a des offres en vente");
}

/** The facts of the type page that can block « Gratuit » (the same ones as readFreeBlockers, on the server). */
export type FreeFacts = {
  offers: readonly { isActive: boolean }[];
  usableTickets: number;
  livePurchases: number;
  upcomingBooked: number;
};

/**
 * What stands in the way of « Gratuit », each with its count (« 2 offres en vente »), in a fixed order. The server
 * stays the judge: it re-reads the same facts at the time of the save (RDV_FREE_HAS_SALES).
 */
export function freeLockReasons(t: FreeFacts): string[] {
  const onSale = t.offers.filter((o) => o.isActive).length;
  const reasons: string[] = [];
  if (onSale > 0) reasons.push(plural(onSale, "offre en vente", "offres en vente"));
  if (t.livePurchases > 0) reasons.push(plural(t.livePurchases, "paiement en cours", "paiements en cours"));
  if (t.usableTickets > 0) reasons.push(plural(t.usableTickets, "ticket valide", "tickets valides"));
  if (t.upcomingBooked > 0) reasons.push(plural(t.upcomingBooked, "réservation à venir", "réservations à venir"));
  return reasons;
}

/** « Gratuit » can be switched on only when nothing in freeLockReasons remains. */
export function canBecomeFree(t: FreeFacts): boolean {
  return freeLockReasons(t).length === 0;
}

/** The help under the disabled « Gratuit » switch: « Pas encore possible : ce type a 2 offres en vente et 1 ticket valide. » */
export function freeLockedHelp(reasons: readonly string[]): string {
  const list = reasons.length > 1 ? `${reasons.slice(0, -1).join(", ")} et ${reasons[reasons.length - 1]}` : (reasons[0] ?? "");
  return `Pas encore possible : ce type a ${list}.`;
}
