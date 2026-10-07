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

const UNTRACKED_PREFIXES = ["/dashboard", "/onboarding", "/admin", "/api", "/_next"];

/** Top-level segments that are app routes, never a pro's public slug. */
const RESERVED_SEGMENTS = new Set([
  "admin",
  "api",
  "dashboard",
  "demo",
  "onboarding",
  "sign-in",
  "sign-up",
  "_next",
]);

/** Public pages only: never the back-office, onboarding, admin or API. */
export function isTrackedPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  return !UNTRACKED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** "/altinha-paris/book/x" → "altinha-paris"; null for app routes. */
export function proSlugFromPath(path: string): string | null {
  const segment = path.split("/")[1] ?? "";
  if (!/^[a-z0-9-]+$/.test(segment) || RESERVED_SEGMENTS.has(segment)) {
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

/** Compares hostnames without port or leading "www.". */
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
  return host === own ? { kind: "internal" } : { kind: "external", host };
}

export function normalizeSource(utmSource: string | null | undefined): string | null {
  const value = utmSource?.trim().toLowerCase().slice(0, 64);
  return value ? value : null;
}
