"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  CalendarOff,
  CalendarRange,
  Clock,
  Euro,
  ExternalLink,
  LayoutDashboard,
  LifeBuoy,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";

import { Logo } from "@/components/ui/logo";
import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Vue d'ensemble", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/planning", label: "Planning", icon: CalendarRange },
  { href: "/dashboard/clients", label: "Clients", icon: Users },
  { href: "/dashboard/payments", label: "Paiements", icon: Euro },
  { href: "/dashboard/event-types", label: "Prestations", icon: CalendarDays },
  { href: "/dashboard/availability", label: "Disponibilités", icon: Clock },
  { href: "/dashboard/unavailability", label: "Indisponibilités", icon: CalendarOff },
  { href: "/dashboard/settings", label: "Réglages", icon: Settings },
  { href: "/aide", label: "Centre d’aide", icon: LifeBuoy },
];

export function DashboardSidebar({
  businessName,
  slug,
  isAdmin = false,
  supportUnread = false,
}: {
  businessName: string;
  slug: string;
  isAdmin?: boolean;
  supportUnread?: boolean;
}) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 z-30 flex w-full shrink-0 flex-col border-b border-border bg-card md:h-screen md:w-64 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between p-4 md:block">
        <Link href="/dashboard">
          <Logo />
        </Link>
        <p className="mt-3 hidden truncate text-sm text-muted-foreground md:block">
          {businessName}
        </p>
      </div>

      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:overflow-visible md:px-3">
        {NAV.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="size-4" />
              <span className="flex-1">{item.label}</span>
              {item.href === "/aide" && supportUnread && (
                <span className="rounded-full bg-primary px-1.5 py-px text-[0.625rem] font-semibold text-primary-foreground">
                  Nouveau
                  <span className="sr-only"> : une réponse vous attend</span>
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="hidden gap-2 border-t border-border p-3 md:flex md:flex-col">
        {isAdmin && (
          <Link
            href="/admin"
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-primary hover:bg-accent"
          >
            <ShieldCheck className="size-4" />
            Dashboard Admin
          </Link>
        )}
        <Link
          href={`/${slug}`}
          target="_blank"
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-primary hover:bg-accent"
        >
          <ExternalLink className="size-4" />
          Voir ma page publique
        </Link>
        <SignOutButton variant="ghost" size="sm" />
      </div>
    </aside>
  );
}
