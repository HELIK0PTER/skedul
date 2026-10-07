import Link from "next/link";
import { CalendarCheck, Store, Ticket, UserPlus } from "lucide-react";

import { timeAgo } from "@/lib/admin-metrics";
import type { ActivityEvent } from "@/server/admin-queries";

const ICONS = {
  signup: UserPlus,
  pro: Store,
  booking: CalendarCheck,
  purchase: Ticket,
} as const;

export function ActivityFeed({ events, now }: { events: ActivityEvent[]; now: Date }) {
  if (events.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Aucune activité pour le moment.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {events.map((e) => {
        const Icon = ICONS[e.kind];
        return (
          <li key={e.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary-muted text-accent-foreground">
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <Link
                href={`/admin/users/${e.userId}`}
                className="block truncate text-sm font-medium hover:underline"
              >
                {e.title}
              </Link>
              <p className="truncate text-xs text-muted-foreground">{e.detail}</p>
            </div>
            <time
              dateTime={e.at.toISOString()}
              className="shrink-0 text-xs text-muted-foreground"
            >
              {timeAgo(e.at, now)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
