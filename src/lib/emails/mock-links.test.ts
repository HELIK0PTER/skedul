import assert from "node:assert/strict";
import test from "node:test";

import { mockLinks } from "./mock-links";

test("mockLinks: finds the personal link and the calendar file link of a mail", () => {
  const html =
    '<p>Bonjour</p><a href="https://app.test/api/c/cus_1.2.mac_x" style="display:inline-block">Voir mes réservations et mes tickets</a>' +
    '<a href="https://app.test/api/bookings/b1/calendar.ics" style="color:#000">Télécharger</a>';
  assert.deepEqual(mockLinks(html), ["https://app.test/api/c/cus_1.2.mac_x", "https://app.test/api/bookings/b1/calendar.ics"]);
});

test("mockLinks: decodes the entities an escaped href carries", () => {
  const html = '<a href="https://calendar.google.com/calendar/render?action=TEMPLATE&amp;text=Cours&amp;dates=1/2">Google</a>';
  assert.deepEqual(mockLinks(html), ["https://calendar.google.com/calendar/render?action=TEMPLATE&text=Cours&dates=1/2"]);
});

test("mockLinks: ignores mailto, relative and anchor links, and repeats", () => {
  const html =
    '<a href="mailto:a@b.test">mail</a><a href="/relative">rel</a><a href="#top">top</a>' +
    '<a href="https://app.test/x">x</a><a href="https://app.test/x">again</a>';
  assert.deepEqual(mockLinks(html), ["https://app.test/x"]);
});

test("mockLinks: keeps at most max links", () => {
  const html = [1, 2, 3, 4, 5, 6, 7].map((n) => `<a href="https://app.test/${n}">${n}</a>`).join("");
  assert.equal(mockLinks(html).length, 5);
  assert.equal(mockLinks(html, 2).length, 2);
  assert.deepEqual(mockLinks("<p>no link</p>"), []);
});
