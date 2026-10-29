import { escapeHtml, layout } from "@/lib/email-layout";

/**
 * Sign-in code (emailOTP type "sign-in"). The code leads the subject so a
 * mail preview shows it, and the DB tests read it with /^(\d{6})\b/.
 */
export function loginCodeEmail(args: { code: string }): { subject: string; html: string } {
  const code = escapeHtml(args.code);
  return {
    subject: `${args.code} est votre code de connexion Skedul`,
    html: layout("Votre code de connexion", `
    <p>Voici votre code pour vous connecter à Skedul :</p>
    <p style="margin:24px 0;font-size:32px;font-weight:700;letter-spacing:8px;color:#18181b">${code}</p>
    <p>Il est valable 5 minutes.</p>
    <p style="color:#71717a;font-size:13px">Si vous n'avez pas demandé ce code, ignorez cet email : personne ne peut se connecter sans lui.</p>
  `),
  };
}
