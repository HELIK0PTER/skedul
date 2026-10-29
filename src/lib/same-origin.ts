/**
 * Origin check for route handlers. Next.js compares `Origin` with `Host` for
 * Server Actions only; a route handler gets no such check, so the POST routes
 * that change state (the mock checkout, the personal-link confirmation) do it
 * themselves. Pure: no env, no request object.
 */

/** Origin header equals new URL(appUrl).origin (route handlers get no automatic origin check); null, "null" or a malformed appUrl → false. */
export function sameOrigin(originHeader: string | null, appUrl: string): boolean {
  if (originHeader === null || originHeader === "" || originHeader === "null") return false;
  let expected: string;
  try {
    expected = new URL(appUrl).origin;
  } catch {
    return false;
  }
  // An opaque URL (data:, file:) serialises its origin as "null": never a match.
  if (expected === "null") return false;
  // A browser sends the serialised origin (lower case, no path, no trailing slash): anything else is not a browser's.
  return originHeader === expected;
}
