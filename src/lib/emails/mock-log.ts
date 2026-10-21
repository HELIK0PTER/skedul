/**
 * The mock-mode mail log of src/lib/email.ts, pure so it is tested (final
 * review SEC-3). In development the whole mail is printed (recipient, subject
 * with its sign-in code, links), which is how a flow is followed without a
 * mailbox. In a production build, preview deployments included, a log line
 * reaches shared log storage: only the redacted subject is printed, never the
 * recipient, a code or a link.
 */
import { mockLinks } from "./mock-links";
import { redactSubject } from "./redact-subject";

export function mockMailLog(mail: { to: string; subject: string; html: string }, production: boolean): string {
  if (production) return `[email:mock] ${redactSubject(mail.subject)}`;
  const links = mockLinks(mail.html);
  return `\n📧 [email:mock] → ${mail.to}\n   subject: ${mail.subject}\n${links.map((link) => `   link: ${link}\n`).join("")}`;
}

/**
 * Why mock e-mail must not run, or null. A production deployment without a
 * Resend key would never deliver a sign-in code or a client mail, so it is
 * refused when the module loads (the build fails, like a missing DATABASE_URL).
 */
export function mockMailRefusal(appEnv: string, resendEnabled: boolean): string | null {
  if (appEnv === "production" && !resendEnabled) {
    return "RESEND_API_KEY is required when APP_ENV=production: mock e-mail would deliver nothing.";
  }
  return null;
}
