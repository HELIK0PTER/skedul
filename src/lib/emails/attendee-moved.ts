/**
 * « Inscription déplacée »: sent to a client whose registration the pro moved
 * to another séance.
 */
import { escapeHtml, layout } from "@/lib/email-layout";

import { mailDetails, mailParagraph, mailPersonalLink, oneLine } from "./parts";

export type AttendeeMovedArgs = {
  customerName: string;
  businessName: string;
  fromTitle: string;
  fromWhenLabel: string;
  toTitle: string;
  toWhenLabel: string;
  toLocation: string | null;
  personalLinkUrl: string;
};

export function attendeeMovedEmail(a: AttendeeMovedArgs): { subject: string; html: string } {
  const rows = [
    { label: "Avant", value: `${a.fromTitle}, ${a.fromWhenLabel}` },
    { label: "Maintenant", value: `${a.toTitle}, ${a.toWhenLabel}` },
    ...(a.toLocation ? [{ label: "Lieu", value: a.toLocation }] : []),
  ];
  const html = layout(
    escapeHtml("Inscription déplacée"),
    `
    ${mailParagraph(`Bonjour ${a.customerName}, ${a.businessName} a déplacé votre inscription.`)}
    ${mailDetails(rows)}
    ${mailParagraph("Si ce changement ne vous convient pas, vous pouvez annuler en ligne jusqu'au début de la séance.")}
    ${mailPersonalLink(a.personalLinkUrl)}
  `,
  );
  return { subject: oneLine(`Inscription déplacée : ${a.toTitle}`), html };
}
