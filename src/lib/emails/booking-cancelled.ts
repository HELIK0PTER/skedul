/**
 * « Inscription annulée » / « Rendez-vous annulé »: sent when a registration or a rendez-vous is cancelled by the pro
 * (P3), or by the client themselves (`by: "client"`, wired in P4). A rendez-vous is never called an inscription (P5).
 */
import { escapeHtml, layout } from "@/lib/email-layout";

import { mailParagraph, mailPersonalLink, oneLine } from "./parts";

export type BookingCancelledArgs = {
  /** a séance of an event, or a rendez-vous (an occurrence with no event) */
  kind: "seance" | "rdv";
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
  const rdv = a.kind === "rdv";
  const heading = rdv ? "Rendez-vous annulé" : "Inscription annulée";
  const what = rdv ? `votre rendez-vous « ${a.title} »` : `votre inscription à « ${a.title} »`;
  const intro =
    a.by === "pro"
      ? `Bonjour ${a.customerName}, ${a.businessName} a annulé ${what} (${a.whenLabel}).`
      : `Bonjour ${a.customerName}, votre annulation pour « ${a.title} » (${a.whenLabel}) est bien enregistrée.`;
  const reason = a.reason ? mailParagraph(`Motif : ${a.reason}`) : "";
  const returned = a.ticketReturned ? mailParagraph("Votre ticket a été rendu à votre portefeuille.") : "";
  const html = layout(
    escapeHtml(heading),
    `
    ${mailParagraph(intro)}
    ${reason}
    ${returned}
    ${mailPersonalLink(a.personalLinkUrl)}
  `,
  );
  return { subject: oneLine(`${heading} : ${a.title}`), html };
}
