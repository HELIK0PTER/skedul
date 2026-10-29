import { CODE_LENGTH } from "@/lib/public/sign-in-flow";

/** A run of exactly CODE_LENGTH digits (the length of the codes Better Auth makes, OTP_PLUGIN_OPTIONS.otpLength). */
const CODE_RUN = new RegExp(`\\b\\d{${CODE_LENGTH}}\\b`, "g");
const MASK = "•".repeat(CODE_LENGTH);

/**
 * Masks any CODE_LENGTH-digit run in a subject (P6 A26: the length is read from CODE_LENGTH, never spelled here). The
 * sign-in and confirmation e-mails put their single-use code first in the subject, so a subject must never reach a
 * log line as is. Use it on every log that prints a subject, except the mock-mode log in development
 * (src/lib/emails/mock-log.ts), which is how a code is read in dev; a production build prints the redacted subject
 * there too.
 */
export function redactSubject(subject: string): string {
  return subject.replace(CODE_RUN, MASK);
}
