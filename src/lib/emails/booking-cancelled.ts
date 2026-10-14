/**
 * « Inscription annulée »: sent when a registration is cancelled by the pro
 * (P3), or by the client themselves (`by: "client"`, wired in P4).
 */
import { escapeHtml, layout } from "@/lib/email-layout";

import { mailParagraph, mailPersonalLink, oneLine } from "./parts";

export type BookingCancelledArgs = {
  customerName: string;
  businessName: string;
  title: string;
  whenLabel: string;
  by: "pro" | "client";
  ticketReturned: boolean;
  reason: string | null;
  personalLinkUrl: string;
};

export function bookingCancelledEmail(a: BookingCancelledArgs): { subject: string; html: string } {
  const intro =
    a.by === "pro"
      ? `Bonjour ${a.customerName}, ${a.businessName} a annulé votre inscription à « ${a.title} » (${a.whenLabel}).`
      : `Bonjour ${a.customerName}, votre annulation pour « ${a.title} » (${a.whenLabel}) est bien enregistrée.`;
  const reason = a.reason ? mailParagraph(`Motif : ${a.reason}`) : "";
  const returned = a.ticketReturned ? mailParagraph("Votre ticket a été rendu à votre portefeuille.") : "";
  const html = layout(
    escapeHtml("Inscription annulée"),
    `
    ${mailParagraph(intro)}
    ${reason}
    ${returned}
    ${mailPersonalLink(a.personalLinkUrl)}
  `,
  );
  return { subject: oneLine(`Inscription annulée : ${a.title}`), html };
}
