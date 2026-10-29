/**
 * Client list rules (Q4 listing, Q5 filters). Pure: the SQL twin of these
 * predicates lives in client-reads.ts, which feeds `ClientFacts` to them.
 */

export const CLIENT_FILTERS = ["tous", "tickets", "a-venir", "alertes"] as const;
export type ClientFilter = (typeof CLIENT_FILTERS)[number];

export const CLIENT_FILTER_LABELS: Record<ClientFilter, string> = {
  tous: "Tous",
  tickets: "Avec tickets",
  "a-venir": "Réservations à venir",
  alertes: "Alertes",
};

/** ?filter= value; "credits" (v1) → "tickets"; unknown → "tous". */
export function parseClientFilter(value: unknown): ClientFilter {
  if (value === "credits") return "tickets";
  return typeof value === "string" && (CLIENT_FILTERS as readonly string[]).includes(value)
    ? (value as ClientFilter)
    : "tous";
}

export type ClientFacts = {
  /** tickets available and valid now, archived types included */
  usableTickets: number;
  /** confirmed bookings on a future séance or RDV */
  upcomingConfirmed: number;
  red: boolean;
  orange: boolean;
  /** confirmed bookings, ever */
  confirmedBookings: number;
  /** tickets in any state */
  ticketsAny: number;
  /** bookings in any state */
  bookingsAny: number;
  /** purchases in any state */
  purchasesAny: number;
};

/** Spec § 9: a confirmed booking ever, or at least one ticket in any state. */
export function isClient(f: Pick<ClientFacts, "confirmedBookings" | "ticketsAny">): boolean {
  return f.confirmedBookings > 0 || f.ticketsAny > 0;
}

/** Q4: shown in the list = isClient, or never booked nor bought anything (a « Nouveau client »). */
export function isListedClient(f: ClientFacts): boolean {
  return isClient(f) || (f.bookingsAny === 0 && f.purchasesAny === 0 && f.ticketsAny === 0);
}

/** Q5: tickets = usable > 0 (archived types included); a-venir = a confirmed booking on a future séance or RDV; alertes = red or orange. */
export function matchesClientFilter(f: ClientFacts, filter: ClientFilter): boolean {
  switch (filter) {
    case "tous":
      return true;
    case "tickets":
      return f.usableTickets > 0;
    case "a-venir":
      return f.upcomingConfirmed > 0;
    case "alertes":
      return f.red || f.orange;
  }
}

/**
 * /dashboard/clients or /dashboard/clients?filter=… : the filter only. The pro's search term (a client's name or
 * e-mail) is never part of a URL: it would reach the address bar, the history and the platform request log
 * (Decision 73, FR:UI-13). The search runs through searchClientsAction and lives in component state.
 */
export function clientsHref(filter: ClientFilter): string {
  return filter === "tous" ? "/dashboard/clients" : `/dashboard/clients?filter=${filter}`;
}
