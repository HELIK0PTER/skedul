/**
 * « Nouvelle inscription » / « Nouveau rendez-vous »: the pro's notice when a CLIENT books (a free place, a held ticket,
 * a paid buy + book, or a rendez-vous). It names the client in the body only, never in the subject, and carries no
 * personal link: it goes to the pro's own address with a deep link to the planning (Decision 54).
 */
import { escapeHtml, layout } from "@/lib/email-layout";

import { mailButton, mailDetails, mailParagraph, oneLine } from "./parts";

export type ProNewBookingArgs = {
  /** a séance of an event, or a rendez-vous (an occurrence with no event) */
  kind: "seance" | "rdv";
  customerName: string;
  customerEmail: string;
  title: string;
  whenLabel: string;
  coverageLabel: string;
  planningUrl: string;
};

export function proNewBookingEmail(a: ProNewBookingArgs): { subject: string; html: string } {
  const rdv = a.kind === "rdv";
  const heading = rdv ? "Nouveau rendez-vous" : "Nouvelle inscription";
  const sentence = rdv
    ? `${a.customerName} (${a.customerEmail}) a réservé le rendez-vous « ${a.title} » (${a.whenLabel}).`
    : `${a.customerName} (${a.customerEmail}) s'est inscrit(e) à « ${a.title} » (${a.whenLabel}).`;
  const html = layout(
    escapeHtml(heading),
    `
    ${mailParagraph(sentence)}
    ${mailDetails([{ label: "Couverture", value: a.coverageLabel }])}
    <p style="margin:16px 0 0">${mailButton(a.planningUrl, "Voir dans le planning")}</p>
  `,
  );
  return { subject: oneLine(`${heading} : ${a.title}`), html };
}
