import assert from "node:assert/strict";
import test from "node:test";

import { healthAlerts, nightlyCheck } from "./admin-health";
import type { HealthCounts } from "./admin-reads";
import { formatDateShort } from "./datetime";

const PARIS = "Europe/Paris";
const LOS_ANGELES = "America/Los_Angeles";
const NONE: HealthCounts = {
  pendingHolds: 0,
  pendingPurchases: 0,
  horizonLag: 0,
  orphanPayments: null,
  invariantViolations: null,
};
// 2026-10-01 22:30 UTC: already Oct 2 in Paris, still Oct 1 in Los Angeles.
const NIGHT = new Date("2026-10-01T22:30:00Z");
// U+2013 (en dash) and U+2014 (em dash), built from code points so that this file holds no dash itself
const DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

test("healthAlerts: nothing to report when every counter is zero or unset", () => {
  assert.deepEqual(healthAlerts(NONE, PARIS), []);
  assert.deepEqual(healthAlerts({ ...NONE, orphanPayments: { value: 0, at: NIGHT } }, PARIS), []);
  assert.deepEqual(healthAlerts({ ...NONE, invariantViolations: { value: 5, at: NIGHT } }, PARIS), []);
});

test("healthAlerts: exact copy, plural forms and links, in a stable order", () => {
  const alerts = healthAlerts(
    {
      pendingHolds: 3,
      pendingPurchases: 2,
      horizonLag: 4,
      orphanPayments: { value: 2, at: NIGHT },
      invariantViolations: null,
    },
    PARIS,
  );
  assert.deepEqual(alerts, [
    {
      key: "holds",
      text: "3 places en attente de paiement depuis plus d'1 h, à surveiller",
      href: "/admin/activity?tab=bookings&status=pending",
    },
    {
      key: "purchases",
      text: "2 achats en attente après l'expiration du paiement, à surveiller",
      href: "/admin/activity?tab=purchases&status=pending",
    },
    {
      key: "orphans",
      text: `2 paiements orphelins enregistrés depuis la mise en service (dernier le ${formatDateShort(NIGHT, PARIS)}) : vérifiez-les dans Stripe`,
      href: null,
    },
    { key: "horizon", text: "4 séries en retard d'horizon", href: null },
  ]);
});

test("healthAlerts: a count of one takes the singular", () => {
  const alerts = healthAlerts(
    {
      pendingHolds: 1,
      pendingPurchases: 1,
      horizonLag: 1,
      orphanPayments: { value: 1, at: NIGHT },
      invariantViolations: null,
    },
    PARIS,
  );
  assert.deepEqual(
    alerts.map((a) => a.text),
    [
      "1 place en attente de paiement depuis plus d'1 h, à surveiller",
      "1 achat en attente après l'expiration du paiement, à surveiller",
      `1 paiement orphelin enregistré depuis la mise en service (dernier le ${formatDateShort(NIGHT, PARIS)}) : vérifiez-les dans Stripe`,
      "1 série en retard d'horizon",
    ],
  );
});

test("healthAlerts: pending holds and purchases are information to watch, never worded as failures", () => {
  // They wait for the nightly job, a webhook or a delayed payment: nothing is broken.
  const alerts = healthAlerts({ ...NONE, pendingHolds: 2, pendingPurchases: 2 }, PARIS);
  assert.deepEqual(
    alerts.map((a) => a.key),
    ["holds", "purchases"],
  );
  for (const a of alerts) {
    assert.ok(a.text.endsWith(", à surveiller"), a.text);
    assert.doesNotMatch(a.text, /erreur|échec|anomalie|bloqué|problème/i, a.text);
  }
});

test("healthAlerts: orphan payments are a running total since the launch, not a list of refunds to make", () => {
  // The counter never resets: once refunded, an orphan still counts, so the alert must not ask for a refund.
  const [alert] = healthAlerts({ ...NONE, orphanPayments: { value: 3, at: NIGHT } }, PARIS);
  assert.equal(alert.key, "orphans");
  assert.match(alert.text, /^3 paiements orphelins enregistrés depuis la mise en service/);
  assert.match(alert.text, /vérifiez-les dans Stripe$/);
  assert.doesNotMatch(alert.text, /à rembourser/);
});

test("healthAlerts: the date of the last orphan payment follows the time zone passed in", () => {
  const counts = { ...NONE, orphanPayments: { value: 1, at: NIGHT } };
  const paris = healthAlerts(counts, PARIS)[0].text;
  const la = healthAlerts(counts, LOS_ANGELES)[0].text;
  assert.notEqual(paris, la);
  assert.ok(paris.includes(`(dernier le ${formatDateShort(NIGHT, PARIS)})`), paris);
  assert.ok(la.includes(`(dernier le ${formatDateShort(NIGHT, LOS_ANGELES)})`), la);
});

test("nightlyCheck: never run, clean, or violations, with the date in the zone passed in", () => {
  assert.deepEqual(nightlyCheck(null, PARIS), { tone: "neutral", label: "Jamais exécuté" });
  assert.deepEqual(nightlyCheck({ value: 0, at: NIGHT }, PARIS), { tone: "success", label: "OK le 2 oct. 2026" });
  // the first of a month takes the ordinal (« 1er »), as everywhere else in the app
  assert.deepEqual(nightlyCheck({ value: 0, at: NIGHT }, LOS_ANGELES), { tone: "success", label: "OK le 1er oct. 2026" });
  assert.deepEqual(nightlyCheck({ value: 1, at: NIGHT }, PARIS), { tone: "warning", label: "1 violation le 2 oct. 2026" });
  assert.deepEqual(nightlyCheck({ value: 4, at: NIGHT }, PARIS), { tone: "warning", label: "4 violations le 2 oct. 2026" });
});

test("health copy never contains an em dash or an en dash", () => {
  const texts = [
    ...healthAlerts(
      {
        pendingHolds: 2,
        pendingPurchases: 2,
        horizonLag: 2,
        orphanPayments: { value: 2, at: NIGHT },
        invariantViolations: null,
      },
      PARIS,
    ).map((a) => a.text),
    nightlyCheck(null, PARIS).label,
    nightlyCheck({ value: 0, at: NIGHT }, PARIS).label,
    nightlyCheck({ value: 3, at: NIGHT }, PARIS).label,
  ];
  for (const text of texts) assert.equal(DASH.test(text), false, text);
});
