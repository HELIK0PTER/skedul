/**
 * « Reçu de votre achat »: sent once a purchase is paid (Stripe webhook, mock checkout), as a mail of its own, apart
 * from the booking confirmation (Decision 55). `expiryText` comes from back-office/format.expiryLabel with the number
 * of tickets; `walletCount` is the tickets still in the wallet (the « À l'unité » ticket of a buy + book is already
 * spent, so nothing is said to be in the wallet, COV-M1g). Pure: every value goes through escapeHtml.
 */
import { plural } from "@/lib/back-office/format";
import { escapeHtml, layout } from "@/lib/email-layout";
import { COPY, walletLine } from "@/lib/public/messages";

import { mailDetails, mailParagraph, mailPersonalLink, oneLine } from "./parts";

export type PurchaseReceiptArgs = {
  customerName: string;
  businessName: string;
  label: string;
  typeName: string;
  quantity: number;
  walletCount: number;
  amountLabel: string;
  paidOn: string;
  expiryText: string;
  bookingLine: string | null;
  test: boolean;
  personalLinkUrl: string;
};

export function purchaseReceiptEmail(a: PurchaseReceiptArgs): { subject: string; html: string } {
  const rows = [
    { label: "Achat", value: `${a.label} (${plural(a.quantity, "ticket", "tickets")} « ${a.typeName} »)` },
    { label: "Montant", value: a.amountLabel },
    { label: "Payé le", value: a.paidOn },
    { label: "Validité", value: a.expiryText },
  ];
  const wallet = walletLine(a.walletCount);
  const html = layout(
    escapeHtml("Reçu de votre achat"),
    `
    ${mailParagraph(`Bonjour ${a.customerName}, merci pour votre achat chez ${a.businessName}.`)}
    ${mailDetails(rows)}
    ${a.bookingLine ? mailParagraph(a.bookingLine) : ""}
    ${a.test ? mailParagraph(COPY.TEST_PAYMENT_LINE) : ""}
    ${wallet ? mailParagraph(wallet) : ""}
    ${mailPersonalLink(a.personalLinkUrl)}
  `,
  );
  return { subject: oneLine(`Reçu : ${a.label} chez ${a.businessName}`), html };
}
