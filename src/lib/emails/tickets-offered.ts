/**
 * « Tickets offerts »: sent when a pro gives tickets to a client and ticks
 * « Prévenir le client ». `expiryText` comes from back-office/format.expiryLabel.
 */
import { plural } from "@/lib/back-office/format";
import { escapeHtml, layout } from "@/lib/email-layout";

import { mailParagraph, mailPersonalLink, oneLine } from "./parts";

export type TicketsOfferedArgs = {
  customerName: string;
  businessName: string;
  typeName: string;
  count: number;
  expiryText: string;
  personalLinkUrl: string;
};

export function ticketsOfferedEmail(a: TicketsOfferedArgs): { subject: string; html: string } {
  const tickets = plural(a.count, "ticket", "tickets");
  const inWallet = a.count > 1 ? "Ils sont déjà dans votre portefeuille." : "Il est déjà dans votre portefeuille.";
  const html = layout(
    escapeHtml("Tickets offerts"),
    `
    ${mailParagraph(
      `Bonjour ${a.customerName}, ${a.businessName} vous offre ${tickets} « ${a.typeName} », ${a.expiryText}. ${inWallet}`,
    )}
    ${mailPersonalLink(a.personalLinkUrl)}
  `,
  );
  return { subject: oneLine(`${a.businessName} vous offre ${tickets}`), html };
}
