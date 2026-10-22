import assert from "node:assert/strict";
import test from "node:test";

import { escapeHtml } from "@/lib/email-layout";
import { COPY, walletLine } from "@/lib/public/messages";
import { formatMoney } from "@/lib/utils";

import { latePaymentEmail, type LatePaymentArgs } from "./late-payment";
import { proBookingCancelledEmail, type ProBookingCancelledArgs } from "./pro-booking-cancelled";
import { proNewBookingEmail, type ProNewBookingArgs } from "./pro-new-booking";
import { purchaseReceiptEmail, type PurchaseReceiptArgs } from "./purchase-receipt";

const EVIL = `<script>&"'`;
const EVIL_ESCAPED = "&lt;script&gt;&amp;&quot;&#39;";
const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
const LINK = "https://myskedul.com/api/c/cus_1.3.signature";
const PERSONAL = "Voir mes réservations et mes tickets";
const FOOTER = "Envoyé par Skedul · Réservations et tickets";
const PLANNING = "https://myskedul.com/dashboard/planning?semaine=2026-10-26&seance=occ_1";
const h = escapeHtml;
const AMOUNT = formatMoney(8500, "eur");
/** One row of a mailDetails table, escaped like the template does. */
const row = (label: string, value: string) => `>${h(label)}</td><td style="text-align:right">${h(value)}</td>`;

type Mail = { subject: string; html: string };

const receipt: PurchaseReceiptArgs = {
  customerName: "Beatriz Almeida",
  businessName: "Altinha Paris",
  label: "Carnet de 4",
  typeName: "Cours collectif",
  quantity: 4,
  walletCount: 3,
  amountLabel: AMOUNT,
  paidOn: "21/10/2026",
  expiryText: "valables jusqu'au 21/01/2027 inclus",
  bookingLine: "Un des tickets a servi pour votre inscription à « Altinha débutants » (lun. 26 octobre 2026 · 19:00 à 20:00).",
  test: false,
  personalLinkUrl: LINK,
};

const late: LatePaymentArgs = {
  customerName: "Beatriz Almeida",
  businessName: "Altinha Paris",
  title: "Altinha débutants",
  whenLabel: "lun. 26 octobre 2026 · 19:00 à 20:00",
  count: 4,
  pageUrl: "https://myskedul.com/altinha-paris",
  personalLinkUrl: LINK,
};

const newBooking: ProNewBookingArgs = {
  customerName: "Thomas Leroy",
  customerEmail: "thomas@example.com",
  title: "Altinha débutants",
  whenLabel: "lun. 26 octobre 2026 · 19:00 à 20:00",
  coverageLabel: "Inscription libre",
  planningUrl: PLANNING,
};

const cancelled: ProBookingCancelledArgs = {
  customerName: "Thomas Leroy",
  customerEmail: "thomas@example.com",
  title: "Altinha débutants",
  whenLabel: "lun. 26 octobre 2026 · 19:00 à 20:00",
  ticketReturned: true,
  planningUrl: PLANNING,
};

/** Every template with a normal argument set and a hostile one (every string = EVIL). */
const TEMPLATES: { name: string; client: boolean; normal: Mail; evil: Mail }[] = [
  {
    name: "purchase-receipt",
    client: true,
    normal: purchaseReceiptEmail(receipt),
    evil: purchaseReceiptEmail({
      customerName: EVIL,
      businessName: EVIL,
      label: EVIL,
      typeName: EVIL,
      quantity: 2,
      walletCount: 1,
      amountLabel: EVIL,
      paidOn: EVIL,
      expiryText: EVIL,
      bookingLine: EVIL,
      test: true,
      personalLinkUrl: EVIL,
    }),
  },
  {
    name: "late-payment",
    client: true,
    normal: latePaymentEmail(late),
    evil: latePaymentEmail({
      customerName: EVIL,
      businessName: EVIL,
      title: EVIL,
      whenLabel: EVIL,
      count: 2,
      pageUrl: EVIL,
      personalLinkUrl: EVIL,
    }),
  },
  {
    name: "pro-new-booking",
    client: false,
    normal: proNewBookingEmail(newBooking),
    evil: proNewBookingEmail({ customerName: EVIL, customerEmail: EVIL, title: EVIL, whenLabel: EVIL, coverageLabel: EVIL, planningUrl: EVIL }),
  },
  {
    name: "pro-booking-cancelled",
    client: false,
    normal: proBookingCancelledEmail(cancelled),
    evil: proBookingCancelledEmail({ customerName: EVIL, customerEmail: EVIL, title: EVIL, whenLabel: EVIL, ticketReturned: true, planningUrl: EVIL }),
  },
];

test("the amount is formatMoney of the cents: 85 €", () => {
  assert.equal(AMOUNT.replace(/\s/g, " "), "85 €");
});

test("purchase-receipt: subject, heading, sentence, the four detail rows, the booking line, the wallet line and the personal link", () => {
  const mail = purchaseReceiptEmail(receipt);
  assert.equal(mail.subject, "Reçu : Carnet de 4 chez Altinha Paris");
  assert.ok(mail.html.includes(">Reçu de votre achat</h1>"));
  assert.ok(mail.html.includes("Bonjour Beatriz Almeida, merci pour votre achat chez Altinha Paris."));
  assert.ok(mail.html.includes(row("Achat", "Carnet de 4 (4 tickets « Cours collectif »)")));
  assert.ok(mail.html.includes(row("Montant", AMOUNT)));
  assert.ok(mail.html.includes(row("Payé le", "21/10/2026")));
  assert.ok(mail.html.includes(row("Validité", "valables jusqu'au 21/01/2027 inclus")));
  assert.ok(mail.html.includes(h(receipt.bookingLine as string)));
  assert.ok(mail.html.includes(h("3 tickets sont dans votre portefeuille.")));
  assert.equal(mail.html.includes("Paiement de test"), false, "a live payment carries no test line");
  assert.ok(mail.html.includes(`href="${LINK}"`));
  assert.ok(mail.html.includes(PERSONAL));
  assert.ok(mail.html.includes(FOOTER));
});

test("purchase-receipt: 1 ticket takes the singular, the wallet line follows walletLine(walletCount) and is absent for 0 (COV-M1g)", () => {
  const single = purchaseReceiptEmail({ ...receipt, label: "À l'unité", quantity: 1, walletCount: 0, bookingLine: null, expiryText: "sans limite de validité" });
  assert.equal(single.subject, "Reçu : À l'unité chez Altinha Paris");
  assert.ok(single.html.includes(row("Achat", "À l'unité (1 ticket « Cours collectif »)")));
  assert.ok(single.html.includes(row("Validité", "sans limite de validité")));
  assert.equal(single.html.includes("portefeuille"), false, "the only ticket was spent on the booking");

  assert.equal(walletLine(0), null);
  for (const n of [1, 3]) {
    const line = walletLine(n) as string;
    assert.ok(purchaseReceiptEmail({ ...receipt, walletCount: n }).html.includes(h(line)), line);
  }
  assert.ok(purchaseReceiptEmail({ ...receipt, walletCount: 1 }).html.includes(h("1 ticket est dans votre portefeuille.")));
});

test("purchase-receipt: the test line is COPY.TEST_PAYMENT_LINE (parity), only for a test payment; the booking line only when given", () => {
  assert.equal(COPY.TEST_PAYMENT_LINE, "Paiement de test : aucun montant n'a été débité.");
  assert.ok(purchaseReceiptEmail({ ...receipt, test: true }).html.includes(h(COPY.TEST_PAYMENT_LINE)));
  assert.equal(purchaseReceiptEmail({ ...receipt, test: false }).html.includes("Paiement de test"), false);
  assert.equal(purchaseReceiptEmail({ ...receipt, bookingLine: null }).html.includes("Un des tickets a servi"), false);
  assert.ok(purchaseReceiptEmail(receipt).html.includes("Un des tickets a servi pour votre inscription"));
});

test("late-payment: the spec sentence verbatim for 4 tickets and for 1, the séance that is not reserved, the page button and the personal link", () => {
  const four = latePaymentEmail(late);
  assert.equal(four.subject, "Paiement reçu : votre place n'était plus réservée");
  assert.ok(four.html.includes(">Paiement reçu</h1>"));
  assert.ok(four.html.includes("Bonjour Beatriz Almeida,"));
  assert.ok(four.html.includes(h("Paiement reçu, votre place n'était plus réservée : vos 4 tickets sont dans votre portefeuille.")));
  assert.ok(
    four.html.includes(
      h("La séance « Altinha débutants » (lun. 26 octobre 2026 · 19:00 à 20:00) n'est pas réservée pour vous. Vous pouvez utiliser vos tickets sur une autre séance."),
    ),
  );
  assert.ok(four.html.includes(`href="https://myskedul.com/altinha-paris"`));
  assert.ok(four.html.includes(">Voir la page de Altinha Paris</a>"));
  assert.ok(four.html.includes(`href="${LINK}"`));

  const one = latePaymentEmail({ ...late, count: 1 });
  assert.ok(one.html.includes(h("Paiement reçu, votre place n'était plus réservée : votre ticket est dans votre portefeuille.")));
  assert.equal(one.html.includes("vos 1 tickets"), false);
  // the second sentence agrees with the count too: « votre ticket » for one, « vos tickets » for several
  assert.ok(one.html.includes(h("La séance « Altinha débutants » (lun. 26 octobre 2026 · 19:00 à 20:00) n'est pas réservée pour vous. Vous pouvez utiliser votre ticket sur une autre séance.")));
  assert.equal(one.html.includes("vos tickets sur une autre séance"), false);
  assert.equal(four.html.includes("votre ticket sur une autre séance"), false);
});

test("pro-new-booking: the client's name and address in the body, the coverage row, the planning button, no personal link", () => {
  const mail = proNewBookingEmail(newBooking);
  assert.equal(mail.subject, "Nouvelle inscription : Altinha débutants");
  assert.ok(mail.html.includes(">Nouvelle inscription</h1>"));
  assert.ok(mail.html.includes(h("Thomas Leroy (thomas@example.com) s'est inscrit(e) à « Altinha débutants » (lun. 26 octobre 2026 · 19:00 à 20:00).")));
  assert.ok(mail.html.includes(row("Couverture", "Inscription libre")));
  assert.ok(mail.html.includes(`href="${h(PLANNING)}"`), "the planning URL, with its & escaped");
  assert.ok(mail.html.includes(">Voir dans le planning</a>"));
  assert.ok(mail.html.includes(FOOTER));
});

test("pro-booking-cancelled: the client's name and address in the body, the ticket line only when a ticket came back, the planning button", () => {
  const mail = proBookingCancelledEmail(cancelled);
  assert.equal(mail.subject, "Annulation : Altinha débutants");
  assert.ok(mail.html.includes(">Annulation d&#39;un client</h1>"));
  assert.ok(mail.html.includes(h("Thomas Leroy (thomas@example.com) a annulé son inscription à « Altinha débutants » (lun. 26 octobre 2026 · 19:00 à 20:00).")));
  assert.ok(mail.html.includes("Son ticket lui a été rendu."));
  assert.ok(mail.html.includes(`href="${h(PLANNING)}"`));
  assert.ok(mail.html.includes(">Voir dans le planning</a>"));
  assert.equal(proBookingCancelledEmail({ ...cancelled, ticketReturned: false }).html.includes("Son ticket lui a été rendu."), false);
});

test("every template escapes every string argument and never emits it raw", () => {
  for (const { name, evil } of TEMPLATES) {
    assert.ok(!evil.html.includes("<script>"), `${name}: raw <script> in html`);
    assert.ok(evil.html.includes(EVIL_ESCAPED), `${name}: escaped sequence missing`);
  }
});

test("every subject is one line: a line break typed into a title or a name cannot inject a header", () => {
  const injected = [
    purchaseReceiptEmail({ ...receipt, label: "Carnet\r\nBcc: pirate@example.com", businessName: "Altinha\nParis" }),
    latePaymentEmail({ ...late, businessName: "Altinha\r\nParis" }),
    proNewBookingEmail({ ...newBooking, title: "Cours\r\nBcc: pirate@example.com" }),
    proBookingCancelledEmail({ ...cancelled, title: "Cours\nBcc: pirate@example.com" }),
  ];
  for (const mail of injected) assert.equal(/[\r\n]/.test(mail.subject), false, mail.subject);
  assert.equal(injected[0].subject, "Reçu : Carnet Bcc: pirate@example.com chez Altinha Paris");
  assert.equal(injected[2].subject, "Nouvelle inscription : Cours Bcc: pirate@example.com");
  for (const { name, normal, evil } of TEMPLATES) {
    assert.equal(/[\r\n]/.test(normal.subject), false, name);
    assert.equal(/[\r\n]/.test(evil.subject), false, name);
  }
});

test("S29: no subject contains the customer's name or address (the production mock log prints the subject)", () => {
  const receiptMail = purchaseReceiptEmail(receipt);
  const lateMail = latePaymentEmail(late);
  for (const mail of [receiptMail, lateMail]) {
    assert.equal(mail.subject.includes("Beatriz"), false, mail.subject);
    assert.equal(mail.subject.includes("Almeida"), false, mail.subject);
    assert.equal(mail.subject.includes("@"), false, mail.subject);
  }
  for (const mail of [proNewBookingEmail(newBooking), proBookingCancelledEmail(cancelled)]) {
    assert.equal(mail.subject.includes("Thomas"), false, mail.subject);
    assert.equal(mail.subject.includes("Leroy"), false, mail.subject);
    assert.equal(mail.subject.includes("thomas@example.com"), false, mail.subject);
  }
});

test("no subject and no html contains an em or en dash", () => {
  for (const { name, normal, evil } of TEMPLATES) {
    for (const mail of [normal, evil]) {
      assert.equal(DASH.test(mail.subject), false, `${name} subject`);
      assert.equal(DASH.test(mail.html), false, `${name} html`);
    }
  }
  for (const mail of [
    purchaseReceiptEmail({ ...receipt, test: true, bookingLine: null, walletCount: 0 }),
    latePaymentEmail({ ...late, count: 1 }),
    proBookingCancelledEmail({ ...cancelled, ticketReturned: false }),
  ]) {
    assert.equal(DASH.test(mail.subject), false);
    assert.equal(DASH.test(mail.html), false);
  }
});

test("client mails carry the personal link, pro mails do not; every mail has the tickets footer", () => {
  for (const { name, client, normal } of TEMPLATES) {
    assert.ok(normal.html.includes(FOOTER), `${name}: footer`);
    if (client) {
      assert.ok(normal.html.includes(`href="${LINK}"`), `${name}: personal link`);
      assert.ok(normal.html.includes(PERSONAL), name);
      assert.ok(normal.html.includes("Ce lien est personnel : ne le transférez pas."), name);
    } else {
      assert.equal(normal.html.includes("/api/c/"), false, `${name}: no personal link in a pro notice`);
      assert.equal(normal.html.includes(PERSONAL), false, name);
    }
  }
});
