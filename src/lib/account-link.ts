/**
 * The account link of the site header (landing, help center, /mon-espace): one label per place. A pro's link leads to
 * the back-office and is « Tableau de bord »; « Mon espace » names the client space `/mon-espace` and nothing else (on
 * that page a pro reading « Mon espace » for the dashboard would have two places under one label). A signed-in user
 * without a pro page gets the client space, which carries its own « Vous êtes pro ? Créer ma page ». Pure: no env, no
 * session, no next.
 */
import { COPY } from "@/lib/public/messages";

export type AccountLink = { href: string; label: string };

export function accountLink(a: { signedIn: boolean; hasPro: boolean }): AccountLink | null {
  if (!a.signedIn) return null;
  if (a.hasPro) return { href: "/dashboard", label: "Tableau de bord" };
  return { href: "/mon-espace", label: COPY.MY_SPACE };
}
