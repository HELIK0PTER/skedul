/**
 * The public profile read (G4a, Item 1): the professional of a public page, by slug, as a PUBLIC projection. Testable
 * core: takes `db`, imports neither server-only, next/* nor the db index. The row it returns holds the columns a public
 * page renders or needs and nothing else: never the Stripe account, the Google calendar, the theme preset, the custom
 * colour or a timestamp. `userId` is the one id of the professional's user and stays on the server (page-owner
 * detection, built into `ownerUserId` by `publicProOfRow`); `publicPageProfileOfRow` (context.ts) drops it from what
 * the page holds, and profile-guard.test.ts keeps the row out of every client component.
 */
import { and, eq, sql } from "drizzle-orm";

import type { Db } from "@/lib/db/atomic";
import { professional, user } from "@/lib/db/schema";
import { userIsSuspended, userNotSuspended } from "@/lib/suspension";

import { SLUG_PARAM_RE } from "./context";

/** The columns of `professional` a public page reads: the select and the type of the row are the same list. */
export const PUBLIC_PROFILE_COLUMNS = {
  id: professional.id,
  userId: professional.userId,
  slug: professional.slug,
  businessName: professional.businessName,
  headline: professional.headline,
  bio: professional.bio,
  avatarUrl: professional.avatarUrl,
  avatarKind: professional.avatarKind,
  avatarStyle: professional.avatarStyle,
  avatarSeed: professional.avatarSeed,
  bannerUrl: professional.bannerUrl,
  brandColor: professional.brandColor,
  headerLayout: professional.headerLayout,
  timezone: professional.timezone,
  currency: professional.currency,
  bookingHorizonDays: professional.bookingHorizonDays,
  minNoticeMinutes: professional.minNoticeMinutes,
  cancelDeadlineHours: professional.cancelDeadlineHours,
} as const;

/**
 * The public row of the pro at `slug`. A suspended pro's page is offline (null), except where `includeSuspended` is
 * set: the thank-you page, so a customer who paid just before the suspension still sees their confirmation.
 */
export async function readPublicProfile(
  db: Db,
  slug: string,
  opts: { includeSuspended?: boolean } = {},
) {
  const [row] = await db
    .select(PUBLIC_PROFILE_COLUMNS)
    .from(professional)
    .innerJoin(user, eq(user.id, professional.userId))
    .where(and(eq(professional.slug, slug), opts.includeSuspended ? undefined : userNotSuspended()))
    .limit(1);
  return row ?? null;
}

/** One row of PUBLIC_PROFILE_COLUMNS, as the select types it. */
export type PublicProfileRow = NonNullable<Awaited<ReturnType<typeof readPublicProfile>>>;

/** The pro at a slug as the `[slug]` segment reads it: a live pro's public row, or the bare fact that the pro is suspended. */
export type PublicPageRow = { suspended: false; row: PublicProfileRow } | { suspended: true };

/**
 * The one read of the `[slug]` layout and page (G4b, Item 6): the same public row as `readPublicProfile`, and whether
 * the pro is suspended, in one query without the suspension filter. The layout only needs the pro to exist (a suspended
 * pro still does: the thank-you page keeps working), the page needs it live; a suspended pro's row is never handed out.
 * Null for an unknown slug, and without a query for a segment that cannot be a pro address (SLUG_PARAM_RE): Next
 * resolves the page's generateMetadata alongside the layout, so the layout's own check does not spare that read.
 */
export async function readPublicPage(db: Db, slug: string): Promise<PublicPageRow | null> {
  if (!SLUG_PARAM_RE.test(slug)) return null;
  const [found] = await db
    .select({ ...PUBLIC_PROFILE_COLUMNS, suspended: sql<boolean>`${userIsSuspended()}` })
    .from(professional)
    .innerJoin(user, eq(user.id, professional.userId))
    .where(eq(professional.slug, slug))
    .limit(1);
  if (!found) return null;
  const { suspended, ...row } = found;
  return suspended ? { suspended: true } : { suspended: false, row };
}
