import "server-only";
import { Resend } from "resend";

import { env } from "@/lib/env";
import { escapeHtml, layout } from "@/lib/email-layout";

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
