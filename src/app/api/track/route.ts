import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  ADMIN_TZ,
  classifyDevice,
  classifyReferrer,
  isBot,
  isTrackedPath,
  normalizeSource,
  proSlugFromPath,
} from "@/lib/analytics";
import { dayKeyInTz } from "@/lib/datetime";
import { db } from "@/lib/db";
import { pageView, professional } from "@/lib/db/schema";
import { visitorHash } from "@/lib/visitor-hash";
import { getDailySalt } from "@/server/analytics-salt";

const bodySchema = z.object({
  path: z.string().min(1).max(512),
  first: z.boolean().default(false),
  referrer: z.string().max(1024).optional(),
  source: z.string().max(256).optional(),
});

function noContent() {
  return new Response(null, { status: 204 });
}

/** Receives <PageViewTracker /> beacons. Always 204: tracking never breaks a page. */
export async function POST(request: Request) {
  try {
    const userAgent = request.headers.get("user-agent");
    if (!userAgent || isBot(userAgent)) return noContent();
    if (request.headers.get("sec-fetch-site") === "cross-site") return noContent();

    // A malformed beacon is not an error worth a stack trace in the logs.
    let json: unknown;
    try {
      json = JSON.parse(await request.text());
    } catch {
      return noContent();
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success || !isTrackedPath(parsed.data.path)) return noContent();
    const { path, first, referrer, source } = parsed.data;

    const ownHost = request.headers.get("host") ?? new URL(request.url).host;
    const ref = classifyReferrer(first ? referrer : undefined, ownHost);
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "0.0.0.0";
    const country = request.headers.get("x-vercel-ip-country");

    const slug = proSlugFromPath(path);
    const [pro] = slug
      ? await db
          .select({ id: professional.id })
          .from(professional)
          .where(eq(professional.slug, slug))
          .limit(1)
      : [];

    const dayKey = dayKeyInTz(new Date(), ADMIN_TZ);
    const salt = await getDailySalt(dayKey);

    await db.insert(pageView).values({
      path,
      professionalId: pro?.id ?? null,
      referrerHost: ref.kind === "external" ? ref.host : null,
      source: first ? normalizeSource(source) : null,
      entry: first && ref.kind !== "internal",
      device: classifyDevice(userAgent),
      country: country && /^[A-Z]{2}$/.test(country) ? country : null,
      visitorHash: visitorHash({ salt, ip, userAgent }),
    });
  } catch (err) {
    console.error("[track] could not record page view", err);
  }
  return noContent();
}
