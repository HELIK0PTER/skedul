import type { ReactNode } from "react";
import {
  CalendarDays,
  CalendarOff,
  CalendarRange,
  Clock,
  Euro,
  LayoutDashboard,
  LifeBuoy,
  Settings,
  Ticket,
  Users,
} from "lucide-react";

import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";
import { DEMO_BRAND } from "../demo-data";

/** The back-office sidebar, as the real one lists it (src/components/dashboard/sidebar.tsx). */
const NAV = [
  { id: "overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { id: "planning", label: "Planning", icon: CalendarRange },
  { id: "events", label: "Événements", icon: CalendarDays },
  { id: "clients", label: "Clients", icon: Users },
  { id: "payments", label: "Paiements", icon: Euro },
  { id: "tickets", label: "Tickets", icon: Ticket },
  { id: "availability", label: "Disponibilités", icon: Clock },
  { id: "unavailability", label: "Indisponibilités", icon: CalendarOff },
  { id: "settings", label: "Réglages", icon: Settings },
  { id: "help", label: "Centre d'aide", icon: LifeBuoy },
] as const;

export type ProSection = (typeof NAV)[number]["id"];

/** The pro side of the tour: the sidebar, then the page. `overlay` draws over the whole frame (a dialog). */
export function ProShell({ active, children, overlay }: { active: ProSection; children: ReactNode; overlay?: ReactNode }) {
  return (
    <div className="relative flex h-full bg-background">
      <aside className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-border bg-card p-3">
        <Logo className="mb-1 px-1" />
        <p className="mb-2 truncate px-1 text-xs text-muted-foreground">{DEMO_BRAND.businessName}</p>
        {NAV.map(({ id, label, icon: Icon }) => (
          <span
            key={id}
            className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium",
              id === active ? "bg-accent text-accent-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className="size-4" /> {label}
          </span>
        ))}
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden px-6 py-5">{children}</main>
      {overlay}
    </div>
  );
}

/** The heading of a back-office page: its title, its one-line description, and an optional action on the right. */
export function ProPageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
