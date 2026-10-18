import "server-only";
import { Resend } from "resend";

import { env } from "@/lib/env";
import { redactSubject } from "@/lib/emails/redact-subject";

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
      console.error(`[email] Resend rejected "${redactSubject(subject)}":`, error);
      return { id: null, mocked: false, failed: true };
    }
    return { id: data?.id ?? "unknown", mocked: false };
  } catch (err) {
    console.error(`[email] Resend request failed for "${redactSubject(subject)}":`, err);
    return { id: null, mocked: false, failed: true };
  }
}
