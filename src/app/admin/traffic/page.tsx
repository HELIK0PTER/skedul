import type { Metadata } from "next";
import Link from "next/link";
import { Eye, Layers, Smartphone, Users } from "lucide-react";

import { BarChart } from "@/components/admin/bar-chart";
import { FilterChips } from "@/components/admin/filter-chips";
import { StatCard } from "@/components/admin/stat-card";
import { TopList } from "@/components/admin/top-list";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/admin";
import {
  countryName,
  dayLabel,
  fillDailySeries,
  lastDayKeys,
  startOfDayKey,
} from "@/lib/admin-metrics";
import { TRAFFIC_RANGES, parseRange } from "@/lib/admin-params";
import { getTrafficReport } from "@/server/admin-queries";

export const metadata: Metadata = { title: "Trafic" };

const DEVICE_LABELS: Record<string, string> = {
  mobile: "Mobile",
  tablet: "Tablette",
  desktop: "Ordinateur",
};
const fmt = (n: number) => n.toLocaleString("fr-FR");
/** "1 visiteur" / "12 visiteurs" — French treats 0 and 1 as singular. */
const withUnit = (n: number, one: string, other: string) =>
  `${fmt(n)} ${n > 1 ? other : one}`;

export default async function AdminTrafficPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requireAdmin();
  const range = parseRange((await searchParams).range);
  const keys = lastDayKeys(range, new Date());
  const report = await getTrafficReport(startOfDayKey(keys[0]));

  const viewsByDay = fillDailySeries(
    report.daily.map((d) => ({ day: d.day, value: d.views })),
    keys,
  );
  const visitorsByDay = fillDailySeries(
    report.daily.map((d) => ({ day: d.day, value: d.visitors })),
    keys,
  );
  const views = viewsByDay.reduce((sum, d) => sum + d.value, 0);
  const visitors = visitorsByDay.reduce((sum, d) => sum + d.value, 0);
  const mobile = report.devices.find((d) => d.device === "mobile")?.views ?? 0;

  return (
    <>
      <PageHeader
        title="Trafic"
        description="Pages publiques uniquement, sans cookie. Les visiteurs sont comptés jour par jour."
      />
      <div className="mb-6">
        <FilterChips
          label="Période"
          active={range}
          options={TRAFFIC_RANGES.map((r) => ({
            value: r,
            label: `${r} jours`,
            href: r === 30 ? "/admin/traffic" : `/admin/traffic?range=${r}`,
          }))}
        />
      </div>

      {views === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            Aucune visite enregistrée sur cette période. Les pages publiques sont
            mesurées dès qu&apos;elles sont consultées.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard icon={Eye} label="Pages vues" value={fmt(views)} />
            <StatCard icon={Users} label="Visiteurs" value={fmt(visitors)} />
            <StatCard
              icon={Layers}
              label="Pages par visiteur"
              value={visitors ? (views / visitors).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "—"}
            />
            <StatCard
              icon={Smartphone}
              label="Part mobile"
              value={`${Math.round((mobile / views) * 100)} %`}
            />
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Visiteurs par jour</CardTitle>
              <p className="text-sm text-muted-foreground">{range} derniers jours</p>
            </CardHeader>
            <CardContent>
              <BarChart
                unit={{ one: "visiteur", other: "visiteurs" }}
                data={visitorsByDay.map((d, i) => ({
                  key: d.day,
                  label: dayLabel(d.day),
                  value: d.value,
                  detail: withUnit(viewsByDay[i].value, "page vue", "pages vues"),
                }))}
              />
            </CardContent>
          </Card>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <TopList
              title="Pages les plus vues"
              unit={{ one: "vue", other: "vues" }}
              rows={report.pages.map((p) => ({
                key: p.path,
                label: p.path,
                sublabel: withUnit(Number(p.visitors), "visiteur", "visiteurs"),
                value: p.views,
              }))}
            />
            <TopList
              title="Pages pro les plus vues"
              unit={{ one: "vue", other: "vues" }}
              rows={report.pros.map((p) => ({
                key: p.slug,
                label: (
                  <Link href={`/admin/users/${p.userId}`} className="hover:underline">
                    {p.businessName}
                  </Link>
                ),
                sublabel: `/${p.slug}`,
                value: p.views,
              }))}
            />
            <TopList
              title="Sources"
              unit={{ one: "entrée", other: "entrées" }}
              rows={report.sources.map((s) => ({ key: s.source, label: s.source, value: s.visits }))}
            />
            <TopList
              title="Appareils"
              unit={{ one: "vue", other: "vues" }}
              rows={report.devices.map((d) => ({
                key: d.device,
                label: DEVICE_LABELS[d.device] ?? d.device,
                sublabel: `${Math.round((d.views / views) * 100)} %`,
                value: d.views,
              }))}
            />
            <TopList
              title="Pays"
              unit={{ one: "vue", other: "vues" }}
              empty="Le pays n'est connu qu'en production (Vercel)."
              rows={report.countries.map((c) => ({
                key: c.country ?? "unknown",
                label: countryName(c.country),
                value: c.views,
              }))}
            />
          </div>
        </>
      )}
    </>
  );
}
