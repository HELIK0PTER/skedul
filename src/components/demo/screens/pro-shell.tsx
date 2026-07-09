import type { ReactNode } from "react";
import {
  CalendarDays,
  CalendarRange,
  Clock,
  LayoutDashboard,
  Settings,
} from "lucide-react";

import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

const NAV = [
  { id: "overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { id: "planning", label: "Planning", icon: CalendarRange },
  { id: "event-types", label: "Prestations", icon: CalendarDays },
  { id: "availability", label: "Disponibilités", icon: Clock },
  { id: "settings", label: "Réglages", icon: Settings },
] as const;

export function ProShell({
  active,
  children,
}: {
  active: (typeof NAV)[number]["id"];
  children: ReactNode;
}) {
  return (
    <div className="flex h-full bg-background">
      <aside className="flex w-52 shrink-0 flex-col gap-1 border-r border-border bg-card p-3">
        <Logo className="mb-1 px-1" />
        <p className="mb-2 truncate px-1 text-xs text-muted-foreground">Altinha Paris</p>
        {NAV.map(({ id, label, icon: Icon }) => (
          <span
            key={id}
            className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium",
              id === active ? "bg-accent text-accent-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className="size-4" /> {label}
          </span>
        ))}
      </aside>
      <main className="flex-1 overflow-hidden px-6 py-5">{children}</main>
    </div>
  );
}
