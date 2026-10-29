import { escapeHtml, layout } from "@/lib/email-layout";

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
