/**
 * « Paiement reçu »: sent when a payment lands after the seat or the slot was released (the hold ended, spec
 * L1136-1137): the tickets went to the wallet, the séance or the rendez-vous is not reserved. The subject is fixed: it
 * names neither the client nor the séance. A séance keeps the spec's sentence (« votre place n'était plus réservée »);
 * an RDV says « votre créneau n'était plus réservé » in the subject and the headline, as merci's paid_late does (P5 D3,
 * never « place » on an RDV), and its second sentence names a rendez-vous and « un autre créneau ». Pure: every value
 * goes through escapeHtml.
 */
import { formatCount } from "@/lib/back-office/format";
import { escapeHtml, layout } from "@/lib/email-layout";

import { mailButton, mailParagraph, mailPersonalLink, oneLine } from "./parts";

export type LatePaymentArgs = {
  /** a séance of an event, or a rendez-vous (an occurrence with no event) */
  kind: "seance" | "rdv";
  customerName: string;
  businessName: string;
  title: string;
  whenLabel: string;
  count: number;
  pageUrl: string;
  personalLinkUrl: string;
};

export function latePaymentEmail(a: LatePaymentArgs): { subject: string; html: string } {
  const several = a.count > 1;
  const held = several
    ? `vos ${formatCount(a.count)} tickets sont dans votre portefeuille.`
    : "votre ticket est dans votre portefeuille.";
  const useThem = several ? "vos tickets" : "votre ticket";
  const lapsed = a.kind === "rdv" ? "votre créneau n'était plus réservé" : "votre place n'était plus réservée";
  const notReserved =
    a.kind === "rdv"
      ? `Le rendez-vous « ${a.title} » (${a.whenLabel}) n'est pas réservé pour vous. Vous pouvez utiliser ${useThem} sur un autre créneau.`
      : `La séance « ${a.title} » (${a.whenLabel}) n'est pas réservée pour vous. Vous pouvez utiliser ${useThem} sur une autre séance.`;
  const html = layout(
    escapeHtml("Paiement reçu"),
    `
    ${mailParagraph(`Bonjour ${a.customerName},`)}
    ${mailParagraph(`Paiement reçu, ${lapsed} : ${held}`)}
    ${mailParagraph(notReserved)}
    <p style="margin:16px 0 0">${mailButton(a.pageUrl, `Voir la page de ${a.businessName}`)}</p>
    ${mailPersonalLink(a.personalLinkUrl)}
  `,
  );
  return { subject: oneLine(`Paiement reçu : ${lapsed}`), html };
}
