/**
 * « Inscription confirmée »: sent to a client once a registration is confirmed
 * (a ticket, a free place, a guest place or a paid one). The personal link opens
 * their space; the three buttons add the séance to their calendar.
 */
import { formatCount } from "@/lib/back-office/format";
import { escapeHtml, layout } from "@/lib/email-layout";

import { mailButton, mailDetails, mailLines, mailParagraph, mailPersonalLink, oneLine, type MailCalendarLinks } from "./parts";

/**
 * What the client still holds of one ticket type. `expiry` has one entry per last valid day (soonest first), the tickets
 * without limit last; `text` is the wording without the count (« valables jusqu'au 12/01 inclus », « sans limite de validité »).
 */
export type TicketsLeft = {
  typeName: string;
  count: number;
  expiry: readonly { count: number; text: string }[];
};

export type BookingConfirmedArgs = {
  customerName: string;
  businessName: string;
  title: string;
  whenLabel: string;
  location: string | null;
  coverageLabel: string;
  ticketTypeName: string | null;
  ticketsLeft: readonly TicketsLeft[];
  cancelText: string;
  personalLinkUrl: string;
  calendar: MailCalendarLinks;
};

/**
 * One expiry class: a single line (« 3 × Cours collectif, valables jusqu'au 12/01 inclus »). Several: the type's total,
 * then one sub-line per date (« • 2 valables jusqu'au 12/01 inclus », « • 1 sans limite de validité »).
 */
function ticketsLeftBlock(left: TicketsLeft): string {
  const head = `${formatCount(left.count)} × ${left.typeName}`;
  if (left.expiry.length <= 1) return mailParagraph(left.expiry[0] ? `${head}, ${left.expiry[0].text}` : head);
  return mailLines([head, ...left.expiry.map((group) => `• ${formatCount(group.count)} ${group.text}`)]);
}

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
          ...a.ticketsLeft.map(ticketsLeftBlock),
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
