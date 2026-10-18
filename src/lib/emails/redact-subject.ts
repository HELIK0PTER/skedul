/**
 * Masks any 6-digit run in a subject. The sign-in and confirmation e-mails put
 * their single-use code first in the subject, so a subject must never reach a
 * log line as is. Use it on every log that prints a subject, except the
 * mock-mode `console.info` in src/lib/email.ts, which is how a code is read in dev.
 */
export function redactSubject(subject: string): string {
  return subject.replace(/\b\d{6}\b/g, "••••••");
}
