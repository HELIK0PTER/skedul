/**
 * Pure helpers of the code sign-in forms (spec L1247-1249, L1314-1315, risk 7).
 * No database, no env, no next: the three components and the tests share them.
 * Every path that leaves for /sign-in or for Google goes through returnPathOf,
 * so a purchase reference (?p=) or any other query never travels into the
 * OAuth state or a callback URL (SEC-M7).
 */
import type { VisitorState } from "@/lib/public/identity";
import { isPlainName } from "@/lib/public/plain-name";
import { safeNextPath } from "@/lib/safe-next";
import { BOUNDS } from "@/lib/tickets-vocab";

export const CODE_LENGTH = 6;

/** Where a sign-in goes when the page to come back to is missing or not a plain path of the site. */
const FALLBACK_PATH = "/mon-espace";

/** Digits only, at most CODE_LENGTH. */
export function codeInputValue(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

/** True for exactly CODE_LENGTH digits. */
export function isCompleteCode(code: string): boolean {
  return code.length === CODE_LENGTH && /^\d+$/.test(code);
}

/** The page to come back to: the path of safeNextPath(path) with its query and hash dropped (SEC-M7: a `p` never travels into /sign-in, the OAuth state or Google), else "/mon-espace". */
export function returnPathOf(path: string): string {
  const safe = safeNextPath(path);
  if (safe === null) return FALLBACK_PATH;
  return safe.split(/[?#]/, 1)[0];
}

type GoogleCallbacks = { callbackURL: string; newUserCallbackURL: string; errorCallbackURL: string };

/** Google sign-in from a public page (never the pro onboarding, L76): callbackURL and newUserCallbackURL = returnTo; errorCallbackURL = /sign-in?next=<returnTo> (its account_not_linked handler). `returnTo` goes through returnPathOf again, so the result never carries a query. */
export function googleCallbacks(returnTo: string): GoogleCallbacks {
  const to = returnPathOf(returnTo);
  return { callbackURL: to, newUserCallbackURL: to, errorCallbackURL: `/sign-in?next=${encodeURIComponent(to)}` };
}

/** AuthForm's Google callbacks (COV-I3): callbackURL /sign-in[?next=]; newUserCallbackURL: sign-up -> next ?? "/onboarding" (L1397), sign-in -> /sign-in[?next=] (the page re-resolves the entry: /mon-espace for a non-pro), never "/onboarding"; errorCallbackURL /sign-up[?next=] or /sign-in[?next=] by mode. A `next` that is not a plain path of the site counts as none. */
export function authFormGoogleCallbacks(mode: "sign-in" | "sign-up", next: string | null): GoogleCallbacks {
  const safe = safeNextPath(next);
  const query = safe === null ? "" : `?next=${encodeURIComponent(safe)}`;
  return {
    callbackURL: `/sign-in${query}`,
    newUserCallbackURL: mode === "sign-up" ? (safe ?? "/onboarding") : `/sign-in${query}`,
    errorCallbackURL: `/${mode}${query}`,
  };
}

/**
 * The page a Google link round trip comes back to (P4 final review AUTH-2): the path of safeNextPath(next), its query and
 * hash dropped like returnPathOf does (SEC-M7: a `p` never travels into the OAuth state), else null, and /sign-in then
 * routes the entry as usual (a pro to /dashboard, a client to /mon-espace).
 */
export function linkReturnPath(next: unknown): string | null {
  const safe = safeNextPath(next);
  return safe === null ? null : safe.split(/[?#]/, 1)[0];
}

/** Where /sign-in and /sign-up send an account_not_linked answer: /link-google, with ?next= when there is a page to come back to. */
export function linkGoogleHref(next: unknown): string {
  const to = linkReturnPath(next);
  return to === null ? "/link-google" : `/link-google?next=${encodeURIComponent(to)}`;
}

/**
 * LinkGoogleForm's `linkSocial` callbacks: callbackURL /sign-in[?next=] (signed in by then, /sign-in goes to next or
 * routes the entry), errorCallbackURL /link-google[?next=] (a failure is shown on the link page, which keeps next and
 * offers the link again). « Annuler » and « Continuer sans Google » use the callbackURL as well.
 */
export function linkGoogleCallbacks(next: unknown): { callbackURL: string; errorCallbackURL: string } {
  const to = linkReturnPath(next);
  const query = to === null ? "" : `?next=${encodeURIComponent(to)}`;
  return { callbackURL: `/sign-in${query}`, errorCallbackURL: `/link-google${query}` };
}

/** « J'ai un mot de passe »: /sign-in?next=<returnTo>. */
export function passwordSignInHref(returnTo: string): string {
  return `/sign-in?next=${encodeURIComponent(returnPathOf(returnTo))}`;
}

/** The name sent with a first code sign-in (L1249): trimmed, at most BOUNDS.name characters, undefined when empty or not isPlainName. */
export function nameToSend(name: string): string | undefined {
  let cut = name.trim().slice(0, BOUNDS.name);
  // A cut inside a surrogate pair would leave half an emoji: drop that half.
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  cut = cut.trim();
  if (cut === "" || !isPlainName(cut)) return undefined;
  return cut;
}

/** Risk 7 (L1816, COV-C1): the sign-in-by-code form is offered to an anonymous visitor only; never to a signed-in one, verified or not, nor while impersonating. */
export function canOfferCodeSignIn(state: VisitorState): boolean {
  return state === "anonymous";
}

/**
 * Where the focus goes when the code dialog closes (WCAG 2.4.3). After a sign-in the control that opened the dialog is
 * usually gone (the anonymous bar becomes the wallet), so the caller names another target, one that the refresh does
 * not swap. A dialog closed without a sign-in (Escape, « Fermer ») left the page as it was: null, and `Dialog` gives
 * the focus back to the control that opened it. The caller is asked after a sign-in only.
 */
export function focusTargetOnClose<T>(signedIn: boolean, target: (() => T | null) | undefined): T | null {
  return signedIn && target ? target() : null;
}
