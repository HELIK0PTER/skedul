import { escapeHtml, layout } from "@/lib/email-layout";

/**
 * Address confirmation code (emailOTP type "email-verification"): sent on a
 * password sign-up and by « Confirmez votre adresse ». A code, never a link:
 * a mail scanner that pre-opens links must not be able to confirm an address.
 */
export function verifyEmailCodeEmail(args: { code: string }): { subject: string; html: string } {
  const code = escapeHtml(args.code);
  return {
    subject: `${args.code} est votre code de confirmation Skedul`,
    html: layout("Confirmez votre adresse", `
    <p>Saisissez ce code dans Skedul pour confirmer votre adresse email :</p>
    <p style="margin:24px 0;font-size:32px;font-weight:700;letter-spacing:8px;color:#18181b">${code}</p>
    <p>Il est valable 5 minutes.</p>
    <p style="color:#71717a;font-size:13px">Si vous n'avez pas créé de compte Skedul, ignorez cet email.</p>
  `),
  };
}
