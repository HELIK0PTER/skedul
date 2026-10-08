"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  Activity,
  ArrowLeftRight,
  CreditCard,
  LayoutDashboard,
  LineChart,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/ui/logo";
import { SignOutButton } from "@/components/sign-out-button";
import { ENTRY_LABELS, type EntryChoice } from "@/lib/entry";
import { cn } from "@/lib/utils";
import { forgetEntryChoice } from "@/server/entry";

const NAV = [
  { href: "/admin", label: "Vue d'ensemble", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Utilisateurs", icon: Users },
  { href: "/admin/traffic", label: "Trafic", icon: LineChart },
  { href: "/admin/activity", label: "Activité", icon: Activity },
  { href: "/admin/subscriptions", label: "Abonnements", icon: CreditCard },
];

export function AdminSidebar({
  adminName,
  remembered,
}: {
  adminName: string;
  remembered: EntryChoice | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <aside className="sticky top-0 z-30 flex w-full shrink-0 flex-col border-b border-border bg-card md:h-screen md:w-64 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between p-4 md:block">
        <Link href="/admin" className="inline-flex items-center gap-2">
          <Logo />
          <Badge>Admin</Badge>
        </Link>
        <p className="mt-3 hidden truncate text-sm text-muted-foreground md:block">
          {adminName}
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
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="hidden gap-2 border-t border-border p-3 md:flex md:flex-col">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-primary hover:bg-accent"
        >
          <ArrowLeftRight className="size-4" />
          {ENTRY_LABELS.client}
        </Link>
        {remembered && (
          <div className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
            Choix mémorisé :{" "}
            <span className="font-medium text-foreground">
              {ENTRY_LABELS[remembered]}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await forgetEntryChoice();
                  router.refresh();
                })
              }
              className="mt-1 block font-medium text-primary hover:underline disabled:opacity-50"
            >
              Oublier mon choix
            </button>
          </div>
        )}
        <SignOutButton variant="ghost" size="sm" />
      </div>
    </aside>
  );
}
