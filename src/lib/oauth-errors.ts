/**
 * French message for the `?error=` code Better Auth appends to a social
 * sign-in's `errorCallbackURL`. Returns null when there is no error.
 */
export function oauthErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    // The user closed or refused the Google consent screen.
    case "access_denied":
      return "Connexion avec Google annulée.";
    // An email/password account already uses this address and its email was
    // never verified, so Better Auth refuses to link Google to it implicitly.
    case "account_not_linked":
      return "Un compte existe déjà avec cet email. Connectez-vous avec votre mot de passe, puis connectez Google Agenda dans Réglages pour pouvoir utiliser Google ensuite.";
    // Admin plugin: a suspended user cannot open a session.
    case "BANNED_USER":
      return "Ce compte est suspendu. Contactez le support si vous pensez qu'il s'agit d'une erreur.";
    default:
      return "La connexion avec Google a échoué. Réessayez.";
  }
}
