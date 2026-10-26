/**
 * Pure helpers for the cookieless page-view tracker, shared by the browser
 * component (<PageViewTracker />) and the /api/track route. No Node APIs here.
 */

/** Day boundaries for platform stats: visitor-hash rotation and admin charts. */
export const ADMIN_TZ = "Europe/Paris";

export type Device = "mobile" | "tablet" | "desktop";

export type ReferrerKind =
  | { kind: "none" }
  | { kind: "internal" }
  | { kind: "external"; host: string };

const UNTRACKED_PREFIXES = ["/dashboard", "/onboarding", "/admin", "/api", "/_next", "/aide/demandes", "/mon-espace"];

/**
 * Top-level segments that are app routes, never a pro's public slug. Read-only for its readers: the address rules
 * (src/lib/slug.ts) and the redirects of next.config.ts, which never take one of them for a slug (G4b).
 */
export const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  "aide",
  "admin",
  "api",
  "dashboard",
  "demo",
  "forgot-password",
  "link-google",
  "mon-espace",
  "onboarding",
  "reset-password",
  "sign-in",
  "sign-up",
  "_next",
]);

/** True for an app route segment (e.g. "admin"): never a pro's public slug. */
export function isReservedSegment(segment: string): boolean {
  return RESERVED_SEGMENTS.has(segment);
}

/**
 * Public pages only: never the back-office, onboarding, admin or API, nor a
 * client's own space (/<slug>/espace and everything under it, /mon-espace):
 * those pages show personal data and a personal link must not reach a log.
 */
export function isTrackedPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  // A query or a fragment never changes which page it is.
  const pathname = path.split(/[?#]/, 1)[0];
  if (pathname.split("/")[2] === "espace") return false;
  return !UNTRACKED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** "/altinha-paris/book/x" → "altinha-paris"; null for app routes. */
export function proSlugFromPath(path: string): string | null {
  const segment = path.split("/")[1] ?? "";
  if (!/^[a-z0-9-]+$/.test(segment) || isReservedSegment(segment)) {
    return null;
  }
  return segment;
}

const BOT_RE =
  /bot|crawl|spider|slurp|preview|inspectiontool|facebookexternalhit|headless|lighthouse|pagespeed|pingdom|monitor|curl|wget|python|axios|node-fetch|go-http-client|okhttp|java\//i;

export function isBot(userAgent: string): boolean {
  return BOT_RE.test(userAgent);
}

export function classifyDevice(userAgent: string): Device {
  if (
    /ipad|tablet|kindle|silk|playbook/i.test(userAgent) ||
    (/android/i.test(userAgent) && !/mobile/i.test(userAgent))
  ) {
    return "tablet";
  }
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile|windows phone/i.test(userAgent)) {
    return "mobile";
  }
  return "desktop";
}

export function browserName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/firefox\/|fxios/i.test(ua)) return "Firefox";
  if (/chrome\/|crios/i.test(ua)) return "Chrome";
  if (/safari\//i.test(ua)) return "Safari";
  return "Navigateur inconnu";
}

/**
 * Hosts that only bounce a visitor back into our own flow: returning from
 * Stripe Checkout is a payment round-trip, not a traffic source.
 */
const INTERNAL_REFERRER_HOSTS = new Set(["checkout.stripe.com"]);

/**
 * Compares hostnames without port or leading "www."; our own host and the
 * payment round-trip hosts count as internal.
 */
export function classifyReferrer(
  referrer: string | null | undefined,
  ownHost: string,
): ReferrerKind {
  if (!referrer) return { kind: "none" };
  let host: string;
  try {
    host = new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return { kind: "none" };
  }
  if (!host) return { kind: "none" };
  const own = ownHost.split(":")[0].replace(/^www\./, "");
  return host === own || INTERNAL_REFERRER_HOSTS.has(host)
    ? { kind: "internal" }
    : { kind: "external", host };
}

/**
 * What the page-view beacon may say about where the visitor came from: the
 * referrer's ORIGIN when it is another site, else nothing. A same-origin
 * referrer is a page of ours, and some of them carry a capability in their
 * query (the payment return `?p=<purchase id>`, the mock checkout `?purchase=`):
 * it never leaves the page, and another site's path or query is never sent
 * either. `/api/track` keeps only an external host (classifyReferrer), so the
 * origin is all it needs. Empty, malformed and opaque (`about:`, `data:`)
 * referrers give nothing.
 */
export function externalReferrer(referrer: string, pageOrigin: string): string | undefined {
  if (!referrer) return undefined;
  let origin: string;
  try {
    origin = new URL(referrer).origin;
  } catch {
    return undefined;
  }
  return origin === "null" || origin === pageOrigin ? undefined : origin;
}

export function normalizeSource(utmSource: string | null | undefined): string | null {
  const value = utmSource?.trim().toLowerCase().slice(0, 64);
  return value ? value : null;
}
