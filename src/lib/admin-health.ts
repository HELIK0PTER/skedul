/**
 * Copy of the admin « État de l'app » card (pure, so the French strings are
 * tested). Alerts are JS strings on purpose: in JSX text, an apostrophe
 * entity followed by a line break makes Next's SWC drop the whitespace in
 * front of the text. Dates are formatted in the zone the caller passes.
 */
import type { HealthCounts } from "@/lib/admin-reads";
import { plural } from "@/lib/back-office/format";
import { formatDateShort } from "@/lib/datetime";

export type HealthAlert = {
  key: "holds" | "purchases" | "orphans" | "horizon";
  text: string;
  /** null = informational, nothing to open. */
  href: string | null;
};

/**
 * The alerts to show under the health rows, in a stable order; empty when all is well.
 * Pending holds and purchases are information « à surveiller », not failures: they
 * wait for the nightly job, a webhook or a delayed payment and clear by themselves.
 * Orphan payments come from a counter that never resets, so the alert reads as a
 * running total since the launch (with the date of the last one) and asks to
 * check them in Stripe, never to refund: after the refunds it still shows.
 */
export function healthAlerts(health: HealthCounts, tz: string): HealthAlert[] {
  const alerts: HealthAlert[] = [];
  if (health.pendingHolds > 0) {
    alerts.push({
      key: "holds",
      text: `${plural(health.pendingHolds, "place en attente de paiement", "places en attente de paiement")} depuis plus d'1 h, à surveiller`,
      href: "/admin/activity?tab=bookings&status=pending",
    });
  }
  if (health.pendingPurchases > 0) {
    alerts.push({
      key: "purchases",
      text: `${plural(health.pendingPurchases, "achat en attente", "achats en attente")} après l'expiration du paiement, à surveiller`,
      href: "/admin/activity?tab=purchases&status=pending",
    });
  }
  if (health.orphanPayments && health.orphanPayments.value > 0) {
    const { value, at } = health.orphanPayments;
    alerts.push({
      key: "orphans",
      text: `${plural(value, "paiement orphelin enregistré", "paiements orphelins enregistrés")} depuis la mise en service (dernier le ${formatDateShort(at, tz)}) : vérifiez-les dans Stripe`,
      href: null,
    });
  }
  if (health.horizonLag > 0) {
    alerts.push({
      key: "horizon",
      text: plural(health.horizonLag, "série en retard d'horizon", "séries en retard d'horizon"),
      href: null,
    });
  }
  return alerts;
}

export type NightlyCheck = { tone: "neutral" | "success" | "warning"; label: string };

/** The « Contrôle nocturne » row: the nightly job's last invariant check (null = it never ran). */
export function nightlyCheck(result: HealthCounts["invariantViolations"], tz: string): NightlyCheck {
  if (result === null) return { tone: "neutral", label: "Jamais exécuté" };
  const date = formatDateShort(result.at, tz);
  if (result.value === 0) return { tone: "success", label: `OK le ${date}` };
  return { tone: "warning", label: `${plural(result.value, "violation", "violations")} le ${date}` };
}
