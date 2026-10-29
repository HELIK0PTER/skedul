/**
 * Shape helpers for the tests that pin what a public read hands to a page (G4a): the exact set of keys of a result, so
 * that a column added to a select or to a mapper shows up as a deliberate change, and the names no public result may
 * carry whatever the select. Pure: no test runner, no env, no database. This file is a helper, not a test.
 */

/**
 * Every key path of `value`, sorted and without duplicates: an object key is `a`, `a.b`; every element of an array is
 * walked as `a[]`, so a list of 40 rows gives the keys of its rows once. A `Date`, a primitive and `null` are leaves.
 */
export function keyPaths(value: unknown): string[] {
  const paths = new Set<string>();
  const walk = (node: unknown, prefix: string): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, `${prefix}[]`);
      return;
    }
    if (typeof node !== "object" || node === null || node instanceof Date) return;
    for (const [key, child] of Object.entries(node)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      paths.add(path);
      walk(child, path);
    }
  };
  walk(value, "");
  return [...paths].sort();
}

/**
 * The names of the private columns of the professional, the customer and the payment rows: a public read never carries
 * one under any key, at any depth (the professional's user, its Stripe account, its Google calendar, a customer's
 * identity, a Checkout session or payment intent, the row timestamps and the author of a row).
 */
export const PRIVATE_KEY_RE =
  /(^|\.)(userId|ownerUserId|professionalId|customerId|guestCustomerId|stripe\w*|google\w*|checkout\w*|paymentIntent\w*|email|phone|createdAt|updatedAt|createdBy|themePreset|customColor)(\[\]|\.|$)/i;

/** The key paths of `value` that name a private column (see PRIVATE_KEY_RE): an empty list is a pass. */
export function privateKeyPaths(value: unknown): string[] {
  return keyPaths(value).filter((path) => PRIVATE_KEY_RE.test(path));
}
