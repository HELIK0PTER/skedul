/**
 * « Séance annulée » / « Rendez-vous annulé »: sent to every client still
 * registered when the pro cancels a séance or a rendez-vous (or when a time off
 * swallows it). A rendez-vous is never called a séance.
 */
import { escapeHtml, layout } from "@/lib/email-layout";

import { MAIL_TICKET_RETURNED, mailParagraph, mailPersonalLink, oneLine } from "./parts";

export type OccurrenceCancelledArgs = {
  /** a séance of an event, or a rendez-vous (an occurrence with no event) */
  kind: "seance" | "rdv";
  customerName: string;
  businessName: string;
  title: string;
  whenLabel: string;
  ticketReturned: boolean;
  personalLinkUrl: string;
};

export function occurrenceCancelledEmail(a: OccurrenceCancelledArgs): { subject: string; html: string } {
  const returned = a.ticketReturned ? mailParagraph(MAIL_TICKET_RETURNED) : "";
  const heading = a.kind === "rdv" ? "Rendez-vous annulé" : "Séance annulée";
  const sentence =
    a.kind === "rdv"
      ? `Bonjour ${a.customerName}, ${a.businessName} a annulé votre rendez-vous « ${a.title} » du ${a.whenLabel}.`
      : `Bonjour ${a.customerName}, ${a.businessName} a annulé la séance « ${a.title} » du ${a.whenLabel}. Votre inscription est annulée.`;
  const html = layout(
    escapeHtml(heading),
    `
    ${mailParagraph(sentence)}
    ${returned}
    ${mailPersonalLink(a.personalLinkUrl)}
  `,
  );
  return { subject: oneLine(`${heading} : ${a.title}`), html };
}
