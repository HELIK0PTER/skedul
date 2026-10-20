/**
 * Overview view models: KPI tiles (Q25), alert lines (Q28), getting started
 * steps (Q29). Pure: the reads (dashboard-reads.ts, Task 37) feed the inputs.
 */
import { clientsHref } from "@/lib/back-office/client-filters";
import { formatCount, plural } from "@/lib/back-office/format";
import type { AlertTone } from "@/lib/back-office/labels";
import { formatMoney } from "@/lib/utils";

export type KpiInput = {
  upcomingSeances7d: number;
  upcomingRegistrants7d: number;
  ticketsInCirculation: number;
  clients: number;
  revenue: readonly { currency: string; cents: number }[];
  currency: string;
};

export type KpiTile = {
  key: "seances" | "tickets" | "clients" | "revenue";
  label: string;
  value: string;
  hint: string | null;
  href: string;
};

/** Q25: the pro currency first (0 when absent), the other currencies after, biggest first. */
export function revenueDisplay(
  revenue: readonly { currency: string; cents: number }[],
  currency: string,
): { main: string; others: string[] } {
  const home = currency.toLowerCase();
  const totals = new Map<string, number>();
  for (const r of revenue) {
    const code = r.currency.toLowerCase();
    totals.set(code, (totals.get(code) ?? 0) + r.cents);
  }
  const others = [...totals.entries()]
    .filter(([code]) => code !== home)
    .sort(([codeA, a], [codeB, b]) => b - a || (codeA < codeB ? -1 : codeA > codeB ? 1 : 0))
    .map(([code, cents]) => formatMoney(cents, code));
  return { main: formatMoney(totals.get(home) ?? 0, home), others };
}

/** The 4 tiles of the overview. */
export function kpiTiles(input: KpiInput): KpiTile[] {
  const revenue = revenueDisplay(input.revenue, input.currency);
  return [
    {
      key: "seances",
      label: "Séances à venir (7 j)",
      value: formatCount(input.upcomingSeances7d),
      hint: `dont ${plural(input.upcomingRegistrants7d, "inscrit", "inscrits")}`,
      href: "/dashboard/planning",
    },
    {
      key: "tickets",
      label: "Tickets en circulation",
      value: formatCount(input.ticketsInCirculation),
      hint: null,
      href: clientsHref("tickets", ""),
    },
    { key: "clients", label: "Clients", value: formatCount(input.clients), hint: null, href: clientsHref("tous", "") },
    {
      key: "revenue",
      label: "Encaissé",
      value: revenue.main,
      hint: revenue.others.length > 0 ? revenue.others.join(" · ") : null,
      href: "/dashboard/payments",
    },
  ];
}

export type DashboardAlert = { key: string; tone: AlertTone; text: string; href: string };

/** Q28 alert lines, red first, then orange (clients, then one per event). */
export function dashboardAlerts(input: {
  redClients: number;
  orangeClients: number;
  eventsWithoutActiveType: readonly { eventId: string; title: string }[];
}): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];
  if (input.redClients > 0) {
    alerts.push({
      key: "red-clients",
      tone: "red",
      text: `${plural(input.redClients, "client a", "clients ont")} des tickets d'un type archivé.`,
      href: clientsHref("alertes", ""),
    });
  }
  if (input.orangeClients > 0) {
    alerts.push({
      key: "orange-clients",
      tone: "orange",
      text: `${plural(input.orangeClients, "client a", "clients ont")} des tickets d'un type lié à aucun événement à venir.`,
      href: clientsHref("alertes", ""),
    });
  }
  for (const e of input.eventsWithoutActiveType) {
    alerts.push({
      key: `event-${e.eventId}`,
      tone: "orange",
      text: `« ${e.title} » n'accepte aucun ticket actif.`,
      href: `/dashboard/events/${e.eventId}`,
    });
  }
  return alerts;
}

export type GettingStartedStep = { key: "type" | "offer" | "event"; label: string; done: boolean; href: string };

/** Q29: the 3 steps, or null once all are done. */
export function gettingStartedSteps(input: {
  hasType: boolean;
  hasOffer: boolean;
  hasEvent: boolean;
  firstTypeId: string | null;
}): GettingStartedStep[] | null {
  const steps: GettingStartedStep[] = [
    { key: "type", label: "Créer un type de ticket", done: input.hasType, href: "/dashboard/tickets" },
    {
      key: "offer",
      label: "Créer une offre",
      done: input.hasOffer,
      href: input.firstTypeId ? `/dashboard/tickets/${input.firstTypeId}` : "/dashboard/tickets",
    },
    { key: "event", label: "Créer un événement", done: input.hasEvent, href: "/dashboard/events/new" },
  ];
  return steps.every((s) => s.done) ? null : steps;
}
