/**
 * The anchors of the public page `/[slug]` that other pages link to. Pure, so a server page, a client component and a
 * test can all import it. The « Boutique » section of the public page (offers per ticket type) carries
 * `id={BOUTIQUE_ANCHOR}` and mounts a leaf that scrolls to it once when the URL hash names it (`scrollToHashedAnchor`),
 * then drops the fragment from the current history entry: `boutiqueHref` lands on the section, and only the visit that
 * followed the link scrolls (a Back traversal or a reload to the entry does not).
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

/**
 * The page headings an inline code sign-in gives the focus to (`tabIndex={-1}`, AUTH-1): « Mon espace client » on
 * /mon-espace and « Mon espace » in the shell of /{slug}/espace. A good code makes the page refresh as signed in, which
 * unmounts the code form and its focused button; both headings are rendered by every state of their page, outside the
 * identity switch, so they survive that swap. The pages pass the id to `EmailCodeForm` (`focusAfterSignIn`).
 */
export const MY_SPACE_HEADING_ID = "my-space-title";
export const ESPACE_HEADING_ID = "espace-title";

/**
 * Scrolls to `anchor` when the URL hash names exactly it, and says whether it did. The public page streams behind
 * loading.tsx: on a client navigation to `/{slug}#boutique` the router scrolls when the loading skeleton commits, before
 * the Boutique exists, and never again; on a fresh load the browser's own fragment scroll can run before the streamed
 * block is revealed. The Boutique mounts a leaf that calls this once its block is in the document, which settles both.
 * `hash` is `window.location.hash` and `doc` the document, passed in so the rule is testable without a browser.
 */
export function scrollToHashedAnchor(
  anchor: string,
  hash: string,
  doc: { getElementById(id: string): { scrollIntoView(): void } | null },
): boolean {
  if (hash !== `#${anchor}`) return false;
  const target = doc.getElementById(anchor);
  if (!target) return false;
  target.scrollIntoView();
  return true;
}
