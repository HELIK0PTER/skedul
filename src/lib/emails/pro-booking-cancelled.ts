/**
 * « Annulation d'un client »: the pro's notice when a client cancels their own registration. Like the new
 * registration notice, it names the client in the body only and carries no personal link.
 */
import { escapeHtml, layout } from "@/lib/email-layout";

import { mailButton, mailParagraph, oneLine } from "./parts";

export type ProBookingCancelledArgs = {
  customerName: string;
  customerEmail: string;
  title: string;
  whenLabel: string;
  ticketReturned: boolean;
  planningUrl: string;
};

export function proBookingCancelledEmail(a: ProBookingCancelledArgs): { subject: string; html: string } {
  const returned = a.ticketReturned ? mailParagraph("Son ticket lui a été rendu.") : "";
  const html = layout(
    escapeHtml("Annulation d'un client"),
    `
    ${mailParagraph(`${a.customerName} (${a.customerEmail}) a annulé son inscription à « ${a.title} » (${a.whenLabel}).`)}
    ${returned}
    <p style="margin:16px 0 0">${mailButton(a.planningUrl, "Voir dans le planning")}</p>
  `,
  );
  return { subject: oneLine(`Annulation : ${a.title}`), html };
}
