import Link from "next/link";
import { BookOpen, Inbox, SquareKanban } from "lucide-react";

import { cn } from "@/lib/utils";

const TABS = [
  { key: "inbox", href: "/admin/support", label: "Boîte de réception", icon: Inbox },
  { key: "board", href: "/admin/support/developpements", label: "Développements", icon: SquareKanban },
  { key: "faq", href: "/admin/support/faq", label: "FAQ", icon: BookOpen },
] as const;

export function SupportTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Support" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={cn(
            "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
            tab.key === active
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <tab.icon className="size-4" aria-hidden />
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
