/**
 * The typed identity of a public form, written once (G4c, Item 3): the server cores parse it, the browser's own check
 * runs the same schema, so the two never drift. Pure; run from the repository root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { codeView } from "@/test/source-guards";
import { parseFr } from "@/lib/zod-fr";

import { identityInputSchema, type IdentityInput } from "./identity-schema";
import { identityErrors } from "./occurrence-form";

const read = (path: string): string => readFileSync(path, "utf8");

test("the schema takes a name, an e-mail and an optional phone, and nothing else", () => {
  const ok = parseFr(identityInputSchema, { name: " Ana Souza ", email: " Ana@Example.com ", phone: "06 12 34 56 78" });
  assert.ok(ok.ok);
  assert.equal(ok.data.name, "Ana Souza");
  assert.equal(ok.data.email, "ana@example.com");
  assert.ok(parseFr(identityInputSchema, { name: "Ana", email: "ana@example.com" }).ok, "the phone is optional");
  assert.equal(identityInputSchema.safeParse({ name: "Ana", email: "ana@example.com", role: "admin" }).success, false, "strict: an extra key is refused");
  const bad = parseFr(identityInputSchema, { name: "visitez http://x.co", email: "pas-un-email" });
  assert.equal(bad.ok, false);
});

test("the browser's check says exactly what the schema says, field by field (one rule, two callers)", () => {
  const inputs: IdentityInput[] = [
    { name: "", email: "", phone: "" },
    { name: "Ana", email: "pas-un-email" },
    { name: "A".repeat(81), email: "a@b.co" },
    { name: "Ana", email: "a@b.co", phone: "0".repeat(31) },
    { name: "visitez http://x.co", email: "a@b.co" },
    { name: "a@b.co", email: "a@b.co" },
    { name: "Ana 06 12 34 56 78", email: "a@b.co" },
    { name: "Ana", email: "ana@example.com", phone: "06 12 34 56 78" },
    { name: " Ana ", email: " Ana@Example.com " },
  ];
  for (const identity of inputs) {
    const phone = (identity.phone ?? "").trim();
    const parsed = parseFr(identityInputSchema, { name: identity.name, email: identity.email, ...(phone === "" ? {} : { phone }) });
    const expected = parsed.ok
      ? {}
      : Object.fromEntries(Object.entries(parsed.fieldErrors).map(([key, message]) => [`identity.${key}`, message]));
    assert.deepEqual(identityErrors(identity), expected, JSON.stringify(identity));
  }
});

test("occurrence-form holds no second copy of the identity fields, and the server cores import the shared schema", () => {
  const form = codeView(read("src/lib/public/occurrence-form.ts"));
  assert.doesNotMatch(form, /\b(?:plainNameSchema|customerInputSchema)\b/, "the fields live in identity-schema.ts");
  assert.doesNotMatch(form, /\bz\s*\.\s*object\(/, "no schema of its own");
  assert.match(form, /parseFr\(identityInputSchema, /);
  const actionsSource = read("src/lib/public/booking-actions.ts");
  assert.doesNotMatch(codeView(actionsSource), /\bplainNameSchema\b/, "the cores parse the shared schema; they do not rebuild it");
  assert.match(actionsSource, /import \{ identityInputSchema, type IdentityInput \} from "@\/lib\/public\/identity-schema";/);
  assert.equal((read("src/lib/public/identity-schema.ts").match(/export const identityInputSchema\b/g) ?? []).length, 1, "defined once");
});

test("the schema module is client-safe: zod, the plain-name rule and the ticket schemas only", () => {
  const source = read("src/lib/public/identity-schema.ts");
  const specifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]).sort();
  assert.deepEqual(specifiers, ["@/lib/public/plain-name", "@/lib/tickets", "zod"]);
  assert.doesNotMatch(source, /server-only|next\/|@\/lib\/db|@\/lib\/booking|@\/lib\/env/);
});
