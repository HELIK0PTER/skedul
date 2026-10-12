/**
 * Booking and pack e-mail templates. Pure (no Resend, no server-only) so they
 * can be unit-tested; every interpolated value is HTML-escaped because names
 * and titles are typed by customers and pros.
 */
import { escapeHtml as e, layout } from "@/lib/email-layout";

const euro = (cents: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );

export function bookingConfirmationEmail(args: {
  customerName: string;
  businessName: string;
  eventTitle: string;
  whenLabel: string;
  paidLabel: string;
  calendarLinks?: { google: string; outlook: string; ics: string };
}) {
  const calendarRow = args.calendarLinks
    ? `<p style="font-size:13px;margin:16px 0 0">Ajouter à mon calendrier :
        <a href="${e(args.calendarLinks.google)}" style="color:#6366f1">Google</a> ·
        <a href="${e(args.calendarLinks.outlook)}" style="color:#6366f1">Outlook</a> ·
        <a href="${e(args.calendarLinks.ics)}" style="color:#6366f1">Apple (.ics)</a></p>`
    : "";
  return layout("Réservation confirmée ✅", `
    <p>Bonjour ${e(args.customerName)},</p>
    <p>Votre réservation <strong>${e(args.eventTitle)}</strong> avec <strong>${e(args.businessName)}</strong> est confirmée.</p>
    <table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#71717a">Quand</td><td style="text-align:right">${e(args.whenLabel)}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Paiement</td><td style="text-align:right">${e(args.paidLabel)}</td></tr>
    </table>
    ${calendarRow}
    <p style="color:#71717a;font-size:13px">À très bientôt !</p>
  `);
}

export function proNewBookingEmail(args: {
  businessName: string;
  eventTitle: string;
  whenLabel: string;
  customerName: string;
  customerEmail: string;
  fillLabel: string; // ex. "3/6 inscrits"
  paidLabel: string;
}) {
  return layout("Nouvelle réservation 📅", `
    <p>Bonjour ${e(args.businessName)},</p>
    <p>Nouvelle réservation pour <strong>${e(args.eventTitle)}</strong>.</p>
    <table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#71717a">Quand</td><td style="text-align:right">${e(args.whenLabel)}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Client</td><td style="text-align:right">${e(args.customerName)} (${e(args.customerEmail)})</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Remplissage</td><td style="text-align:right">${e(args.fillLabel)}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Paiement</td><td style="text-align:right">${e(args.paidLabel)}</td></tr>
    </table>
  `);
}

export function packReceiptEmail(args: {
  customerName: string;
  businessName: string;
  packName: string;
  credits: number;
  amountCents: number;
}) {
  return layout("Merci pour votre achat 🎟️", `
    <p>Bonjour ${e(args.customerName)},</p>
    <p>Votre pack <strong>${e(args.packName)}</strong> auprès de <strong>${e(args.businessName)}</strong> est actif.</p>
    <table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#71717a">Crédits</td><td style="text-align:right">${args.credits} séance(s)</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Montant</td><td style="text-align:right">${euro(args.amountCents)}</td></tr>
    </table>
    <p style="color:#71717a;font-size:13px">Vous pouvez maintenant réserver vos créneaux sans repayer, dans la limite de vos crédits.</p>
  `);
}
