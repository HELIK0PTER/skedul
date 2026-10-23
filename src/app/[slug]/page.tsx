import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Boutique } from "@/components/public/boutique";
import { PublicPlanning } from "@/components/public/public-planning";
import { PublicShell } from "@/components/public/public-shell";
import { addDays, todayKey } from "@/lib/civil-date";
import { paramForWeek, weekBounds, weekStartFromParam } from "@/lib/planning";
import { publicProOfRow } from "@/lib/public/context";
import {
  groupByDay,
  parsePlanningParams,
  planningEmptyState,
  planningNav,
  toPublicSeanceVM,
} from "@/lib/public/planning-view";
import { BOUTIQUE_ANCHOR } from "@/lib/public-anchors";
import { getBoutiquePage, getNextSeanceStart, getPlanningPage, getPublicPageProfile } from "@/server/public-queries";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ semaine?: string | string[]; vue?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const profile = await getPublicPageProfile(slug);
  if (!profile) return { title: "Page introuvable" };
  return { title: profile.pro.businessName, description: profile.pro.headline ?? undefined };
}

/**
 * The public page of a pro: its planning (« Liste » or « Semaine », one week at a time) and its Boutique. Dynamic by
 * construction (it reads the search parameters) and read-only: a render never writes. Anyone may open it; what is
 * personal to a visitor (wallet, banners) is added by the next task.
 */
export default async function PublicProfilePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const profile = await getPublicPageProfile(slug);
  if (!profile) notFound();
  const pro = publicProOfRow(profile.pro);
  const { semaine, view } = parsePlanningParams(await searchParams);

  const now = new Date();
  const tz = pro.timezone;
  const weekStart = weekStartFromParam(semaine, tz, now);
  const range = weekBounds(weekStart, tz);
  const weekKey = paramForWeek(weekStart, tz);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekKey, i));

  const [seances, boutique] = await Promise.all([getPlanningPage(pro, range), getBoutiquePage(pro.professionalId)]);
  // Only an empty week asks where the next séance is, and only a week with nothing after it asks if there is any at all.
  const nextStart = seances.length === 0 ? await getNextSeanceStart(pro, range.end) : null;
  const anyStart = seances.length === 0 && nextStart === null ? await getNextSeanceStart(pro, now) : null;
  const { empty, nextWeekHref } = planningEmptyState({ slug: pro.slug, view, tz, shown: seances.length, nextStart, anyStart });

  return (
    <PublicShell branding={profile.pro}>
      {profile.pro.bio && <p className="mb-8 whitespace-pre-line text-zinc-600 wrap-anywhere">{profile.pro.bio}</p>}
      <div className="space-y-10">
        <PublicPlanning
          nav={planningNav({ slug: pro.slug, weekKey, view, todayKey: todayKey(now, tz) })}
          view={view}
          days={groupByDay(
            seances.map((s) => toPublicSeanceVM(s, pro.slug, now, tz)),
            days,
          )}
          empty={empty}
          nextWeekHref={nextWeekHref}
          shopHref={boutique.length > 0 ? `#${BOUTIQUE_ANCHOR}` : null}
        />
        <Boutique slug={pro.slug} currency={pro.currency} types={boutique} />
      </div>
    </PublicShell>
  );
}
