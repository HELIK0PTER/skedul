/**
 * « Paiement reçu »: sent when a payment lands after the seat was released (the hold ended, spec L1136-1137): the
 * tickets went to the wallet, the séance is not reserved. The subject is fixed: it names neither the client nor the
 * séance. Pure: every value goes through escapeHtml.
 */
import { formatCount } from "@/lib/back-office/format";
import { escapeHtml, layout } from "@/lib/email-layout";

import { mailButton, mailParagraph, mailPersonalLink, oneLine } from "./parts";

export type LatePaymentArgs = {
  customerName: string;
  businessName: string;
  title: string;
  whenLabel: string;
  count: number;
  pageUrl: string;
  personalLinkUrl: string;
};

export function latePaymentEmail(a: LatePaymentArgs): { subject: string; html: string } {
  const held =
    a.count > 1
      ? `vos ${formatCount(a.count)} tickets sont dans votre portefeuille.`
      : "votre ticket est dans votre portefeuille.";
  const html = layout(
    escapeHtml("Paiement reçu"),
    `
    ${mailParagraph(`Bonjour ${a.customerName},`)}
    ${mailParagraph(`Paiement reçu, votre place n'était plus réservée : ${held}`)}
    ${mailParagraph(
      `La séance « ${a.title} » (${a.whenLabel}) n'est pas réservée pour vous. Vous pouvez utiliser vos tickets sur une autre séance.`,
    )}
    <p style="margin:16px 0 0">${mailButton(a.pageUrl, `Voir la page de ${a.businessName}`)}</p>
    ${mailPersonalLink(a.personalLinkUrl)}
  `,
  );
  return { subject: oneLine("Paiement reçu : votre place n'était plus réservée"), html };
}
