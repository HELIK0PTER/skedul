/**
 * The pure view model of the RDV page (P5 dossier § 3.2, § 3.6, § 5 T11 and T12). Every date is read in the PRO's zone
 * and every day label from its DateKey, so the suite gives the same answers under any host zone: run it under
 * TZ=Europe/Paris and TZ=America/Los_Angeles.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { COPY } from "@/lib/public/messages";
import { formatMoney } from "@/lib/utils";

import {
  RDV_CARDS_TITLE,
  RDV_CHOSEN_LABEL,
  RDV_DAYS_LABEL,
  RDV_PICK_TITLE,
  RDV_PREV_WEEK,
  canSpendAt,
  lowestPriceCents,
  offersCoveringAt,
  rdvBookedLine,
  rdvCardVM,
  rdvDayChipLabel,
  rdvDaysVM,
  rdvDurationLabel,
  rdvPagePath,
  rdvPriceLabel,
  rdvSignInHint,
  rdvSlotCountLabel,
  rdvSlotMode,
  rdvTicketsOnlyLine,
  rdvTimesLabel,
  rdvWeekHref,
  rdvWeekKey,
  rdvWeekNav,
} from "./rdv-view";

const PARIS = "Europe/Paris";
const MIN = 60_000;
/** Wednesday 28 October 2026, 10:00 in Paris (CET, the Sunday before was the fall back). */
const NOW = new Date("2026-10-28T09:00:00Z");
const WINDOW = { bookingHorizonDays: 60, minNoticeMinutes: 120 };

test("rdvWeekKey: without a parameter, the week of now + notice in the pro's zone (O28)", () => {
  assert.equal(rdvWeekKey(undefined, NOW, PARIS, WINDOW), "2026-10-26", "a two-hour notice stays in this week");
  assert.equal(
    rdvWeekKey(undefined, NOW, PARIS, { ...WINDOW, minNoticeMinutes: 6 * 24 * 60 }),
    "2026-11-02",
    "a six-day notice opens next week first",
  );
  // Sunday 1 November 23:30 in Paris is still Sunday in UTC (22:30Z); one hour of notice lands on Monday in Paris only.
  const sundayNight = new Date("2026-11-01T22:30:00Z");
  assert.equal(rdvWeekKey(undefined, sundayNight, PARIS, { ...WINDOW, minNoticeMinutes: 60 }), "2026-11-02", "the pro's zone, never UTC");
  assert.equal(rdvWeekKey(undefined, sundayNight, PARIS, { ...WINDOW, minNoticeMinutes: 0 }), "2026-10-26");
});

test("rdvWeekKey: a notice above the horizon never points past the horizon week", () => {
  // Today + 7 days = Wednesday 4 November: the last week anything could be booked in starts on Monday 2 November.
  assert.equal(rdvWeekKey(undefined, NOW, PARIS, { bookingHorizonDays: 7, minNoticeMinutes: 40 * 24 * 60 }), "2026-11-02");
});

test("rdvWeekKey: a garbage parameter is ignored (the default week)", () => {
  for (const param of ["", "abc", "2026-02-30", "2026-13-01", "2026-1-05", "26-11-02", "2026-11-02T00:00", " 2026-11-02"]) {
    assert.equal(rdvWeekKey(param, NOW, PARIS, WINDOW), "2026-10-26", JSON.stringify(param));
  }
});

test("rdvWeekKey: a real date reads as the Monday of its week, from the current week to the horizon week", () => {
  assert.equal(rdvWeekKey("2026-11-05", NOW, PARIS, WINDOW), "2026-11-02", "a Thursday names its week");
  assert.equal(rdvWeekKey("2026-10-26", NOW, PARIS, WINDOW), "2026-10-26", "the current week");
  assert.equal(rdvWeekKey("2026-11-01", NOW, PARIS, WINDOW), "2026-10-26", "its Sunday too");
  const short = { bookingHorizonDays: 14, minNoticeMinutes: 120 };
  // Today + 14 = Wednesday 11 November: its week (from Monday 9) is the last one shown.
  assert.equal(rdvWeekKey("2026-11-12", NOW, PARIS, short), "2026-11-09", "the horizon week, past its last bookable day");
});

test("rdvWeekKey: a past week or a week beyond the horizon gives the default week", () => {
  assert.equal(rdvWeekKey("2026-10-19", NOW, PARIS, WINDOW), "2026-10-26", "last week");
  assert.equal(rdvWeekKey("2020-01-06", NOW, PARIS, WINDOW), "2026-10-26");
  const short = { bookingHorizonDays: 14, minNoticeMinutes: 120 };
  assert.equal(rdvWeekKey("2026-11-16", NOW, PARIS, short), "2026-10-26", "beyond the horizon week");
  assert.equal(rdvWeekKey("2099-01-05", NOW, PARIS, WINDOW), "2026-10-26");
});

test("rdvWeekNav: no previous week before the current week, no next week past the horizon week, and the shown week's own address (P6 A44)", () => {
  const short = { bookingHorizonDays: 14, minNoticeMinutes: 120 };
  const base = { slug: "altinha-paris", ticketTypeId: "tt_1", now: NOW, tz: PARIS, window: short };
  assert.deepEqual(rdvWeekNav({ ...base, weekKey: "2026-10-26" }), {
    weekKey: "2026-10-26",
    title: "26 octobre au 1er novembre 2026",
    selfHref: "/altinha-paris/rdv/tt_1?semaine=2026-10-26",
    prevHref: null,
    nextHref: "/altinha-paris/rdv/tt_1?semaine=2026-11-02",
  });
  assert.deepEqual(rdvWeekNav({ ...base, weekKey: "2026-11-02" }), {
    weekKey: "2026-11-02",
    title: "2 au 8 novembre 2026",
    selfHref: "/altinha-paris/rdv/tt_1?semaine=2026-11-02",
    prevHref: "/altinha-paris/rdv/tt_1?semaine=2026-10-26",
    nextHref: "/altinha-paris/rdv/tt_1?semaine=2026-11-09",
  });
  const last = rdvWeekNav({ ...base, weekKey: "2026-11-11" });
  assert.equal(last.weekKey, "2026-11-09", "any day reads as its Monday");
  assert.equal(last.selfHref, "/altinha-paris/rdv/tt_1?semaine=2026-11-09", "the Monday's address, what an end step keeps");
  assert.equal(last.prevHref, "/altinha-paris/rdv/tt_1?semaine=2026-11-02");
  assert.equal(last.nextHref, null, "the horizon week is the last");
});

test("rdvWeekHref: the week query only (no personal data), every segment encoded", () => {
  assert.equal(rdvWeekHref("altinha-paris", "tt_1", "2026-11-02"), "/altinha-paris/rdv/tt_1?semaine=2026-11-02");
  assert.equal(rdvWeekHref("a b", "x/y", "2026-11-02"), "/a%20b/rdv/x%2Fy?semaine=2026-11-02");
});

/** One slot of `minutes` from `startIso`. */
function slot(startIso: string, minutes = 30): { start: Date; end: Date } {
  const start = new Date(startIso);
  return { start, end: new Date(start.getTime() + minutes * MIN) };
}

test("rdvDaysVM: day labels from the DateKeys and times in the pro's zone across the October fall back", () => {
  // Saturday 24 October (CEST, UTC+2) and Sunday 25 October (CET, UTC+1): both slots are 10:00 in Paris.
  const days = rdvDaysVM(
    [
      { key: "2026-10-24", slots: [slot("2026-10-24T08:00:00Z")] },
      { key: "2026-10-25", slots: [slot("2026-10-25T09:00:00Z"), slot("2026-10-25T09:30:00Z")] },
      { key: "2026-10-26", slots: [] },
    ],
    PARIS,
  );
  assert.deepEqual(
    days.map((d) => [d.key, d.label, d.shortLabel, d.slots.map((s) => s.time)]),
    [
      ["2026-10-24", "samedi 24 octobre", "sam. 24", ["10:00"]],
      ["2026-10-25", "dimanche 25 octobre", "dim. 25", ["10:00", "10:30"]],
      ["2026-10-26", "lundi 26 octobre", "lun. 26", []],
    ],
  );
  const sunday = days[1].slots[0];
  assert.equal(sunday.iso, "2026-10-25T09:00:00.000Z", "the instant the server rendered, posted verbatim");
  assert.equal(sunday.ariaLabel, "dimanche 25 octobre 2026, 10:00 à 10:30", "the full date and time in the pro's zone");
  assert.equal(sunday.whenLabel, "dim. 25 octobre 2026 · 10:00 à 10:30");
});

test("rdvDaysVM: the March spring forward keeps the wall clock too, and the 1st of a month reads « 1er »", () => {
  // Saturday 28 March (CET, UTC+1) and Sunday 29 March (CEST, UTC+2).
  const days = rdvDaysVM(
    [
      { key: "2026-03-28", slots: [slot("2026-03-28T09:00:00Z", 60)] },
      { key: "2026-03-29", slots: [slot("2026-03-29T08:00:00Z", 60)] },
      { key: "2026-11-01", slots: [slot("2026-11-01T09:00:00Z", 45)] },
    ],
    PARIS,
  );
  assert.deepEqual(days[0].slots.map((s) => s.ariaLabel), ["samedi 28 mars 2026, 10:00 à 11:00"]);
  assert.deepEqual(days[1].slots.map((s) => s.ariaLabel), ["dimanche 29 mars 2026, 10:00 à 11:00"]);
  assert.equal(days[2].label, "dimanche 1er novembre");
  assert.equal(days[2].shortLabel, "dim. 1er");
  assert.equal(days[2].slots[0].ariaLabel, "dimanche 1er novembre 2026, 10:00 à 10:45");
});

test("rdvDaysVM: another zone reads its own wall clock (never the host's)", () => {
  const days = rdvDaysVM([{ key: "2026-10-25", slots: [slot("2026-10-25T16:00:00Z")] }], "America/Los_Angeles");
  assert.equal(days[0].slots[0].time, "09:00");
  assert.equal(days[0].slots[0].ariaLabel, "dimanche 25 octobre 2026, 09:00 à 09:30");
});

const START = "2026-11-02T09:00:00.000Z";

test("canSpendAt: a ticket expiring exactly at the start is not usable; leftAfter counts the usable ones minus the one spent", () => {
  const tickets = [{ expiresAt: null }, { expiresAt: START }, { expiresAt: "2026-11-10T00:00:00.000Z" }];
  assert.deepEqual(canSpendAt(tickets, START), { canSpend: true, leftAfter: 1 });
  assert.deepEqual(canSpendAt([{ expiresAt: START }], START), { canSpend: false, leftAfter: 0 }, "expires_at > starts_at, as ELIGIBLE");
  assert.deepEqual(canSpendAt([{ expiresAt: "2026-11-02T09:00:01.000Z" }], START), { canSpend: true, leftAfter: 0 });
  assert.deepEqual(canSpendAt([], START), { canSpend: false, leftAfter: 0 });
  assert.deepEqual(canSpendAt([{ expiresAt: null }], "2030-01-01T00:00:00.000Z"), { canSpend: true, leftAfter: 0 });
});

test("canSpendAt: leftAfter counts the tickets of this type usable at THIS start, not every ticket of the wallet", () => {
  // The page passes rdvOwnerTickets(…, ticketTypeId): this type only (rdv-reads.db.test.ts). Of those, a ticket that
  // ends before this start is not counted, so a later slot can leave fewer tickets than an earlier one.
  const ofThisType = [{ expiresAt: "2026-11-03T00:00:00.000Z" }, { expiresAt: "2026-11-20T00:00:00.000Z" }, { expiresAt: null }];
  assert.deepEqual(canSpendAt(ofThisType, START), { canSpend: true, leftAfter: 2 });
  assert.deepEqual(canSpendAt(ofThisType, "2026-11-05T09:00:00.000Z"), { canSpend: true, leftAfter: 1 });
  assert.deepEqual(canSpendAt(ofThisType, "2026-12-01T09:00:00.000Z"), { canSpend: true, leftAfter: 0 });
});

test("offersCoveringAt: an offer covers a start when it has no validity or its tickets end after the start (the engine's plan)", () => {
  const offers = [
    { offerId: "a", coversUntil: null },
    { offerId: "b", coversUntil: START },
    { offerId: "c", coversUntil: "2026-12-01T00:00:00.000Z" },
  ];
  assert.deepEqual(offersCoveringAt(offers, START), [offers[0], offers[2]], "the same objects, in the page's order");
  assert.deepEqual(offersCoveringAt(offers, "2026-12-01T00:00:00.000Z").map((o) => o.offerId), ["a"]);
  assert.deepEqual(offersCoveringAt([], START), []);
});

const OFFERS = [
  { offerId: "unit", coversUntil: "2026-11-30T00:00:00.000Z" },
  { offerId: "book", coversUntil: null },
];

test("rdvSlotMode: a free type always books for free (§ 3.6)", () => {
  assert.deepEqual(rdvSlotMode({ isFree: true, startsAtIso: START, ownerTickets: null, offers: [] }), { kind: "free" });
  assert.deepEqual(rdvSlotMode({ isFree: true, startsAtIso: START, ownerTickets: [{ expiresAt: null }], offers: OFFERS }), { kind: "free" });
});

test("rdvSlotMode: a paid type spends the Owner's ticket when one is usable at this start, and shows nothing else", () => {
  assert.deepEqual(
    rdvSlotMode({ isFree: false, startsAtIso: START, ownerTickets: [{ expiresAt: null }, { expiresAt: null }], offers: OFFERS }),
    { kind: "held", leftAfter: 1 },
  );
});

test("rdvSlotMode: otherwise a paid type buys, with the offers covering this start only (none: COPY.RDV_NO_OFFER)", () => {
  assert.deepEqual(rdvSlotMode({ isFree: false, startsAtIso: START, ownerTickets: null, offers: OFFERS }), { kind: "buy", offers: OFFERS });
  assert.deepEqual(
    rdvSlotMode({ isFree: false, startsAtIso: START, ownerTickets: [{ expiresAt: START }], offers: OFFERS }),
    { kind: "buy", offers: OFFERS },
    "the Owner's only ticket ends at the start",
  );
  const late = "2026-12-03T09:00:00.000Z";
  assert.deepEqual(rdvSlotMode({ isFree: false, startsAtIso: late, ownerTickets: [], offers: OFFERS }), { kind: "buy", offers: [OFFERS[1]] });
  assert.deepEqual(rdvSlotMode({ isFree: false, startsAtIso: late, ownerTickets: null, offers: [OFFERS[0]] }), { kind: "buy", offers: [] });
});

test("rdvSlotMode: a paid type with no offer on sale at all is for ticket holders only, never « no offer covers this date » (R3)", () => {
  for (const ownerTickets of [null, [], [{ expiresAt: START }]]) {
    assert.deepEqual(rdvSlotMode({ isFree: false, startsAtIso: START, ownerTickets, offers: [] }), { kind: "tickets_only" }, JSON.stringify(ownerTickets));
  }
  assert.deepEqual(
    rdvSlotMode({ isFree: false, startsAtIso: START, ownerTickets: [{ expiresAt: null }], offers: [] }),
    { kind: "held", leftAfter: 0 },
    "a ticket usable at the start still books it",
  );
  // Offers on sale that do not cover the start keep the buy mode with no offer (COPY.RDV_NO_OFFER).
  const late = "2026-12-03T09:00:00.000Z";
  assert.deepEqual(rdvSlotMode({ isFree: false, startsAtIso: late, ownerTickets: null, offers: [OFFERS[0]] }), { kind: "buy", offers: [] });
});

test("rdvTicketsOnlyLine: the type is booked with a ticket already held; an anonymous visitor is pointed to « J'ai déjà des tickets » (R3)", () => {
  assert.equal(COPY.RDV_TICKETS_ONLY, "Aucune offre n'est en vente en ligne : ce rendez-vous se réserve avec un ticket que vous avez déjà.");
  assert.equal(
    rdvTicketsOnlyLine("prompt"),
    "Aucune offre n'est en vente en ligne : ce rendez-vous se réserve avec un ticket que vous avez déjà. Pour l'utiliser, cliquez sur « J'ai déjà des tickets ».",
  );
  assert.ok(rdvTicketsOnlyLine("prompt").endsWith(`« ${COPY.HAVE_TICKETS} ».`), "the label of the prompt's own button");
  assert.equal(rdvTicketsOnlyLine("confirm"), COPY.RDV_TICKETS_ONLY, "an unverified visitor already reads « Confirmez votre email pour utiliser vos tickets. »");
  assert.equal(rdvTicketsOnlyLine(null), COPY.RDV_TICKETS_ONLY, "a signed-in visitor has no prompt to point to");
  assert.notEqual(COPY.RDV_TICKETS_ONLY, COPY.RDV_NO_OFFER);
});

test("rdvSignInHint: an anonymous visitor of a paid type is offered the code sign-in, an unverified one is asked to confirm", () => {
  assert.equal(rdvSignInHint({ isFree: false, state: "anonymous" }), "prompt");
  assert.equal(rdvSignInHint({ isFree: false, state: "unverified" }), "confirm");
  assert.equal(rdvSignInHint({ isFree: false, state: "verified" }), null);
  assert.equal(rdvSignInHint({ isFree: false, state: "impersonating" }), null, "an admin has no client identity");
  for (const state of ["anonymous", "unverified", "verified", "impersonating"] as const) {
    assert.equal(rdvSignInHint({ isFree: true, state }), null, `${state}: a free type needs no ticket`);
  }
});

test("rdvDurationLabel: minutes, hours and the rest, with the plural", () => {
  assert.equal(rdvDurationLabel(1), "1 minute");
  assert.equal(rdvDurationLabel(30), "30 minutes");
  assert.equal(rdvDurationLabel(60), "1 heure");
  assert.equal(rdvDurationLabel(90), "1 heure 30");
  assert.equal(rdvDurationLabel(120), "2 heures");
  assert.equal(rdvDurationLabel(135), "2 heures 15");
});

test("rdvPriceLabel: « Gratuit », « À partir de » the lowest price through formatMoney, nothing without an offer on sale", () => {
  assert.equal(rdvPriceLabel({ isFree: true, fromPriceCents: null }, "eur"), "Gratuit");
  assert.equal(rdvPriceLabel({ isFree: true, fromPriceCents: 1200 }, "eur"), "Gratuit", "a free type never shows a price");
  assert.equal(rdvPriceLabel({ isFree: false, fromPriceCents: 2500 }, "eur"), `À partir de ${formatMoney(2500, "eur")}`);
  assert.equal(rdvPriceLabel({ isFree: false, fromPriceCents: 1250 }, "eur"), `À partir de ${formatMoney(1250, "eur")}`);
  assert.equal(rdvPriceLabel({ isFree: false, fromPriceCents: null }, "eur"), null);
});

test("lowestPriceCents: the lowest price of the offers on sale, null without any", () => {
  assert.equal(lowestPriceCents([]), null);
  assert.equal(lowestPriceCents([{ priceCents: 4500 }, { priceCents: 1500 }, { priceCents: 2500 }]), 1500);
  assert.equal(lowestPriceCents([{ priceCents: 50 }]), 50);
});

test("the RDV booking copy: counts, the booked line and the labels", () => {
  assert.equal(rdvSlotCountLabel(0), "aucun créneau");
  assert.equal(rdvSlotCountLabel(1), "1 créneau");
  assert.equal(rdvSlotCountLabel(12), "12 créneaux");
  assert.equal(rdvDayChipLabel({ label: "lundi 2 novembre", slots: [1, 2, 3] }), "lundi 2 novembre, 3 créneaux");
  assert.equal(rdvDayChipLabel({ label: "mardi 3 novembre", slots: [] }), "mardi 3 novembre, aucun créneau");
  assert.equal(RDV_PREV_WEEK, "Semaine précédente");
  assert.equal(RDV_CHOSEN_LABEL, "Créneau choisi");
  assert.equal(rdvTimesLabel("lundi 2 novembre"), "Créneaux du lundi 2 novembre");
  const when = "lun. 2 novembre 2026 · 10:00 à 10:30";
  assert.equal(rdvBookedLine(when, false), `Rendez-vous confirmé : ${when}. Un email de confirmation vous a été envoyé.`);
  assert.equal(rdvBookedLine(when, true), `Rendez-vous confirmé avec 1 ticket : ${when}. Un email de confirmation vous a été envoyé.`);
});

const CARD = {
  ticketTypeId: "type-1",
  name: "Cours particulier",
  description: "Un cours rien que pour vous.",
  durationMin: 60,
  isFree: false,
  fromPriceCents: 5000,
};

test("rdvCardVM: « Gratuit » or « À partir de » the lowest price through formatMoney, the duration, the link and its name (§ 3.11, O8)", () => {
  assert.deepEqual(rdvCardVM(CARD, "altinha-paris", "eur"), {
    ticketTypeId: "type-1",
    name: "Cours particulier",
    description: "Un cours rien que pour vous.",
    durationLabel: "1 heure",
    priceLabel: `À partir de ${formatMoney(5000, "eur")}`,
    isFree: false,
    href: "/altinha-paris/rdv/type-1",
    ctaLabel: "Réserver un rendez-vous",
    ctaAriaLabel: "Réserver un rendez-vous : Cours particulier",
  });
  const free = rdvCardVM({ ...CARD, isFree: true, fromPriceCents: null, durationMin: 15, description: null }, "altinha-paris", "eur");
  assert.equal(free.priceLabel, "Gratuit");
  assert.equal(free.isFree, true);
  assert.equal(free.durationLabel, "15 minutes", "plural");
  assert.equal(free.description, null);
  assert.equal(rdvCardVM({ ...CARD, durationMin: 1 }, "s", "eur").durationLabel, "1 minute", "singular");
  assert.equal(rdvCardVM({ ...CARD, durationMin: 120 }, "s", "eur").durationLabel, "2 heures", "plural hours");
  assert.equal(rdvCardVM({ ...CARD, fromPriceCents: 1250 }, "s", "usd").priceLabel, `À partir de ${formatMoney(1250, "usd")}`, "the pro's currency");
  assert.equal(rdvCardVM({ ...CARD, fromPriceCents: null }, "s", "eur").priceLabel, null, "a paid type with nothing on sale shows no price");
  assert.equal(rdvCardVM({ ...CARD, ticketTypeId: "a/b" }, "mon slug", "eur").href, "/mon%20slug/rdv/a%2Fb", "every segment encoded");
  assert.equal(RDV_CARDS_TITLE, "Prendre rendez-vous");
});

test("rdvPagePath: the RDV page of a type (cards, espace, back office), every segment encoded, no query", () => {
  assert.equal(rdvPagePath("altinha-paris", "EvtfIcW2lCiYuM7GZEbHh"), "/altinha-paris/rdv/EvtfIcW2lCiYuM7GZEbHh");
  assert.equal(rdvPagePath("mon slug", "a/b"), "/mon%20slug/rdv/a%2Fb");
  assert.equal(rdvWeekHref("s", "t", "2026-11-02"), `${rdvPagePath("s", "t")}?semaine=2026-11-02`);
});

test("no RDV text names a séance, an inscription or a place, and none holds a dash (P5 copy rule)", () => {
  const SEANCE_WORDS = /[Ss][ée]ance|[Ii]nscri|(^|[^a-zà-ÿ])place([^a-zà-ÿ]|$)/;
  const dash = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
  const card = rdvCardVM(CARD, "s", "eur");
  const texts = [
    RDV_CARDS_TITLE,
    card.ctaLabel,
    card.ctaAriaLabel,
    card.durationLabel,
    card.priceLabel ?? "",
    RDV_PICK_TITLE,
    RDV_DAYS_LABEL,
    RDV_PREV_WEEK,
    RDV_CHOSEN_LABEL,
    rdvDayChipLabel({ label: "lundi 2 novembre", slots: [1] }),
    rdvSlotCountLabel(0),
    rdvSlotCountLabel(3),
    rdvTimesLabel("lundi 2 novembre"),
    rdvBookedLine("x", false),
    rdvBookedLine("x", true),
    rdvDurationLabel(90),
    rdvPriceLabel({ isFree: false, fromPriceCents: 100 }, "eur") ?? "",
    rdvTicketsOnlyLine("prompt"),
    rdvTicketsOnlyLine(null),
  ];
  for (const text of texts) {
    assert.doesNotMatch(text, SEANCE_WORDS, text);
    assert.doesNotMatch(text, dash, text);
  }
});
