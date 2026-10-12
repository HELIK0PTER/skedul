import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bookingConfirmationEmail,
  packReceiptEmail,
  proNewBookingEmail,
} from "./booking-emails";

const EVIL = `<img src=x onerror="alert(1)">`;

test("bookingConfirmationEmail escapes names, titles and calendar links", () => {
  const html = bookingConfirmationEmail({
    customerName: EVIL,
    businessName: "Altinha & Co",
    eventTitle: "Cours <débutants>",
    whenLabel: "lun. 19 oct.",
    paidLabel: "25,00 €",
    calendarLinks: { google: `https://g.example/?a=1&b="x"`, outlook: "https://o.example", ics: "https://i.example" },
  });
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(html.includes("Altinha &amp; Co"));
  assert.ok(html.includes("Cours &lt;débutants&gt;"));
  assert.ok(html.includes(`href="https://g.example/?a=1&amp;b=&quot;x&quot;"`));
});

test("proNewBookingEmail escapes the customer's name and e-mail", () => {
  const html = proNewBookingEmail({
    businessName: "Studio",
    eventTitle: "Cours",
    whenLabel: "lun.",
    customerName: EVIL,
    customerEmail: `a"b@example.com`,
    fillLabel: "3/6 inscrits",
    paidLabel: "Crédit de pack",
  });
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("a&quot;b@example.com"));
});

test("packReceiptEmail escapes the pack name and keeps the amount", () => {
  const html = packReceiptEmail({
    customerName: "Léa",
    businessName: "Studio",
    packName: EVIL,
    credits: 4,
    amountCents: 8500,
  });
  assert.ok(!html.includes("<img"));
  assert.match(html, /85,00\s€/);
});
