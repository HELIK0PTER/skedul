import "server-only";
import { Resend } from "resend";

import { env } from "@/lib/env";
import { mockMailLog, mockMailRefusal } from "@/lib/emails/mock-log";
import { redactSubject } from "@/lib/emails/redact-subject";
import { logSafeMessage } from "@/lib/log-safe";

// A production deployment without a Resend key fails when this module loads (the build fails).
const refusal = mockMailRefusal(env.APP_ENV, env.RESEND_ENABLED);
if (refusal) throw new Error(refusal);

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
    // Development aid: the whole mail (recipient, code, links), so a flow can be followed without a
    // mailbox. A production build (preview deployments included) prints the redacted subject only (SEC-3).
    console.info(mockMailLog({ to, subject, html }, process.env.NODE_ENV === "production"));
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
      console.error(`[email] Resend rejected "${redactSubject(subject)}": ${logSafeMessage(error)}`);
      return { id: null, mocked: false, failed: true };
    }
    return { id: data?.id ?? "unknown", mocked: false };
  } catch (err) {
    console.error(`[email] Resend request failed for "${redactSubject(subject)}": ${logSafeMessage(err)}`);
    return { id: null, mocked: false, failed: true };
  }
}
