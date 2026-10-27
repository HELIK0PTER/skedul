import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin } from "lucide-react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { INLINE_LINK_CLASS } from "@/components/ui/link-class";
import { COPY } from "@/lib/public/messages";
import { stateBadgeVariant, type PlanningNav, type PlanningView, type PublicDay, type PublicSeanceVM } from "@/lib/public/planning-view";
import { PLANNING_HEADING_ID } from "@/lib/public-anchors";
import { cn } from "@/lib/utils";

function ViewLink({ href, current, children }: { href: string; current: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "rounded-lg px-3 py-1.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        current ? "bg-primary-muted text-accent-foreground" : "text-zinc-600 hover:bg-muted",
      )}
    >
      {children}
    </Link>
  );
}

/** One séance of the « Liste » view: a single link whose accessible name is the view model's `ariaLabel` (COV-M12). */
function SeanceRow({ vm }: { vm: PublicSeanceVM }) {
  const cancelled = vm.stateKind === "cancelled";
  return (
    <Link
      href={vm.href}
      aria-label={vm.ariaLabel}
      className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="flex min-w-0 gap-3">
        <span aria-hidden className="w-1 shrink-0 self-stretch rounded-full" style={{ backgroundColor: vm.color }} />
        <span className="min-w-0 space-y-1">
          <span className="block text-xs font-medium tabular-nums text-zinc-600">{vm.timeLabel}</span>
          <span className={cn("block font-medium wrap-anywhere", vm.muted && "text-zinc-600", cancelled && "line-through")}>
            {vm.title}
          </span>
          {vm.location && (
            <span className="flex items-start gap-1.5 text-sm text-zinc-600">
              <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 wrap-anywhere">{vm.location}</span>
            </span>
          )}
          {vm.badges.length > 0 && (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {vm.badges.map((badge) => (
                <span key={badge.name} className="inline-flex items-center gap-1.5 text-xs text-zinc-700">
                  <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: badge.color }} />
                  <span className="wrap-anywhere">{badge.name}</span>
                </span>
              ))}
            </span>
          )}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 text-right">
        {vm.stateText && <Badge variant={stateBadgeVariant(vm.stateKind)}>{vm.stateText}</Badge>}
        {vm.seatsText && <span className="text-xs text-zinc-600">{vm.seatsText}</span>}
      </span>
    </Link>
  );
}

/** One séance of the « Semaine » view: a chip in its day column, named by `ariaLabel`. */
function SeanceChip({ vm }: { vm: PublicSeanceVM }) {
  const cancelled = vm.stateKind === "cancelled";
  const tail = vm.stateText ?? vm.seatsText;
  return (
    <Link
      href={vm.href}
      aria-label={vm.ariaLabel}
      className="block rounded-xl border border-border bg-card p-2 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ borderLeft: `4px solid ${vm.color}` }}
    >
      <span className="block tabular-nums text-zinc-600">{vm.timeLabel}</span>
      <span className={cn("mt-0.5 block text-sm font-medium wrap-anywhere", vm.muted && "text-zinc-600", cancelled && "line-through")}>
        {vm.title}
      </span>
      {tail && <span className="mt-1 block text-zinc-600">{tail}</span>}
    </Link>
  );
}

/**
 * The public planning of `/[slug]` (spec L1440-1443, Decisions 46, 47): a « Liste » view (a section per day with
 * séances) and a « Semaine » view (seven day columns of chips, from 640 px; below that the list always shows). A week
 * without séance says so and points to the next one; a pro with nothing ahead gets an empty state, with a link to the
 * Boutique when it has offers. Every label comes from the view model: nothing here reads the database. The heading takes
 * the focus when the sign-in dialog of the visitor bar closes after a sign-in (Task 25b): it is rendered in every
 * state, whatever `empty` is.
 */
export function PublicPlanning({
  nav,
  view,
  days,
  empty,
  nextWeekHref,
  shopHref,
}: {
  nav: PlanningNav;
  view: PlanningView;
  days: PublicDay[];
  empty: "week" | "all" | null;
  nextWeekHref: string | null;
  shopHref: string | null;
}) {
  const withSeances = days.filter((day) => day.seances.length > 0);
  return (
    <section aria-labelledby={PLANNING_HEADING_ID} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id={PLANNING_HEADING_ID}
          tabIndex={-1}
          className="rounded text-xl font-bold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Planning
        </h2>
        {empty !== "all" && (
          <nav aria-label="Affichage du planning" className="inline-flex rounded-xl border border-border bg-card p-0.5 text-sm">
            <ViewLink href={nav.listHref} current={view === "liste"}>
              Liste
            </ViewLink>
            <ViewLink href={nav.weekHref} current={view === "semaine"}>
              Semaine
            </ViewLink>
          </nav>
        )}
      </div>

      {empty === "all" ? (
        <EmptyState
          icon={CalendarDays}
          title={COPY.NO_SEANCE}
          action={
            shopHref ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={shopHref}>{COPY.SEE_SHOP}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            {nav.prevHref ? (
              <Button asChild variant="secondary" size="sm" className="flex-1 sm:flex-none">
                <Link href={nav.prevHref}>
                  <ChevronLeft aria-hidden />
                  Semaine précédente
                </Link>
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled className="flex-1 sm:flex-none">
                <ChevronLeft aria-hidden />
                Semaine précédente
              </Button>
            )}
            <p className="order-first w-full text-center text-sm font-semibold sm:order-none sm:w-auto sm:flex-1">{nav.title}</p>
            {nav.nextHref ? (
              <Button asChild variant="secondary" size="sm" className="flex-1 sm:flex-none">
                <Link href={nav.nextHref}>
                  Semaine suivante
                  <ChevronRight aria-hidden />
                </Link>
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled className="flex-1 sm:flex-none">
                Semaine suivante
                <ChevronRight aria-hidden />
              </Button>
            )}
          </div>

          {empty === "week" && (
            <Card className="space-y-2 px-5 py-6 text-center">
              <p className="text-sm font-medium">{COPY.NO_SEANCE_WEEK}</p>
              {nextWeekHref && (
                <p className="text-sm">
                  <Link href={nextWeekHref} className={INLINE_LINK_CLASS}>
                    {COPY.NEXT_SEANCE_WEEK}
                  </Link>
                </p>
              )}
            </Card>
          )}

          {withSeances.length > 0 && (
            <div className={cn("space-y-6", view === "semaine" && "sm:hidden")}>
              {withSeances.map((day) => (
                <section key={day.dayKey} aria-labelledby={`jour-${day.dayKey}`} className="space-y-2">
                  <h3 id={`jour-${day.dayKey}`} className="text-sm font-semibold text-zinc-700 first-letter:uppercase">
                    {day.label}
                  </h3>
                  <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                    {day.seances.map((vm) => (
                      <li key={vm.occurrenceId}>
                        <SeanceRow vm={vm} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {view === "semaine" && withSeances.length > 0 && (
            <div className="hidden grid-cols-7 items-start gap-2 sm:grid">
              {days.map((day) => (
                <section key={day.dayKey} aria-labelledby={`colonne-${day.dayKey}`} className="min-w-0 space-y-2">
                  <h3
                    id={`colonne-${day.dayKey}`}
                    className="rounded-lg bg-muted px-1.5 py-1.5 text-center text-xs font-semibold text-zinc-700 first-letter:uppercase"
                  >
                    {day.label}
                  </h3>
                  {day.seances.length > 0 && (
                    <ul className="space-y-2">
                      {day.seances.map((vm) => (
                        <li key={vm.occurrenceId}>
                          <SeanceChip vm={vm} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
