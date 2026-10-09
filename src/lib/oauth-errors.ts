/**
 * French message for the `?error=` code Better Auth appends to a social
 * sign-in's or link's `errorCallbackURL`. Returns null when there is no error.
 */
export function oauthErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    // The user closed or refused the Google consent screen.
    case "access_denied":
      return "Connexion avec Google annulée.";
    // An email/password account already uses this address and its email was
    // never verified, so Better Auth refuses to link Google to it implicitly.
    // The sign-in/sign-up pages send this case to /link-google instead.
    case "account_not_linked":
      return "Un compte existe déjà avec cet email. Entrez votre mot de passe pour y relier Google.";
    // linkSocial: the Google account's email differs from the Skedul account's.
    case "email_doesn't_match":
      return "Ce compte Google n'a pas la même adresse email que votre compte Skedul. Choisissez le compte Google qui utilise cette adresse.";
    // linkSocial: this Google account already belongs to another Skedul user.
    case "account_already_linked_to_different_user":
      return "Ce compte Google est déjà relié à un autre compte Skedul.";
    case "unable_to_link_account":
      return "Impossible de relier ce compte Google. Réessayez.";
    // Admin plugin: a suspended user cannot open a session.
    case "BANNED_USER":
      return "Ce compte est suspendu. Contactez le support si vous pensez qu'il s'agit d'une erreur.";
    default:
      return "La connexion avec Google a échoué. Réessayez.";
  }
}
