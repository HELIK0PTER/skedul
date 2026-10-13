import { escapeHtml, layout } from "@/lib/email-layout";

/**
 * Sent by the pre-account takeover hook (src/lib/auth-options.ts) after it
 * deleted the password of an account whose address was never confirmed.
 */
export function passwordDisabledEmail(args: { forgotPasswordUrl: string }): { subject: string; html: string } {
  return {
    subject: "Votre mot de passe Skedul a été désactivé",
    html: layout("Mot de passe désactivé", `
    <p>Vous venez de vous connecter à Skedul avec un code reçu à cette adresse.</p>
    <p>Pour votre sécurité, le mot de passe associé à cette adresse a été désactivé ; utilisez « Mot de passe oublié » pour en choisir un.</p>
    <p style="margin:24px 0"><a href="${escapeHtml(args.forgotPasswordUrl)}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Choisir un mot de passe</a></p>
    <p style="color:#71717a;font-size:13px">Vos réservations et vos tickets ne sont pas touchés.</p>
  `),
  };
}
