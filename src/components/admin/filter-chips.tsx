import Link from "next/link";

import { cn } from "@/lib/utils";

/** A row of link "chips" for one search-param filter (no client JS). */
export function FilterChips<T extends string | number>({
  label,
  active,
  options,
}: {
  label: string;
  active: T;
  options: { value: T; label: string; href: string }[];
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const isActive = o.value === active;
        return (
          <Link
            key={String(o.value)}
            href={o.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}
