/**
 * The new-client form of « Inscrire » (register-attendee-dialog). Pure and client-safe: the check uses the
 * schema the core applies to a typed client (`customerInputSchema`), so a refusal never comes as a surprise
 * after the button was pressed.
 */
import { customerInputSchema } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";

export type NewClientValue = { name: string; email: string; phone: string };

export const NAME_REQUIRED = "Indiquez le nom du client.";
export const EMAIL_REQUIRED = "Indiquez l'adresse email du client.";

/**
 * The messages of each wrong field of the typed client (keys `name`, `email`, `phone`, the paths of
 * `customerInputSchema`), or null when the form is fine. An empty (or blank) name or e-mail reads as a
 * missing field, not as an invalid one; an empty phone is no phone.
 */
export function newClientProblems(value: NewClientValue): Record<string, string> | null {
  const phone = value.phone.trim();
  const parsed = parseFr(customerInputSchema, {
    name: value.name,
    email: value.email.trim(),
    phone: phone === "" ? undefined : phone,
  });
  if (parsed.ok) return null;
  const errors = { ...parsed.fieldErrors };
  if (value.name.trim() === "") errors.name = NAME_REQUIRED;
  if (value.email.trim() === "") errors.email = EMAIL_REQUIRED;
  return errors;
}
