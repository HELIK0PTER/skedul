/**
 * « Séance modifiée »: sent to the registered clients when the pro changes the
 * time, the place or the title of a séance they attend.
 */
import { escapeHtml, layout } from "@/lib/email-layout";

import { mailDetails, mailParagraph, mailPersonalLink, oneLine } from "./parts";

export type OccurrenceChangedArgs = {
  customerName: string;
  businessName: string;
  title: string;
  whenLabel: string;
  location: string | null;
  canCancelUntilStart: boolean;
  personalLinkUrl: string;
};

export function occurrenceChangedEmail(a: OccurrenceChangedArgs): { subject: string; html: string } {
  const rows = [
    { label: "Séance", value: a.title },
    { label: "Date", value: a.whenLabel },
    ...(a.location ? [{ label: "Lieu", value: a.location }] : []),
  ];
  const cancel = a.canCancelUntilStart
    ? mailParagraph("Si ce changement ne vous convient pas, vous pouvez annuler en ligne jusqu'au début de la séance.")
    : "";
  const html = layout(
    escapeHtml("Séance modifiée"),
    `
    ${mailParagraph(
      `Bonjour ${a.customerName}, ${a.businessName} a modifié une séance où vous êtes inscrit(e). Voici les informations à jour :`,
    )}
    ${mailDetails(rows)}
    ${cancel}
    ${mailPersonalLink(a.personalLinkUrl)}
  `,
  );
  return { subject: oneLine(`Séance modifiée : ${a.title}`), html };
}
