import assert from "node:assert/strict";
import test from "node:test";

import {
  CANCEL_LABEL,
  SPEND_DONE,
  SPEND_LABEL,
  SPEND_LINK_LABEL,
  SPEND_TITLE,
  UPCOMING_HEADING_ID,
  UPCOMING_TITLE,
  bannerOfIdentity,
  canSignOutIn,
  canSpendIn,
  cancelBookingCopy,
  cancelButtonName,
  cancelDoneText,
  spendButtonName,
  spendControlOf,
  visitorStateOfIdentity,
} from "./space-view";

const DASHES = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

test("the fixed copy of the espace actions, exact, without a dash", () => {
  // The list mixes séances and rendez-vous (P5): « réservations », never « inscriptions » (D § 3.10).
  assert.equal(UPCOMING_TITLE, "Vos prochaines réservations");
  assert.equal(SPEND_TITLE, "Utiliser vos tickets");
  assert.equal(SPEND_LABEL, "Réserver avec 1 ticket");
  assert.equal(SPEND_LINK_LABEL, "Réserver");
  assert.equal(SPEND_DONE, "Réservation confirmée.");
  assert.equal(CANCEL_LABEL, "Annuler");
  assert.equal(UPCOMING_HEADING_ID, "espace-upcoming");
  for (const text of [UPCOMING_TITLE, SPEND_TITLE, SPEND_LABEL, SPEND_LINK_LABEL, SPEND_DONE, CANCEL_LABEL]) {
    assert.doesNotMatch(text, DASHES);
  }
});

test("cancelBookingCopy: a ticket comes back and the pro is told; every case promises the client a confirmation e-mail (COV-M12)", () => {
  assert.deepEqual(cancelBookingCopy("ticket", "Altinha Paris"), {
    title: "Annuler votre inscription ?",
    body: "Votre ticket vous est rendu et Altinha Paris est prévenu par email. Vous recevez un email de confirmation.",
    confirm: "Annuler l'inscription",
  });
  for (const coverage of ["free", "guest"] as const) {
    assert.deepEqual(cancelBookingCopy(coverage, "Altinha Paris"), {
      title: "Annuler votre inscription ?",
      body: "Altinha Paris est prévenu par email. Vous recevez un email de confirmation.",
      confirm: "Annuler l'inscription",
    });
  }
  // The name is the pro's: it is interpolated as text (JSX escapes it), never altered.
  assert.ok(cancelBookingCopy("free", "<b>X</b>").body.startsWith("<b>X</b> est prévenu"));
  for (const coverage of ["ticket", "free", "guest"] as const) {
    const copy = cancelBookingCopy(coverage, "Altinha Paris");
    assert.doesNotMatch(`${copy.title} ${copy.body} ${copy.confirm}`, DASHES);
  }
});

test("cancelBookingCopy and cancelDoneText: an RDV row says « rendez-vous », never « inscription » (P5 copy rule); a séance keeps its words", () => {
  for (const coverage of ["ticket", "free", "guest"] as const) {
    const seance = cancelBookingCopy(coverage, "Altinha Paris");
    assert.deepEqual(cancelBookingCopy(coverage, "Altinha Paris", "seance"), seance, "seance is the default");
    assert.deepEqual(cancelBookingCopy(coverage, "Altinha Paris", "rdv"), {
      title: "Annuler votre rendez-vous ?",
      body: seance.body,
      confirm: "Annuler le rendez-vous",
    });
  }
  assert.equal(cancelDoneText("seance"), "Inscription annulée.");
  assert.equal(cancelDoneText("rdv"), "Rendez-vous annulé.");
  const SEANCE_WORDS = /[Ss][ée]ance|[Ii]nscri|(^|[^a-zà-ÿ])place([^a-zà-ÿ]|$)/;
  for (const coverage of ["ticket", "free", "guest"] as const) {
    const copy = cancelBookingCopy(coverage, "Altinha Paris", "rdv");
    assert.doesNotMatch(`${copy.title} ${copy.body} ${copy.confirm} ${cancelDoneText("rdv")}`, SEANCE_WORDS);
    assert.doesNotMatch(`${copy.title} ${copy.body} ${copy.confirm} ${cancelDoneText("rdv")}`, DASHES);
  }
});

test("spendButtonName starts with the visible label (WCAG 2.5.3) and names the séance, so the rows of the list are told apart (G3b)", () => {
  const first = spendButtonName(SPEND_LABEL, "Altinha débutants", "lun. 26 octobre 2026 · 19:00 à 20:00");
  const second = spendButtonName(SPEND_LABEL, "Altinha débutants", "mer. 28 octobre 2026 · 19:00 à 20:00");
  assert.equal(first, "Réserver avec 1 ticket : Altinha débutants, lun. 26 octobre 2026 · 19:00 à 20:00");
  assert.notEqual(first, second, "same title, another day");
  assert.ok(spendButtonName(SPEND_LINK_LABEL, "x", "y").startsWith(SPEND_LINK_LABEL));
  assert.ok(first.startsWith(SPEND_LABEL));
  assert.doesNotMatch(first, DASHES);
});

test("cancelButtonName starts with the visible label (WCAG 2.5.3) and names the booking", () => {
  assert.equal(
    cancelButtonName("Altinha débutants", "lun. 12 octobre 2026 · 19:00 à 20:00"),
    "Annuler : Altinha débutants, lun. 12 octobre 2026 · 19:00 à 20:00",
  );
  assert.ok(cancelButtonName("x", "y").startsWith(CANCEL_LABEL));
});

test("visitorStateOfIdentity: the personal-link cookie alone is anonymous, a signed-in visitor never is", () => {
  assert.equal(visitorStateOfIdentity({ kind: "anonymous" }), "anonymous");
  assert.equal(visitorStateOfIdentity({ kind: "customer", customerId: "c1", via: "guest" }), "anonymous");
  assert.equal(visitorStateOfIdentity({ kind: "customer", customerId: "c1", via: "session" }), "verified");
  assert.equal(visitorStateOfIdentity({ kind: "no_record", email: "a@b.fr" }), "verified");
  assert.equal(visitorStateOfIdentity({ kind: "unverified", email: "a@b.fr", guestCustomerId: null }), "unverified");
  assert.equal(visitorStateOfIdentity({ kind: "unverified", email: "a@b.fr", guestCustomerId: "c1" }), "unverified");
  assert.equal(visitorStateOfIdentity({ kind: "impersonating" }), "impersonating");
});

test("canSpendIn: only the Owner (a verified session with a record here) spends; the cookie, an unverified or impersonated session never do", () => {
  assert.equal(canSpendIn({ kind: "customer", customerId: "c1", via: "session" }), true);
  assert.equal(canSpendIn({ kind: "customer", customerId: "c1", via: "guest" }), false);
  assert.equal(canSpendIn({ kind: "unverified", email: "a@b.fr", guestCustomerId: "c1" }), false);
  assert.equal(canSpendIn({ kind: "no_record", email: "a@b.fr" }), false);
  assert.equal(canSpendIn({ kind: "impersonating" }), false);
  assert.equal(canSpendIn({ kind: "anonymous" }), false);
});

test("bannerOfIdentity: every signed-in, non-impersonated visitor has the banner, `verified` from the visitor state; the cookie alone and an admin have none (G1b)", () => {
  const unverified = { kind: "unverified", email: "a@b.fr", guestCustomerId: null } as const;
  assert.deepEqual(bannerOfIdentity(unverified, null), { email: "a@b.fr", verified: false });
  assert.deepEqual(
    bannerOfIdentity({ ...unverified, guestCustomerId: "c1" }, "other@b.fr"),
    { email: "a@b.fr", verified: false },
    "the session address, not the personal link's customer's",
  );
  assert.deepEqual(bannerOfIdentity({ kind: "customer", customerId: "c1", via: "session" }, "a@b.fr"), { email: "a@b.fr", verified: true });
  assert.deepEqual(bannerOfIdentity({ kind: "no_record", email: "a@b.fr" }, null), { email: "a@b.fr", verified: true });
  assert.equal(bannerOfIdentity({ kind: "customer", customerId: "c1", via: "guest" }, "a@b.fr"), null, "the personal link is not a sign-in");
  assert.equal(bannerOfIdentity({ kind: "customer", customerId: "c1", via: "session" }, null), null, "no address to confirm");
  assert.equal(bannerOfIdentity({ kind: "impersonating" }, "a@b.fr"), null, "an admin must not verify the client's address");
  assert.equal(bannerOfIdentity({ kind: "anonymous" }, null), null);
  // the flag is the visitor state's, whatever the identity: the banner and the state cannot disagree
  for (const identity of [unverified, { kind: "no_record", email: "a@b.fr" }, { kind: "customer", customerId: "c1", via: "session" }] as const) {
    assert.equal(bannerOfIdentity(identity, "a@b.fr")?.verified, visitorStateOfIdentity(identity) === "verified");
  }
});

test("canSignOutIn: a visitor with a session, verified or not, can sign out; the cookie alone, an admin and a signed-out visitor have nothing to sign out of (G3b)", () => {
  assert.equal(canSignOutIn({ kind: "unverified", email: "a@b.fr", guestCustomerId: null }), true, "an unverified session has no other way out");
  assert.equal(canSignOutIn({ kind: "unverified", email: "a@b.fr", guestCustomerId: "c1" }), true);
  assert.equal(canSignOutIn({ kind: "customer", customerId: "c1", via: "session" }), true);
  assert.equal(canSignOutIn({ kind: "customer", customerId: "c1", via: "guest" }), false, "the personal link is not a sign-in: « Ce n'est pas moi » is its exit");
  assert.equal(canSignOutIn({ kind: "no_record", email: "a@b.fr" }), false, "« Utiliser une autre adresse » is the sign-out of that state");
  assert.equal(canSignOutIn({ kind: "impersonating" }), false, "the admin ends the impersonation elsewhere");
  assert.equal(canSignOutIn({ kind: "anonymous" }), false);
});

test("spendControlOf: the control each visitor state gets for a séance", () => {
  const cases: [Parameters<typeof spendControlOf>[0], ReturnType<typeof spendControlOf>][] = [
    [{ needsAnswers: false, canSpend: true, visitorState: "verified" }, "book"],
    [{ needsAnswers: true, canSpend: true, visitorState: "verified" }, "link"],
    [{ needsAnswers: false, canSpend: false, visitorState: "anonymous" }, "signin"],
    [{ needsAnswers: true, canSpend: false, visitorState: "anonymous" }, "link"],
    [{ needsAnswers: false, canSpend: false, visitorState: "unverified" }, "disabled"],
    [{ needsAnswers: true, canSpend: false, visitorState: "unverified" }, "link"],
    [{ needsAnswers: false, canSpend: false, visitorState: "impersonating" }, "none"],
    [{ needsAnswers: true, canSpend: false, visitorState: "impersonating" }, "none"],
    [{ needsAnswers: false, canSpend: false, visitorState: "verified" }, "none"],
  ];
  for (const [input, expected] of cases) assert.equal(spendControlOf(input), expected, JSON.stringify(input));
});

test("spendControlOf never offers the one-click booking to a visitor who is not verified, whatever canSpend says (defence in depth)", () => {
  assert.equal(spendControlOf({ needsAnswers: false, canSpend: true, visitorState: "unverified" }), "disabled");
  assert.equal(spendControlOf({ needsAnswers: false, canSpend: true, visitorState: "anonymous" }), "signin");
  assert.equal(spendControlOf({ needsAnswers: false, canSpend: true, visitorState: "impersonating" }), "none");
});
