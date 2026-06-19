import "server-only";
import { Resend } from "resend";

import { env } from "@/lib/env";

const resend = env.RESEND_ENABLED ? new Resend(env.RESEND_API_KEY!) : null;

interface SendArgs {
  to: string;
  subject: string;
  html: string;
}

/** Sends an email via Resend, or logs to the console in mock mode. */
export async function sendEmail({ to, subject, html }: SendArgs) {
  if (!resend) {
    console.info(`\n📧 [email:mock] → ${to}\n   subject: ${subject}\n`);
    return { id: "mock", mocked: true as const };
  }
  const { data, error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject,
    html,
  });
  if (error) {
    console.error("[email] Resend error:", error);
    throw new Error(error.message);
  }
  return { id: data?.id ?? "unknown", mocked: false as const };
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
}) {
  return layout("Réservation confirmée ✅", `
    <p>Bonjour ${args.customerName},</p>
    <p>Votre réservation <strong>${args.eventTitle}</strong> avec <strong>${args.businessName}</strong> est confirmée.</p>
    <table style="width:100%;font-size:14px;margin:16px 0;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#71717a">Quand</td><td style="text-align:right">${args.whenLabel}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a">Paiement</td><td style="text-align:right">${args.paidLabel}</td></tr>
    </table>
    <p style="color:#71717a;font-size:13px">À très bientôt !</p>
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
