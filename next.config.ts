import type { NextConfig } from "next";

/**
 * Public pages refuse framing (SEC-M11, P4 contract § 5 Framing): a pro's page, a séance, an offer, the thank-you page, the espace
 * and /mon-espace must not be embeddable in another site (clickjacking on a form that books or pays). The two headers
 * say the same thing for every browser. The patterns leave out /api (the route handlers set their own headers, and a
 * header set twice would be sent twice) and /_next (static assets).
 */
const FRAME_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
];
const NOT_API_OR_ASSETS = "(?!(?:api|_next)(?:/|$))[^/]+";
/**
 * A redirect copies the matched segment into its Location header as it came: only a slug-shaped segment (the
 * SLUG_PARAM_RE shape of src/lib/public/context.ts) is ever copied, so no encoded slash, backslash or host can become
 * an open redirect. Any other segment falls through to the page, which encodes it, under the layout that answers 404.
 */
const SLUG_SEGMENT = "[a-z0-9-]{1,60}";

const nextConfig: NextConfig = {
  experimental: {
    // Vercel's request-body cap: support images are shrunk in the browser to
    // 1.3 MB or less each (src/lib/shrink-image.ts) before the Server Action.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
  async headers() {
    return [
      { source: `/:slug(${NOT_API_OR_ASSETS})`, headers: FRAME_HEADERS },
      { source: `/:slug(${NOT_API_OR_ASSETS})/:path*`, headers: FRAME_HEADERS },
      // Covered by the first rule already (a reserved segment is a single segment); named so that narrowing the first
      // rule one day cannot silently unprotect the client space.
      { source: "/mon-espace", headers: FRAME_HEADERS },
    ];
  },
  async redirects() {
    // The old flows moved for good (308, OUT:96). The pages under src/app/[slug]/book and pack redirect too, but they
    // sit under the loading boundary of [slug], where a redirect streams as a meta refresh instead of a status code.
    return [
      { source: `/:slug(${SLUG_SEGMENT})/book/:path*`, destination: "/:slug", permanent: true },
      { source: `/:slug(${SLUG_SEGMENT})/pack/:path*`, destination: "/:slug", permanent: true },
    ];
  },
};

export default nextConfig;
