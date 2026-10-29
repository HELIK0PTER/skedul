/**
 * The page-view beacon of <PageViewTracker /> (/api/track), as a core the route wraps (P6 A8). In this order: what
 * the tracker would never send (no or a bot user agent, a cross-site request, a malformed body, an untracked path) is
 * ignored before any read or write; then the address is counted on the beacon's own throttle keys (per IPv4 address
 * or IPv6 /64, and per /48, TRACK_THROTTLE_LIMITS); a beacon over either limit stops there, before the pro lookup and
 * the insert; else the pro of the slug is looked up and one page view is written. The address never leaves this
 * module: it is hashed with the day's salt, for the throttle and for the visitor hash alike. No server-only: the
 * route and the tests use it.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  classifyDevice,
  classifyReferrer,
  isBot,
  isTrackedPath,
  normalizeSource,
  proSlugFromPath,
} from "@/lib/analytics";
import { ipBuckets } from "@/lib/client-ip";
import type { Db } from "@/lib/db/atomic";
import { pageView, professional } from "@/lib/db/schema";
import { checkTrackThrottle } from "@/lib/throttle";
import { ipHash, visitorHash } from "@/lib/visitor-hash";

const bodySchema = z.object({
  path: z.string().min(1).max(512),
  first: z.boolean().default(false),
  referrer: z.string().max(1024).optional(),
  source: z.string().max(256).optional(),
});

/** What the route reads off the request; the body is read only once the headers pass. */
export type BeaconFacts = {
  userAgent: string | null;
  secFetchSite: string | null;
  readBody: () => Promise<string>;
  /** The host the beacon was sent to: a referrer on it is internal. */
  ownHost: string;
  /** clientIpFrom(headers): null when no header names one. */
  ip: string | null;
  /** x-vercel-ip-country, kept only when it is two capital letters. */
  country: string | null;
};

export type BeaconOutcome = "ignored" | "throttled" | "recorded";

/** The body as a beacon, with its user agent, or null for anything the tracker would never send. */
async function beaconOf(facts: BeaconFacts): Promise<(z.infer<typeof bodySchema> & { userAgent: string }) | null> {
  const userAgent = facts.userAgent;
  if (!userAgent || isBot(userAgent)) return null;
  if (facts.secFetchSite === "cross-site") return null;
  // A malformed beacon is not an error worth a stack trace in the logs.
  let json: unknown;
  try {
    json = JSON.parse(await facts.readBody());
  } catch {
    return null;
  }
  const parsed = bodySchema.safeParse(json);
  return parsed.success && isTrackedPath(parsed.data.path) ? { ...parsed.data, userAgent } : null;
}

/**
 * One beacon: « ignored » (nothing read or written, the salt not even asked for), « throttled » (the throttle counted
 * it, no page view written) or « recorded ». `daySalt` gives the salt of the current day (getDailySalt in the route).
 */
export async function recordPageView(
  db: Db,
  facts: BeaconFacts,
  daySalt: () => Promise<string>,
  now: Date,
): Promise<BeaconOutcome> {
  const beacon = await beaconOf(facts);
  if (beacon === null) return "ignored";

  const salt = await daySalt();
  const { narrow, wide } = ipBuckets(facts.ip);
  const allowed = await checkTrackThrottle(
    db,
    { ipHash: ipHash(salt, narrow), wideIpHash: wide === null ? null : ipHash(salt, wide) },
    now,
  );
  if (!allowed) return "throttled";

  const { path, first, referrer, source, userAgent } = beacon;
  const ref = classifyReferrer(first ? referrer : undefined, facts.ownHost);
  const slug = proSlugFromPath(path);
  const [pro] = slug
    ? await db.select({ id: professional.id }).from(professional).where(eq(professional.slug, slug)).limit(1)
    : [];

  await db.insert(pageView).values({
    path,
    professionalId: pro?.id ?? null,
    referrerHost: ref.kind === "external" ? ref.host : null,
    source: first ? normalizeSource(source) : null,
    entry: first && ref.kind !== "internal",
    device: classifyDevice(userAgent),
    country: facts.country && /^[A-Z]{2}$/.test(facts.country) ? facts.country : null,
    visitorHash: visitorHash({ salt, ip: facts.ip ?? "0.0.0.0", userAgent }),
  });
  return "recorded";
}
