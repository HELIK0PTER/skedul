import assert from "node:assert/strict";
import test from "node:test";

import { escapeHtml } from "@/lib/email-layout";

import { attendeeMovedEmail, type AttendeeMovedArgs } from "./attendee-moved";
import { bookingCancelledEmail, type BookingCancelledArgs } from "./booking-cancelled";
import { bookingConfirmedEmail, type BookingConfirmedArgs } from "./booking-confirmed";
import { occurrenceCancelledEmail, type OccurrenceCancelledArgs } from "./occurrence-cancelled";
import { occurrenceChangedEmail, type OccurrenceChangedArgs } from "./occurrence-changed";
import { mailButton, mailDetails, mailParagraph, mailPersonalLink, oneLine } from "./parts";
import { ticketsOfferedEmail, type TicketsOfferedArgs } from "./tickets-offered";

const EVIL = `<script>&"'`;
const EVIL_ESCAPED = "&lt;script&gt;&amp;&quot;&#39;";
const DASH = /[\u2014\u2013]/;
const LINK = "https://myskedul.com/api/c/cus_1.3.signature";
const FOOTER = "Envoyé par Skedul · Réservations et tickets";

type Mail = { subject: string; html: string };

/** Escaped copy of a plain sentence, the way it appears in the HTML. */
const h = escapeHtml;

const confirmed: BookingConfirmedArgs = {
  customerName: "Beatriz Almeida",
  businessName: "Altinha Paris",
  title: "Altinha débutants",
  whenLabel: "lun. 12 octobre 2026 · 19:00 à 20:00",
  location: "Parc de la Villette",
  coverageLabel: "Ticket",
  ticketTypeName: "Cours collectif",
  ticketsLeft: [
    {
      typeName: "Cours collectif",
      count: 3,
      expiry: [
        { count: 2, text: "valables jusqu'au 12/01 inclus" },
        { count: 1, text: "sans limite de validité" },
      ],
    },
    { typeName: "Cours d'essai", count: 1, expiry: [{ count: 1, text: "sans limite de validité" }] },
    { typeName: "Carnet", count: 4, expiry: [{ count: 4, text: "valables jusqu'au 15/04/2027 inclus" }] },
  ],
  cancelText: "Vous pouvez annuler en ligne jusqu'à 24 h avant le début.",
  personalLinkUrl: LINK,
  calendar: {
    googleUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Altinha",
    outlookUrl: "https://outlook.live.com/calendar/0/deeplink/compose?subject=Altinha",
    icsUrl: "https://myskedul.com/api/ics/bk_1",
  },
};

const cancelled: BookingCancelledArgs = {
  customerName: "Beatriz Almeida",
  businessName: "Altinha Paris",
  title: "Altinha débutants",
  whenLabel: "lun. 12 octobre 2026 · 19:00 à 20:00",
  by: "pro",
  ticketReturned: true,
  reason: "Terrain fermé",
  personalLinkUrl: LINK,
};

const changed: OccurrenceChangedArgs = {
  customerName: "Beatriz Almeida",
  businessName: "Altinha Paris",
  title: "Altinha débutants",
  whenLabel: "mar. 13 octobre 2026 · 19:30 à 20:30",
  location: "Gymnase Japy",
  canCancelUntilStart: true,
  personalLinkUrl: LINK,
};

const seanceCancelled: OccurrenceCancelledArgs = {
  kind: "seance",
  customerName: "Beatriz Almeida",
  businessName: "Altinha Paris",
  title: "Altinha débutants",
  whenLabel: "lun. 12 octobre 2026 · 19:00 à 20:00",
  ticketReturned: true,
  personalLinkUrl: LINK,
};

const moved: AttendeeMovedArgs = {
  customerName: "Beatriz Almeida",
  businessName: "Altinha Paris",
  fromTitle: "Altinha débutants",
  fromWhenLabel: "lun. 12 octobre 2026 · 19:00 à 20:00",
  toTitle: "Altinha intermédiaires",
  toWhenLabel: "mer. 14 octobre 2026 · 20:00 à 21:00",
  toLocation: "Gymnase Japy",
  personalLinkUrl: LINK,
};

const offered: TicketsOfferedArgs = {
  customerName: "Beatriz Almeida",
  businessName: "Altinha Paris",
  typeName: "Cours collectif",
  count: 3,
  expiryText: "valables jusqu'au 12/01 inclus",
  personalLinkUrl: LINK,
};

/** Every template with a normal argument set, a hostile one (all strings = EVIL) and its title. */
const TEMPLATES: { name: string; normal: Mail; evil: Mail; title: string }[] = [
  {
    name: "booking-confirmed",
    title: confirmed.title,
    normal: bookingConfirmedEmail(confirmed),
    evil: bookingConfirmedEmail({
      customerName: EVIL,
      businessName: EVIL,
      title: EVIL,
      whenLabel: EVIL,
      location: EVIL,
      coverageLabel: EVIL,
      ticketTypeName: EVIL,
      ticketsLeft: [
        {
          typeName: EVIL,
          count: 2,
          expiry: [
            { count: 1, text: EVIL },
            { count: 1, text: EVIL },
          ],
        },
      ],
      cancelText: EVIL,
      personalLinkUrl: EVIL,
      calendar: { googleUrl: EVIL, outlookUrl: EVIL, icsUrl: EVIL },
    }),
  },
  {
    name: "booking-cancelled",
    title: cancelled.title,
    normal: bookingCancelledEmail(cancelled),
    evil: bookingCancelledEmail({
      customerName: EVIL,
      businessName: EVIL,
      title: EVIL,
      whenLabel: EVIL,
      by: "pro",
      ticketReturned: true,
      reason: EVIL,
      personalLinkUrl: EVIL,
    }),
  },
  {
    name: "occurrence-changed",
    title: changed.title,
    normal: occurrenceChangedEmail(changed),
    evil: occurrenceChangedEmail({
      customerName: EVIL,
      businessName: EVIL,
      title: EVIL,
      whenLabel: EVIL,
      location: EVIL,
      canCancelUntilStart: true,
      personalLinkUrl: EVIL,
    }),
  },
  {
    name: "occurrence-cancelled",
    title: seanceCancelled.title,
    normal: occurrenceCancelledEmail(seanceCancelled),
    evil: occurrenceCancelledEmail({
      kind: "seance",
      customerName: EVIL,
      businessName: EVIL,
      title: EVIL,
      whenLabel: EVIL,
      ticketReturned: true,
      personalLinkUrl: EVIL,
    }),
  },
  {
    name: "attendee-moved",
    title: moved.toTitle,
    normal: attendeeMovedEmail(moved),
    evil: attendeeMovedEmail({
      customerName: EVIL,
      businessName: EVIL,
      fromTitle: EVIL,
      fromWhenLabel: EVIL,
      toTitle: EVIL,
      toWhenLabel: EVIL,
      toLocation: EVIL,
      personalLinkUrl: EVIL,
    }),
  },
  {
    name: "tickets-offered",
    title: offered.businessName,
    normal: ticketsOfferedEmail(offered),
    evil: ticketsOfferedEmail({
      customerName: EVIL,
      businessName: EVIL,
      typeName: EVIL,
      count: 2,
      expiryText: EVIL,
      personalLinkUrl: EVIL,
    }),
  },
];

test("parts: paragraph, details, button and personal link escape their input", () => {
  assert.equal(mailParagraph(EVIL), `<p>${EVIL_ESCAPED}</p>`);
  const details = mailDetails([{ label: EVIL, value: EVIL }]);
  assert.ok(details.includes(`>${EVIL_ESCAPED}</td><td style="text-align:right">${EVIL_ESCAPED}</td>`));
  assert.ok(!details.includes("<script>"));
  const button = mailButton(`https://x.example/?a=1&b="2"`, EVIL);
  assert.ok(button.includes(`href="https://x.example/?a=1&amp;b=&quot;2&quot;"`));
  assert.ok(button.includes(`>${EVIL_ESCAPED}</a>`));
  const personal = mailPersonalLink(LINK);
  assert.ok(personal.includes(`href="${LINK}"`));
  assert.ok(personal.includes(">Voir mes réservations et mes tickets</a>"));
  assert.ok(personal.includes("Ce lien est personnel : ne le transférez pas."));
});

test("parts: oneLine collapses line breaks and runs of spaces", () => {
  assert.equal(oneLine("Cours\r\nBcc: a@b.c"), "Cours Bcc: a@b.c");
  assert.equal(oneLine("  Cours   du \n\n soir  "), "Cours du soir");
  assert.equal(oneLine("simple"), "simple");
});

test("every template escapes every string argument and never emits it raw", () => {
  for (const { name, evil } of TEMPLATES) {
    assert.ok(!evil.html.includes("<script>"), `${name}: raw <script> in html`);
    assert.ok(evil.html.includes("&lt;script&gt;"), `${name}: escaped text missing`);
    assert.ok(evil.html.includes(EVIL_ESCAPED), `${name}: full escaped sequence missing`);
  }
});

test("every subject is one line and carries the title", () => {
  for (const { name, normal, evil, title } of TEMPLATES) {
    assert.equal(/[\r\n]/.test(normal.subject), false, name);
    assert.equal(/[\r\n]/.test(evil.subject), false, name);
    assert.ok(normal.subject.includes(title), `${name}: ${normal.subject}`);
  }
  const injected = bookingConfirmedEmail({ ...confirmed, title: "Cours\r\nBcc: pirate@example.com" });
  assert.equal(injected.subject, "Inscription confirmée : Cours Bcc: pirate@example.com");
  assert.equal(/[\r\n]/.test(injected.subject), false);
});

test("no subject and no html contains an em or en dash", () => {
  for (const { name, normal, evil } of TEMPLATES) {
    for (const mail of [normal, evil]) {
      assert.equal(DASH.test(mail.subject), false, `${name} subject`);
      assert.equal(DASH.test(mail.html), false, `${name} html`);
    }
  }
});

test("the personal link is an href in every template, and the footer is the tickets one", () => {
  for (const { name, normal } of TEMPLATES) {
    assert.ok(normal.html.includes(`href="${LINK}"`), `${name}: personal link`);
    assert.ok(normal.html.includes("Voir mes réservations et mes tickets"), name);
    assert.ok(normal.html.includes("Ce lien est personnel : ne le transférez pas."), name);
    assert.ok(normal.html.includes(FOOTER), `${name}: footer`);
    assert.equal(normal.html.includes("packs prépayés"), false, name);
  }
});

test("booking-confirmed: details, tickets left, cancel sentence and the three calendar buttons", () => {
  const mail = TEMPLATES[0].normal;
  assert.equal(mail.subject, "Inscription confirmée : Altinha débutants");
  assert.ok(mail.html.includes(">Inscription confirmée</h1>"));
  assert.ok(mail.html.includes("Bonjour Beatriz Almeida, votre inscription chez Altinha Paris est confirmée."));
  assert.ok(mail.html.includes(">Séance</td><td style=\"text-align:right\">Altinha débutants</td>"));
  assert.ok(mail.html.includes(">Date</td><td style=\"text-align:right\">lun. 12 octobre 2026 · 19:00 à 20:00</td>"));
  assert.ok(mail.html.includes(">Lieu</td><td style=\"text-align:right\">Parc de la Villette</td>"));
  assert.ok(mail.html.includes(">Couverture</td><td style=\"text-align:right\">Ticket (Cours collectif)</td>"));
  assert.ok(mail.html.includes("Vos tickets restants :"));
  // a type with several expiry dates: its count, then one sub-line per date, « N valables » / « N sans limite »
  assert.ok(
    mail.html.includes(
      `<p>${h("3 × Cours collectif")}<br>${h("• 2 valables jusqu'au 12/01 inclus")}<br>${h("• 1 sans limite de validité")}</p>`,
    ),
  );
  // a type with one expiry class stays on one line, and its wording agrees with the count
  assert.ok(mail.html.includes(h("1 × Cours d'essai, sans limite de validité")));
  assert.ok(mail.html.includes(h("4 × Carnet, valables jusqu'au 15/04/2027 inclus")));
  assert.equal(mail.html.split(" × ").length - 1, 3, "one line per ticket type left");
  assert.ok(mail.html.includes(h("Vous pouvez annuler en ligne jusqu'à 24 h avant le début.")));
  assert.ok(mail.html.includes(`href="${confirmed.calendar.googleUrl.replace("&", "&amp;")}"`));
  assert.ok(mail.html.includes(">Ajouter à Google Agenda</a>"));
  assert.ok(mail.html.includes(`href="${confirmed.calendar.outlookUrl}"`));
  assert.ok(mail.html.includes(">Ajouter à Outlook</a>"));
  assert.ok(mail.html.includes(`href="${confirmed.calendar.icsUrl}"`));
  assert.ok(mail.html.includes(">Télécharger pour mon agenda (.ics)</a>"));
});

test("booking-confirmed: optional parts disappear when empty", () => {
  const bare = bookingConfirmedEmail({
    ...confirmed,
    location: null,
    ticketTypeName: null,
    coverageLabel: "Inscription libre",
    ticketsLeft: [],
    cancelText: "  ",
  });
  assert.equal(bare.html.includes(">Lieu<"), false);
  assert.ok(bare.html.includes(">Couverture</td><td style=\"text-align:right\">Inscription libre</td>"));
  assert.equal(bare.html.includes("Vos tickets restants"), false);
  assert.equal(bare.html.includes(" × "), false);
  assert.equal(bare.html.includes("annuler en ligne"), false);
  assert.ok(bare.html.includes(">Ajouter à Google Agenda</a>"));
});

test("booking-cancelled: the pro and client sentences, reason and ticket line", () => {
  const byPro = TEMPLATES[1].normal;
  assert.equal(byPro.subject, "Inscription annulée : Altinha débutants");
  assert.ok(byPro.html.includes(">Inscription annulée</h1>"));
  assert.ok(
    byPro.html.includes(
      "Bonjour Beatriz Almeida, Altinha Paris a annulé votre inscription à « Altinha débutants » (lun. 12 octobre 2026 · 19:00 à 20:00).",
    ),
  );
  assert.ok(byPro.html.includes("Motif : Terrain fermé"));
  assert.ok(byPro.html.includes("Votre ticket a été rendu à votre portefeuille."));

  const byClient = bookingCancelledEmail({ ...cancelled, by: "client", ticketReturned: false, reason: null });
  assert.ok(
    byClient.html.includes(
      "Bonjour Beatriz Almeida, votre annulation pour « Altinha débutants » (lun. 12 octobre 2026 · 19:00 à 20:00) est bien enregistrée.",
    ),
  );
  assert.equal(byClient.html.includes("a annulé votre inscription"), false);
  assert.equal(byClient.html.includes("Motif"), false);
  assert.equal(byClient.html.includes("Votre ticket a été rendu"), false);
});

test("occurrence-changed: details, and the cancel sentence only when the client can still cancel", () => {
  const mail = TEMPLATES[2].normal;
  assert.equal(mail.subject, "Séance modifiée : Altinha débutants");
  assert.ok(mail.html.includes(">Séance modifiée</h1>"));
  assert.ok(
    mail.html.includes(
      "Bonjour Beatriz Almeida, Altinha Paris a modifié une séance où vous êtes inscrit(e). Voici les informations à jour :",
    ),
  );
  assert.ok(mail.html.includes(">Date</td><td style=\"text-align:right\">mar. 13 octobre 2026 · 19:30 à 20:30</td>"));
  assert.ok(mail.html.includes(">Lieu</td><td style=\"text-align:right\">Gymnase Japy</td>"));
  assert.ok(
    mail.html.includes(h("Si ce changement ne vous convient pas, vous pouvez annuler en ligne jusqu'au début de la séance.")),
  );

  const locked = occurrenceChangedEmail({ ...changed, canCancelUntilStart: false, location: null });
  assert.equal(locked.html.includes("annuler en ligne"), false);
  assert.equal(locked.html.includes(">Lieu<"), false);
});

test("occurrence-cancelled: the ticket line toggles", () => {
  const mail = TEMPLATES[3].normal;
  assert.equal(mail.subject, "Séance annulée : Altinha débutants");
  assert.ok(mail.html.includes(">Séance annulée</h1>"));
  assert.ok(
    mail.html.includes(
      "Bonjour Beatriz Almeida, Altinha Paris a annulé la séance « Altinha débutants » du lun. 12 octobre 2026 · 19:00 à 20:00. Votre inscription est annulée.",
    ),
  );
  assert.ok(mail.html.includes("Votre ticket a été rendu à votre portefeuille."));
  const free = occurrenceCancelledEmail({ ...seanceCancelled, ticketReturned: false });
  assert.equal(free.html.includes("Votre ticket a été rendu"), false);
});

test("occurrence-cancelled: a rendez-vous is announced as a rendez-vous, never as a séance", () => {
  const rdv = occurrenceCancelledEmail({ ...seanceCancelled, kind: "rdv", title: "Appel découverte" });
  assert.equal(rdv.subject, "Rendez-vous annulé : Appel découverte");
  assert.ok(rdv.html.includes(">Rendez-vous annulé</h1>"));
  assert.ok(
    rdv.html.includes(
      "Bonjour Beatriz Almeida, Altinha Paris a annulé votre rendez-vous « Appel découverte » du lun. 12 octobre 2026 · 19:00 à 20:00.",
    ),
  );
  assert.ok(rdv.html.includes("Votre ticket a été rendu à votre portefeuille."));
  assert.equal(rdv.html.includes("Séance annulée"), false);
  assert.equal(rdv.html.includes("séance"), false);
  assert.equal(rdv.html.includes("Votre inscription est annulée"), false);
  const free = occurrenceCancelledEmail({ ...seanceCancelled, kind: "rdv", ticketReturned: false });
  assert.equal(free.html.includes("Votre ticket a été rendu"), false);
  assert.equal(DASH.test(rdv.subject + rdv.html), false);
});

test("occurrence-changed: the sentence agrees for a woman or a man (inscrit(e))", () => {
  const mail = occurrenceChangedEmail(changed);
  assert.ok(mail.html.includes("a modifié une séance où vous êtes inscrit(e). Voici les informations à jour :"));
});

test("attendee-moved: before, now and place", () => {
  const mail = TEMPLATES[4].normal;
  assert.equal(mail.subject, "Inscription déplacée : Altinha intermédiaires");
  assert.ok(mail.html.includes(">Inscription déplacée</h1>"));
  assert.ok(mail.html.includes("Bonjour Beatriz Almeida, Altinha Paris a déplacé votre inscription."));
  assert.ok(
    mail.html.includes(">Avant</td><td style=\"text-align:right\">Altinha débutants, lun. 12 octobre 2026 · 19:00 à 20:00</td>"),
  );
  assert.ok(
    mail.html.includes(
      ">Maintenant</td><td style=\"text-align:right\">Altinha intermédiaires, mer. 14 octobre 2026 · 20:00 à 21:00</td>",
    ),
  );
  assert.ok(mail.html.includes(">Lieu</td><td style=\"text-align:right\">Gymnase Japy</td>"));
  assert.ok(mail.html.includes(h("Si ce changement ne vous convient pas, vous pouvez annuler en ligne jusqu'au début de la séance.")));
  assert.equal(attendeeMovedEmail({ ...moved, toLocation: null }).html.includes(">Lieu<"), false);
});

test("tickets-offered: singular and plural subject, wallet sentence", () => {
  const many = TEMPLATES[5].normal;
  assert.equal(many.subject, "Altinha Paris vous offre 3 tickets");
  assert.ok(many.html.includes(">Tickets offerts</h1>"));
  assert.ok(
    many.html.includes(
      h("Bonjour Beatriz Almeida, Altinha Paris vous offre 3 tickets « Cours collectif », valables jusqu'au 12/01 inclus. Ils sont déjà dans votre portefeuille."),
    ),
  );
  const one = ticketsOfferedEmail({ ...offered, count: 1, expiryText: "sans limite de validité" });
  assert.equal(one.subject, "Altinha Paris vous offre 1 ticket");
  assert.ok(one.html.includes("vous offre 1 ticket « Cours collectif », sans limite de validité."));
  assert.ok(one.html.includes("Il est déjà dans votre portefeuille."));
  assert.equal(one.html.includes("Ils sont"), false);
});
