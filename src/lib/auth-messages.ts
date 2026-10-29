import { oauthErrorMessage } from "./oauth-errors";
import { COPY } from "./public/messages";

/**
 * French sentences for the failures of Better Auth client calls (sign-in, sign-up, the e-mail code of the
 * dashboard banner). A failed call resolves to `{ error }` with the HTTP `status` and the `code` of the answer;
 * its `message` is English and is never shown.
 */
export type AuthClientError = { status?: number; code?: string } | null | undefined;

export const RATE_LIMITED = "Trop de demandes. Réessayez dans quelques minutes.";
export const ACCOUNT_EXISTS = "Un compte existe déjà avec cet email. Connectez-vous ou réinitialisez votre mot de passe.";
export const WRONG_CREDENTIALS = "Email ou mot de passe incorrect.";
export const GENERIC_ERROR = "Une erreur est survenue.";
export const SEND_FAILED = "L'envoi a échoué. Réessayez dans un instant.";
export const VERIFY_FAILED = "La vérification a échoué. Réessayez dans un instant.";
export const WRONG_CODE = "Code incorrect ou expiré.";
export const TOO_MANY_ATTEMPTS = "Trop d'essais. Demandez un nouveau code.";
/** The neutral answer to every code request (spec L1247): it never says whether the address has an account. */
export const CODE_SENT = "Si l'adresse est valide, un code a été envoyé.";
/** A suspended account cannot open a session (Better Auth admin plugin, code BANNED_USER). */
export const ACCOUNT_SUSPENDED = oauthErrorMessage("BANNED_USER") ?? GENERIC_ERROR;
/** The code of the 400 a code sign-in or a sign-up gets for a name that is not isPlainName (auth hook, P6 A9, X1). */
export const NAME_NOT_PLAIN_CODE = "NAME_NOT_PLAIN";
/** The code of the 400 a sign-up or a code sign-in gets for a profile image, which Skedul never asks for (auth hook, P6 X1). */
export const IMAGE_NOT_ACCEPTED_CODE = "IMAGE_NOT_ACCEPTED";
/** Its sentence: only a request that skips Skedul's forms sends an image, so the forms show the generic one. */
export const IMAGE_NOT_ACCEPTED = "Une image de profil ne peut pas être envoyée ici.";

function isServerError(error: AuthClientError): boolean {
  return typeof error?.status === "number" && error.status >= 500;
}

/** Sign-in and sign-up form: the sentence for a failed submit. */
export function authFormErrorMessage(error: AuthClientError): string {
  if (error?.status === 429) return RATE_LIMITED;
  switch (error?.code) {
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return ACCOUNT_EXISTS;
    case "INVALID_EMAIL_OR_PASSWORD":
      return WRONG_CREDENTIALS;
    // Admin plugin: a suspended user cannot open a session.
    case "BANNED_USER":
      return ACCOUNT_SUSPENDED;
    // The sign-up hook's name check (P6 X1): the form checks it first, this is for a form older than the rule.
    case NAME_NOT_PLAIN_CODE:
      return COPY.PLAIN_NAME;
    default:
      return GENERIC_ERROR;
  }
}

/**
 * After « Recevoir un code »: the sentence of a failed send, or null when the answer is the neutral
 * « Si l'adresse est valide, un code a été envoyé. ». Only a rate limit and a server failure differ from it, so the
 * answer never tells whether the address exists.
 */
export function sendCodeFailure(error: AuthClientError): string | null {
  if (error?.status === 429) return RATE_LIMITED;
  if (isServerError(error)) return SEND_FAILED;
  return null;
}

/**
 * After « Confirmer »: the sentence of a refused code. Better Auth answers 400 INVALID_OTP or OTP_EXPIRED, then
 * 403 TOO_MANY_ATTEMPTS once the 3 attempts of a code are used (the way out is a new code). A suspended account
 * (403 BANNED_USER, raised when the sign-in tries to open its session) reads the suspension sentence, never
 * « code incorrect »; so does a name the server refuses (400 NAME_NOT_PLAIN, the code itself untouched).
 */
export function verifyCodeFailure(error: AuthClientError): string {
  if (error?.status === 429) return RATE_LIMITED;
  if (isServerError(error)) return VERIFY_FAILED;
  if (error?.code === "TOO_MANY_ATTEMPTS") return TOO_MANY_ATTEMPTS;
  if (error?.code === "BANNED_USER") return ACCOUNT_SUSPENDED;
  if (error?.code === NAME_NOT_PLAIN_CODE) return COPY.PLAIN_NAME;
  return WRONG_CODE;
}
