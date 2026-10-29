/**
 * « Séance modifiée »: sent to the registered clients when the pro changes the
 * time, the place or the title of a séance they attend. A client whose place is
 * confirmed also gets the calendar links of the new time (`calendar`); one who has
 * not paid yet has no .ics file to download, so `calendar` is null for them.
 */
import { escapeHtml, layout } from "@/lib/email-layout";

import {
  MAIL_CALENDAR_UPDATE,
  MAIL_CANCEL_UNTIL_START,
  mailCalendarButtons,
  mailDetails,
  mailParagraph,
  mailPersonalLink,
  oneLine,
  type MailCalendarLinks,
} from "./parts";

export type OccurrenceChangedArgs = {
  customerName: string;
  businessName: string;
  title: string;
  whenLabel: string;
  location: string | null;
  canCancelUntilStart: boolean;
  personalLinkUrl: string;
  calendar: MailCalendarLinks | null;
};

export function occurrenceChangedEmail(a: OccurrenceChangedArgs): { subject: string; html: string } {
  const rows = [
    { label: "Séance", value: a.title },
    { label: "Date", value: a.whenLabel },
    ...(a.location ? [{ label: "Lieu", value: a.location }] : []),
  ];
  const cancel = a.canCancelUntilStart
    ? mailParagraph(MAIL_CANCEL_UNTIL_START)
    : "";
  const calendar = a.calendar ? `${mailParagraph(MAIL_CALENDAR_UPDATE)}${mailCalendarButtons(a.calendar)}` : "";
  const html = layout(
    escapeHtml("Séance modifiée"),
    `
    ${mailParagraph(
      `Bonjour ${a.customerName}, ${a.businessName} a modifié une séance où vous êtes inscrit(e). Voici les informations à jour :`,
    )}
    ${mailDetails(rows)}
    ${cancel}
    ${calendar}
    ${mailPersonalLink(a.personalLinkUrl)}
  `,
  );
  return { subject: oneLine(`Séance modifiée : ${a.title}`), html };
}
