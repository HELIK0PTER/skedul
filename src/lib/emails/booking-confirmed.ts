/**
 * « Inscription confirmée »: sent to a client once a registration is confirmed
 * (a ticket, a free place, a guest place or a paid one). The personal link opens
 * their space; the three buttons add the séance to their calendar.
 */
import { escapeHtml, layout } from "@/lib/email-layout";

import { mailButton, mailDetails, mailParagraph, mailPersonalLink, oneLine, type MailCalendarLinks } from "./parts";

export type BookingConfirmedArgs = {
  customerName: string;
  businessName: string;
  title: string;
  whenLabel: string;
  location: string | null;
  coverageLabel: string;
  ticketTypeName: string | null;
  ticketsLeft: readonly { typeName: string; count: number; expiryText: string }[];
  cancelText: string;
  personalLinkUrl: string;
  calendar: MailCalendarLinks;
};

export function bookingConfirmedEmail(a: BookingConfirmedArgs): { subject: string; html: string } {
  const rows = [
    { label: "Séance", value: a.title },
    { label: "Date", value: a.whenLabel },
    ...(a.location ? [{ label: "Lieu", value: a.location }] : []),
    { label: "Couverture", value: a.ticketTypeName ? `${a.coverageLabel} (${a.ticketTypeName})` : a.coverageLabel },
  ];
  const ticketsLeft =
    a.ticketsLeft.length > 0
      ? [
          mailParagraph("Vos tickets restants :"),
          ...a.ticketsLeft.map((left) => mailParagraph(`${left.count} × ${left.typeName}, ${left.expiryText}`)),
        ].join("\n    ")
      : "";
  const cancel = a.cancelText.trim() ? mailParagraph(a.cancelText) : "";
  const calendar = `<p style="margin:20px 0 8px">${mailButton(a.calendar.googleUrl, "Ajouter à Google Agenda")}${mailButton(
    a.calendar.outlookUrl,
    "Ajouter à Outlook",
  )}${mailButton(a.calendar.icsUrl, "Télécharger pour mon agenda (.ics)")}</p>`;
  const html = layout(
    escapeHtml("Inscription confirmée"),
    `
    ${mailParagraph(`Bonjour ${a.customerName}, votre inscription chez ${a.businessName} est confirmée.`)}
    ${mailDetails(rows)}
    ${ticketsLeft}
    ${cancel}
    ${calendar}
    ${mailPersonalLink(a.personalLinkUrl)}
  `,
  );
  return { subject: oneLine(`Inscription confirmée : ${a.title}`), html };
}
