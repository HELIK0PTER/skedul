import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_FILTERS,
  CLIENT_FILTER_LABELS,
  clientsHref,
  isClient,
  isListedClient,
  matchesClientFilter,
  parseClientFilter,
  type ClientFacts,
} from "./client-filters";

const facts = (over: Partial<ClientFacts> = {}): ClientFacts => ({
  usableTickets: 0,
  upcomingConfirmed: 0,
  red: false,
  orange: false,
  confirmedBookings: 0,
  ticketsAny: 0,
  bookingsAny: 0,
  purchasesAny: 0,
  ...over,
});

test("parseClientFilter: the four filters, the v1 « credits » alias, everything else is « tous »", () => {
  for (const f of CLIENT_FILTERS) assert.equal(parseClientFilter(f), f);
  assert.equal(parseClientFilter("credits"), "tickets");
  for (const bad of ["", "nope", "TICKETS", undefined, null, 3, ["tickets"]]) assert.equal(parseClientFilter(bad), "tous");
});

test("CLIENT_FILTERS and their labels", () => {
  assert.deepEqual([...CLIENT_FILTERS], ["tous", "tickets", "a-venir", "alertes"]);
  assert.deepEqual(CLIENT_FILTER_LABELS, {
    tous: "Tous",
    tickets: "Avec tickets",
    "a-venir": "Inscriptions à venir",
    alertes: "Alertes",
  });
});

test("isClient: a confirmed booking ever, or a ticket in any state", () => {
  assert.equal(isClient({ confirmedBookings: 1, ticketsAny: 0 }), true);
  assert.equal(isClient({ confirmedBookings: 0, ticketsAny: 1 }), true);
  assert.equal(isClient({ confirmedBookings: 0, ticketsAny: 0 }), false);
  assert.equal(isClient(facts({ bookingsAny: 3, purchasesAny: 2 })), false);
});

test("isListedClient: isClient, or a customer who never booked nor bought anything", () => {
  assert.equal(isListedClient(facts()), true); // « Nouveau client »
  assert.equal(isListedClient(facts({ purchasesAny: 1 })), false); // only a pending or expired purchase
  assert.equal(isListedClient(facts({ bookingsAny: 1 })), false); // only a cancelled or pending booking
  assert.equal(isListedClient(facts({ bookingsAny: 1, confirmedBookings: 1 })), true);
  assert.equal(isListedClient(facts({ ticketsAny: 2 })), true); // offered tickets only
  assert.equal(isListedClient(facts({ ticketsAny: 1, purchasesAny: 1, bookingsAny: 1 })), true);
});

test("matchesClientFilter: each filter", () => {
  const holder = facts({ usableTickets: 2, ticketsAny: 2 });
  const upcoming = facts({ upcomingConfirmed: 1, confirmedBookings: 1 });
  const red = facts({ red: true, usableTickets: 1, ticketsAny: 1 });
  const orange = facts({ orange: true, usableTickets: 1, ticketsAny: 1 });
  const quiet = facts({ ticketsAny: 3 }); // tickets, none usable
  for (const f of [holder, upcoming, red, orange, quiet, facts()]) assert.equal(matchesClientFilter(f, "tous"), true);
  assert.deepEqual([holder, upcoming, red, orange, quiet].map((f) => matchesClientFilter(f, "tickets")), [true, false, true, true, false]);
  assert.deepEqual([holder, upcoming, red, orange, quiet].map((f) => matchesClientFilter(f, "a-venir")), [false, true, false, false, false]);
  assert.deepEqual([holder, upcoming, red, orange, quiet].map((f) => matchesClientFilter(f, "alertes")), [false, false, true, true, false]);
});

test("clientsHref: empty parts are omitted, the query is encoded", () => {
  assert.equal(clientsHref("tous", ""), "/dashboard/clients");
  assert.equal(clientsHref("tickets", ""), "/dashboard/clients?filter=tickets");
  assert.equal(clientsHref("tous", "mar"), "/dashboard/clients?q=mar");
  assert.equal(clientsHref("a-venir", "mar"), "/dashboard/clients?filter=a-venir&q=mar");
  assert.equal(clientsHref("alertes", "  léa martin "), "/dashboard/clients?filter=alertes&q=l%C3%A9a%20martin");
  assert.equal(clientsHref("tous", "   "), "/dashboard/clients");
});
