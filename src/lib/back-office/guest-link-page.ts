/**
 * The page a valid personal link answers on GET (Decision 68, SEC-I4): « Ouvrir mon espace chez {businessName} » with
 * one POST form. Pure and script-free. A mail scanner, a prefetch or a cross-site navigation that merely opens the
 * link plants nothing; only a same-origin click on the button does, because the route sets the cookie on the POST.
 * Every value is escaped and the page links nowhere. French, vouvoiement, no dash.
 */
import { escapeHtml } from "@/lib/email-layout";

/**
 * The response headers of that page. The referrer policy is `strict-origin`, not `no-referrer`: the policy of the
 * document that holds a form also decides the `Origin` header of its POST, and `no-referrer` makes browsers send
 * `Origin: null` on that same-origin POST, which the route's same-origin check must refuse. `strict-origin` sends
 * only the origin as `Referer` (the token, which is in this page's path, never leaves it) and keeps `Origin` intact.
 * The CSP allows the inline style and nothing else: no script, no image, no framing, forms to this site only.
 */
export const GUEST_LINK_PAGE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "strict-origin",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex",
};

/** One centred column of at most 28rem; the button is full width below 640 px. The violet is the accent text colour of the site (7:1 on white). */
const STYLE = [
  "*{box-sizing:border-box}",
  "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fafafa;color:#18181b;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.5}",
  "main{width:100%;max-width:28rem;margin:0 auto;padding:2rem 1rem;text-align:center}",
  ".card{background:#fff;border:1px solid #e7e7ee;border-radius:1rem;padding:1.5rem;box-shadow:0 1px 2px rgba(0,0,0,.05)}",
  "h1{font-size:1.25rem;line-height:1.3;margin:0 0 .75rem;overflow-wrap:anywhere}",
  "p{margin:0 0 1.25rem;overflow-wrap:anywhere}",
  ".hint{font-size:.875rem;color:#52525b;margin:1rem 0 0}",
  "button{font:inherit;font-weight:600;cursor:pointer;border:0;border-radius:.75rem;background:#4c3ed9;color:#fff;padding:.75rem 1.5rem;min-height:2.75rem}",
  "button:hover{background:#4033b8}",
  "button:focus-visible{outline:3px solid #8b7cf6;outline-offset:2px}",
  "@media (max-width:640px){button{width:100%}}",
].join("");

/** The page a valid personal link answers on GET: no script, every value escaped, one POST form to `actionPath`. */
export function guestLinkPageHtml(a: { businessName: string; actionPath: string }): string {
  const name = escapeHtml(a.businessName);
  const action = escapeHtml(a.actionPath);
  return [
    "<!doctype html>",
    '<html lang="fr">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    "<title>Ouvrir mon espace</title>",
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    "<main>",
    '<div class="card">',
    `<h1>Ouvrir mon espace chez ${name}</h1>`,
    `<p>Ce lien personnel donne accès à vos réservations et à vos tickets chez ${name}.</p>`,
    `<form method="post" action="${action}">`,
    '<button type="submit">Ouvrir mon espace</button>',
    "</form>",
    "</div>",
    '<p class="hint">Vous n\'attendiez pas ce lien ? Fermez simplement cette page.</p>',
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
}
