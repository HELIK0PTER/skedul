/**
 * The anchors of the public page `/[slug]` that other pages link to. Pure, so a server page, a client component and a
 * test can all import it. P4 gives the id to the block it builds: the « Boutique » block (offers per ticket type)
 * carries `id={BOUTIQUE_ANCHOR}`. Until then the link lands on the top of the existing page.
 */
export const BOUTIQUE_ANCHOR = "boutique";

/** The public page's Boutique: where a client with an empty wallet goes to buy tickets. */
export function boutiqueHref(slug: string): string {
  return `/${slug}#${BOUTIQUE_ANCHOR}`;
}

/**
 * The « Planning » heading of the public page (`tabIndex={-1}`). The sign-in dialog of the visitor bar gives it the focus
 * once the visitor is signed in: the page then refreshes and the bar is replaced by the Owner's wallet, so the focus
 * needs an element outside that swap which every state of the page renders.
 */
export const PLANNING_HEADING_ID = "planning-title";
