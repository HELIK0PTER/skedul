import assert from "node:assert/strict";
import test from "node:test";

import { formatMoney } from "@/lib/utils";

import { dashboardAlerts, gettingStartedSteps, kpiTiles, revenueDisplay, type KpiInput } from "./dashboard-view";

const DASHES = /[\u2013\u2014]/;

const kpi = (over: Partial<KpiInput> = {}): KpiInput => ({
  upcomingSeances7d: 4,
  upcomingRegistrants7d: 9,
  ticketsInCirculation: 37,
  clients: 12,
  revenue: [{ currency: "eur", cents: 47500 }],
  currency: "eur",
  ...over,
});

test("revenueDisplay: the pro currency first, 0 when it is absent", () => {
  assert.deepEqual(revenueDisplay([{ currency: "eur", cents: 47500 }], "eur"), { main: formatMoney(47500, "eur"), others: [] });
  assert.deepEqual(revenueDisplay([], "eur"), { main: formatMoney(0, "eur"), others: [] });
  assert.deepEqual(revenueDisplay([{ currency: "usd", cents: 5000 }], "eur"), {
    main: formatMoney(0, "eur"),
    others: [formatMoney(5000, "usd")],
  });
});

test("revenueDisplay: the other currencies come after, biggest first; rows of one currency add up", () => {
  const out = revenueDisplay(
    [
      { currency: "usd", cents: 5000 },
      { currency: "gbp", cents: 12000 },
      { currency: "EUR", cents: 10000 },
      { currency: "eur", cents: 2500 },
    ],
    "eur",
  );
  assert.deepEqual(out, { main: formatMoney(12500, "eur"), others: [formatMoney(12000, "gbp"), formatMoney(5000, "usd")] });
});

test("kpiTiles: the four tiles, exact labels, values, hints and links", () => {
  assert.deepEqual(kpiTiles(kpi()), [
    { key: "seances", label: "Séances à venir (7 j)", value: "4", hint: "dont 9 inscrits", href: "/dashboard/planning" },
    { key: "tickets", label: "Tickets en circulation", value: "37", hint: null, href: "/dashboard/clients?filter=tickets" },
    { key: "clients", label: "Clients", value: "12", hint: null, href: "/dashboard/clients" },
    { key: "revenue", label: "Encaissé", value: formatMoney(47500, "eur"), hint: null, href: "/dashboard/payments" },
  ]);
});

test("kpiTiles: singular registrant, other currencies in the revenue hint, no pro currency revenue", () => {
  const tiles = kpiTiles(
    kpi({
      upcomingSeances7d: 1,
      upcomingRegistrants7d: 1,
      revenue: [
        { currency: "usd", cents: 5000 },
        { currency: "gbp", cents: 12000 },
      ],
    }),
  );
  assert.equal(tiles[0].hint, "dont 1 inscrit");
  assert.equal(tiles[3].value, formatMoney(0, "eur"));
  assert.equal(tiles[3].hint, `${formatMoney(12000, "gbp")} · ${formatMoney(5000, "usd")}`);
});

test("dashboardAlerts: red first, plurals 1 and 2", () => {
  assert.deepEqual(dashboardAlerts({ redClients: 1, orangeClients: 1, eventsWithoutActiveType: [] }), [
    {
      key: "red-clients",
      tone: "red",
      text: "1 client a des tickets d'un type archivé.",
      href: "/dashboard/clients?filter=alertes",
    },
    {
      key: "orange-clients",
      tone: "orange",
      text: "1 client a des tickets d'un type lié à aucun événement à venir.",
      href: "/dashboard/clients?filter=alertes",
    },
  ]);
  const two = dashboardAlerts({ redClients: 2, orangeClients: 3, eventsWithoutActiveType: [] });
  assert.equal(two[0].text, "2 clients ont des tickets d'un type archivé.");
  assert.equal(two[1].text, "3 clients ont des tickets d'un type lié à aucun événement à venir.");
});

test("dashboardAlerts: one orange line per event without an active type; none when all is well", () => {
  assert.deepEqual(dashboardAlerts({ redClients: 0, orangeClients: 0, eventsWithoutActiveType: [] }), []);
  assert.deepEqual(
    dashboardAlerts({
      redClients: 0,
      orangeClients: 0,
      eventsWithoutActiveType: [
        { eventId: "e1", title: "Roda libre" },
        { eventId: "e2", title: "Atelier technique" },
      ],
    }),
    [
      { key: "event-e1", tone: "orange", text: "« Roda libre » n'accepte aucun ticket actif.", href: "/dashboard/events/e1" },
      { key: "event-e2", tone: "orange", text: "« Atelier technique » n'accepte aucun ticket actif.", href: "/dashboard/events/e2" },
    ],
  );
  const mixed = dashboardAlerts({ redClients: 2, orangeClients: 0, eventsWithoutActiveType: [{ eventId: "e1", title: "Roda libre" }] });
  assert.deepEqual(mixed.map((a) => [a.tone, a.key]), [["red", "red-clients"], ["orange", "event-e1"]]);
});

test("gettingStartedSteps: three steps with their links, null once all are done", () => {
  assert.deepEqual(gettingStartedSteps({ hasType: false, hasOffer: false, hasEvent: false, firstTypeId: null }), [
    { key: "type", label: "Créer un type de ticket", done: false, href: "/dashboard/tickets" },
    { key: "offer", label: "Créer une offre", done: false, href: "/dashboard/tickets" },
    { key: "event", label: "Créer un événement", done: false, href: "/dashboard/events/new" },
  ]);
  assert.deepEqual(gettingStartedSteps({ hasType: true, hasOffer: false, hasEvent: false, firstTypeId: "t1" }), [
    { key: "type", label: "Créer un type de ticket", done: true, href: "/dashboard/tickets" },
    { key: "offer", label: "Créer une offre", done: false, href: "/dashboard/tickets/t1" },
    { key: "event", label: "Créer un événement", done: false, href: "/dashboard/events/new" },
  ]);
  assert.equal(gettingStartedSteps({ hasType: true, hasOffer: true, hasEvent: true, firstTypeId: "t1" }), null);
  assert.notEqual(gettingStartedSteps({ hasType: true, hasOffer: true, hasEvent: false, firstTypeId: "t1" }), null);
});

test("dashboard view models never contain a dash", () => {
  const strings: string[] = [];
  for (const t of kpiTiles(kpi({ revenue: [{ currency: "usd", cents: 5000 }] }))) strings.push(t.label, t.value, t.hint ?? "");
  for (const a of dashboardAlerts({ redClients: 2, orangeClients: 2, eventsWithoutActiveType: [{ eventId: "e1", title: "Roda libre" }] })) {
    strings.push(a.text);
  }
  for (const s of gettingStartedSteps({ hasType: false, hasOffer: false, hasEvent: false, firstTypeId: null }) ?? []) strings.push(s.label);
  for (const text of strings) assert.ok(!DASHES.test(text), text);
});
