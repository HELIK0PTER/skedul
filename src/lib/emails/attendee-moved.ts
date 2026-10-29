/**
 * « Inscription déplacée »: sent to a client whose registration the pro moved
 * to another séance, with the calendar links of the new séance (the registration is confirmed).
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

export type AttendeeMovedArgs = {
  customerName: string;
  businessName: string;
  fromTitle: string;
  fromWhenLabel: string;
  toTitle: string;
  toWhenLabel: string;
  toLocation: string | null;
  personalLinkUrl: string;
  calendar: MailCalendarLinks;
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
    ${mailParagraph(MAIL_CANCEL_UNTIL_START)}
    ${mailParagraph(MAIL_CALENDAR_UPDATE)}
    ${mailCalendarButtons(a.calendar)}
    ${mailPersonalLink(a.personalLinkUrl)}
  `,
  );
  return { subject: oneLine(`Inscription déplacée : ${a.toTitle}`), html };
}
