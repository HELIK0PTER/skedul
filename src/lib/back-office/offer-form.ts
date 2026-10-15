/**
 * The offer dialog's form model (spec § 13.1 « Offres »): strings as typed,
 * converted to an OfferInput before the Server Action. Whole-number and price
 * syntax are checked here (no round trip for a typo); the numeric bounds and
 * every other rule stay with the server, whose French messages the dialog
 * shows under the field they belong to.
 */
import type { OfferInput } from "@/lib/tickets";
import { BOUNDS, type ValidityUnit } from "@/lib/tickets-vocab";

import { moneyInputValue, parseMoneyInput } from "./format";

export type ValidityChoice = "none" | "day" | "month";
export type OfferField = "quantity" | "price" | "label" | "validity";

export type OfferFormValues = {
  quantity: string;
  price: string;
  label: string;
  validity: ValidityChoice;
  validityCount: string;
  isActive: boolean;
};

/** « Nouvelle offre »: one ticket, no price yet, no validity, en vente. */
export const EMPTY_OFFER_FORM: OfferFormValues = {
  quantity: "1",
  price: "",
  label: "",
  validity: "none",
  validityCount: "1",
  isActive: true,
};

export function offerFormFromView(o: {
  quantity: number;
  priceCents: number;
  customLabel: string | null;
  validityCount: number | null;
  validityUnit: ValidityUnit | null;
  isActive: boolean;
}): OfferFormValues {
  return {
    quantity: String(o.quantity),
    price: moneyInputValue(o.priceCents),
    label: o.customLabel ?? "",
    validity: o.validityUnit ?? "none",
    validityCount: o.validityCount === null ? "1" : String(o.validityCount),
    isActive: o.isActive,
  };
}

export type OfferFormResult = { ok: true; input: OfferInput } | { ok: false; field: OfferField; error: string };

const WHOLE = /^\d+$/;

export function offerInputFromForm(ticketTypeId: string, f: OfferFormValues): OfferFormResult {
  const quantity = f.quantity.trim();
  if (!WHOLE.test(quantity)) return { ok: false, field: "quantity", error: "Quantité : indiquez un nombre entier." };

  const priceCents = parseMoneyInput(f.price);
  if (priceCents === null) return { ok: false, field: "price", error: "Prix invalide." };
  if (priceCents > BOUNDS.offerPriceCents.max) {
    const max = (BOUNDS.offerPriceCents.max / 100).toLocaleString("fr-FR");
    return { ok: false, field: "price", error: `Prix invalide : ${max} au maximum.` };
  }

  let validityCount: number | null = null;
  let validityUnit: ValidityUnit | null = null;
  if (f.validity !== "none") {
    const count = f.validityCount.trim();
    if (!WHOLE.test(count)) return { ok: false, field: "validity", error: "Validité : indiquez un nombre entier." };
    validityCount = Number(count);
    validityUnit = f.validity;
  }

  const label = f.label.trim();
  return {
    ok: true,
    input: {
      ticketTypeId,
      quantity: Number(quantity),
      priceCents,
      label: label === "" ? null : label,
      validityCount,
      validityUnit,
      isActive: f.isActive,
    },
  };
}

/** The field a French server message belongs to (by its label prefix or its subject), null for a general message. */
export function offerErrorField(error: string): OfferField | null {
  if (error.startsWith("Quantité")) return "quantity";
  if (error.startsWith("Prix")) return "price";
  if (error.startsWith("Libellé")) return "label";
  if (error.startsWith("Validité") || error.includes("validité")) return "validity";
  return null;
}
