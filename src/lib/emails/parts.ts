/**
 * HTML building blocks of the client e-mails (registrations, changes,
 * cancellations, offered tickets). Pure: every text and every URL goes through
 * escapeHtml, so values typed by pros and customers cannot break the markup.
 */
import { escapeHtml } from "@/lib/email-layout";

const BUTTON_STYLE =
  "display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;margin:0 8px 8px 0";

/** A cancellation that gives the ticket back (booking-cancelled, occurrence-cancelled): one wording in every mail. */
export const MAIL_TICKET_RETURNED = "Votre ticket a été rendu à votre portefeuille.";
/** A séance moved or changed by the pro (attendee-moved, occurrence-changed): the client may still cancel online. */
export const MAIL_CANCEL_UNTIL_START =
  "Si ce changement ne vous convient pas, vous pouvez annuler en ligne jusqu'au début de la séance.";
/** The line above the calendar buttons of a moved or changed séance (attendee-moved, occurrence-changed). */
export const MAIL_CALENDAR_UPDATE = "Pour mettre à jour votre agenda :";

/** The three « Ajouter à mon agenda » links of a confirmed registration (its .ics file is that booking's). */
export type MailCalendarLinks = { googleUrl: string; outlookUrl: string; icsUrl: string };

/** <p> with escaped text. */
export function mailParagraph(text: string): string {
  return `<p>${escapeHtml(text)}</p>`;
}

/** One <p> of escaped lines separated by <br>: a heading line and its sub-lines stay together. */
export function mailLines(lines: readonly string[]): string {
  return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
}

/** Two-column table of escaped label / value rows. */
export function mailDetails(rows: readonly { label: string; value: string }[]): string {
  const lines = rows
    .map(
      (row) =>
        `<tr><td style="padding:6px 0;color:#71717a">${escapeHtml(row.label)}</td><td style="text-align:right">${escapeHtml(row.value)}</td></tr>`,
    )
    .join("");
  return `<table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse">${lines}</table>`;
}

/** The three « Ajouter à mon agenda » buttons of a booking (Google, Outlook, .ics file). */
export function mailCalendarButtons(calendar: MailCalendarLinks): string {
  return `<p style="margin:20px 0 8px">${mailButton(calendar.googleUrl, "Ajouter à Google Agenda")}${mailButton(
    calendar.outlookUrl,
    "Ajouter à Outlook",
  )}${mailButton(calendar.icsUrl, "Télécharger pour mon agenda (.ics)")}</p>`;
}

/** Button link; href and label escaped. */
export function mailButton(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="${BUTTON_STYLE}">${escapeHtml(label)}</a>`;
}

/** « Voir mes réservations et mes tickets » button + « Ce lien est personnel : ne le transférez pas. » */
export function mailPersonalLink(url: string): string {
  return `<p style="margin:24px 0 8px">${mailButton(url, "Voir mes réservations et mes tickets")}</p>
    <p style="color:#71717a;font-size:13px">Ce lien est personnel : ne le transférez pas.</p>`;
}

/** Subject-safe text: CR/LF and runs of spaces collapsed to one space. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
