/**
 * « Nouvelle inscription »: the pro's notice when a CLIENT books (a free place, a held ticket, a paid buy + book).
 * It names the client in the body only, never in the subject, and carries no personal link: it goes to the pro's own
 * address with a deep link to the planning (Decision 54).
 */
import { escapeHtml, layout } from "@/lib/email-layout";

import { mailButton, mailDetails, mailParagraph, oneLine } from "./parts";

export type ProNewBookingArgs = {
  customerName: string;
  customerEmail: string;
  title: string;
  whenLabel: string;
  coverageLabel: string;
  planningUrl: string;
};

export function proNewBookingEmail(a: ProNewBookingArgs): { subject: string; html: string } {
  const html = layout(
    escapeHtml("Nouvelle inscription"),
    `
    ${mailParagraph(`${a.customerName} (${a.customerEmail}) s'est inscrit(e) à « ${a.title} » (${a.whenLabel}).`)}
    ${mailDetails([{ label: "Couverture", value: a.coverageLabel }])}
    <p style="margin:16px 0 0">${mailButton(a.planningUrl, "Voir dans le planning")}</p>
  `,
  );
  return { subject: oneLine(`Nouvelle inscription : ${a.title}`), html };
}
