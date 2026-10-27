/**
 * The typed identity of a public form (spec L788-792, SEC-M9, SEC-M15, OUT:91), written once. The server cores parse it
 * strictly (booking-actions.ts, shop-actions.ts) and the browser's own check before a Server Action call
 * (occurrence-form.ts) runs the same schema, so a typo is caught with the sentence the server would give and the two
 * never drift apart (G4c). Client-safe: zod, the plain-name rule and the ticket schemas only, no database, no engine.
 */
import { z } from "zod";

import { plainNameSchema } from "@/lib/public/plain-name";
import { customerInputSchema } from "@/lib/tickets";

/** What the client sends as its identity (parsed by the strict schema below). */
export type IdentityInput = { name: string; email: string; phone?: string };

/** Strict typed identity (SEC-M15, SEC-M9, OUT:91): name plainNameSchema; email z.string().trim().pipe(customerInputSchema.shape.email); phone customerInputSchema.shape.phone; no other key. */
export const identityInputSchema = z
  .object({
    name: plainNameSchema,
    email: z.string().trim().pipe(customerInputSchema.shape.email),
    phone: customerInputSchema.shape.phone,
  })
  .strict();
