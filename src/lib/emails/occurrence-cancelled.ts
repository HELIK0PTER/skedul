/**
 * « Séance annulée »: sent to every client still registered when the pro
 * cancels a séance (or when a time off swallows it).
 */
import { escapeHtml, layout } from "@/lib/email-layout";

import { mailParagraph, mailPersonalLink, oneLine } from "./parts";

export type OccurrenceCancelledArgs = {
  customerName: string;
  businessName: string;
  title: string;
  whenLabel: string;
  ticketReturned: boolean;
  personalLinkUrl: string;
};

export function occurrenceCancelledEmail(a: OccurrenceCancelledArgs): { subject: string; html: string } {
  const returned = a.ticketReturned ? mailParagraph("Votre ticket a été rendu à votre portefeuille.") : "";
  const html = layout(
    escapeHtml("Séance annulée"),
    `
    ${mailParagraph(
      `Bonjour ${a.customerName}, ${a.businessName} a annulé la séance « ${a.title} » du ${a.whenLabel}. Votre inscription est annulée.`,
    )}
    ${returned}
    ${mailPersonalLink(a.personalLinkUrl)}
  `,
  );
  return { subject: oneLine(`Séance annulée : ${a.title}`), html };
}
