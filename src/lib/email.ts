import "server-only";
import { Resend } from "resend";

import { env } from "@/lib/env";

const resend = env.RESEND_ENABLED ? new Resend(env.RESEND_API_KEY!) : null;

interface SendArgs {
  to: string;
  subject: string;
  html: string;
}

type SendResult =
  | { id: string; mocked: boolean; failed?: false }
  | { id: null; mocked: false; failed: true };

/**
 * Sends an email via Resend, or logs to the console in mock mode.
 *
 * Best effort: a failure is logged and returned, never thrown. Emails are sent
 * after a booking or payment is already saved, so a Resend outage or a rejected
 * sender must not turn a successful booking into an error for the customer.
 */
export async function sendEmail({ to, subject, html }: SendArgs): Promise<SendResult> {
  if (!resend) {
    console.info(`\n📧 [email:mock] → ${to}\n   subject: ${subject}\n`);
    return { id: "mock", mocked: true };
  }
  try {
    const { data, error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
    });
    if (error) {
      console.error(`[email] Resend rejected "${subject}":`, error);
      return { id: null, mocked: false, failed: true };
    }
    return { id: data?.id ?? "unknown", mocked: false };
  } catch (err) {
    console.error(`[email] Resend request failed for "${subject}":`, err);
    return { id: null, mocked: false, failed: true };
  }
}

/* ───────────────────────────── Templates ──────────────────────── */

const euro = (cents: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );

function layout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px">
    <div style="font-weight:700;font-size:20px;color:#6366f1;margin-bottom:16px">Skedul</div>
    <div style="background:#fff;border-radius:16px;padding:28px;border:1px solid #e4e4e7">
      <h1 style="font-size:18px;margin:0 0 12px">${title}</h1>
      ${body}
    </div>
    <p style="color:#a1a1aa;font-size:12px;text-align:center;margin-top:20px">Envoyé par Skedul · Réservations & packs prépayés</p>
  </div></body></html>`;
}

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
        <a href="${args.calendarLinks.google}" style="color:#6366f1">Google</a> ·
        <a href="${args.calendarLinks.outlook}" style="color:#6366f1">Outlook</a> ·
        <a href="${args.calendarLinks.ics}" style="color:#6366f1">Apple (.ics)</a></p>`
    : "";
  return layout("Réservation confirmée ✅", `
    <p>Bonjour ${args.customerName},</p>
    <p>Votre réservation <strong>${args.eventTitle}</strong> avec <strong>${args.businessName}</strong> est confirmée.</p>
    <table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#71717a">Quand</td><td style="text-align:right">${args.whenLabel}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Paiement</td><td style="text-align:right">${args.paidLabel}</td></tr>
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
    <p>Bonjour ${args.businessName},</p>
    <p>Nouvelle réservation pour <strong>${args.eventTitle}</strong>.</p>
    <table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#71717a">Quand</td><td style="text-align:right">${args.whenLabel}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Client</td><td style="text-align:right">${args.customerName} (${args.customerEmail})</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Remplissage</td><td style="text-align:right">${args.fillLabel}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Paiement</td><td style="text-align:right">${args.paidLabel}</td></tr>
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
    <p>Bonjour ${args.customerName},</p>
    <p>Votre pack <strong>${args.packName}</strong> auprès de <strong>${args.businessName}</strong> est actif.</p>
    <table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#71717a">Crédits</td><td style="text-align:right">${args.credits} séance(s)</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Montant</td><td style="text-align:right">${euro(args.amountCents)}</td></tr>
    </table>
    <p style="color:#71717a;font-size:13px">Vous pouvez maintenant réserver vos créneaux sans repayer, dans la limite de vos crédits.</p>
  `);
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** Sent by Better Auth's `sendResetPassword`; `url` is its one-hour token link. */
export function passwordResetEmail(args: { name: string; url: string }) {
  const firstName = escapeHtml(args.name.trim().split(/\s+/)[0] ?? "");
  return layout("Choisissez un nouveau mot de passe", `
    <p>Bonjour${firstName ? ` ${firstName}` : ""},</p>
    <p>Vous avez demandé à réinitialiser le mot de passe de votre compte Skedul. Ce lien est valable 1 heure et ne sert qu'une fois.</p>
    <p style="margin:24px 0"><a href="${escapeHtml(args.url)}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Choisir un nouveau mot de passe</a></p>
    <p style="color:#71717a;font-size:13px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe actuel reste valable.</p>
  `);
}
