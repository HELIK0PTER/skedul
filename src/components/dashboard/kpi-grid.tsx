import Link from "next/link";
import { CalendarRange, Ticket, Users, Wallet, type LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { KpiTile } from "@/lib/back-office/dashboard-view";

// A neutral icon for the revenue tile: the pro's currency is not always the euro.
const ICONS: Record<KpiTile["key"], LucideIcon> = {
  seances: CalendarRange,
  tickets: Ticket,
  clients: Users,
  revenue: Wallet,
};

/** The four tiles of the overview; each one links to the page that holds the figures behind it. */
export function KpiGrid({ tiles }: { tiles: KpiTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((tile) => {
        const Icon = ICONS[tile.key];
        return (
          <Link
            key={tile.key}
            href={tile.href}
            className="group min-w-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full transition-colors group-hover:border-primary/40">
              <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
                <span className="grid size-9 place-items-center rounded-xl bg-primary-muted text-accent-foreground">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-xl font-bold tracking-tight wrap-anywhere sm:text-2xl">{tile.value}</p>
                  <p className="text-sm text-zinc-600">{tile.label}</p>
                  {tile.hint && <p className="mt-0.5 text-xs text-zinc-600 wrap-anywhere">{tile.hint}</p>}
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
