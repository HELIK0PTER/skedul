import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * A row of link "chips" for one search-param filter (no client JS). With
 * `scrollable` the chips stay on ONE line that scrolls inside its own row below
 * 640 px (the page never scrolls sideways) and wrap from 640 px up.
 */
export function FilterChips<T extends string | number>({
  label,
  active,
  options,
  scrollable = false,
}: {
  label: string;
  active: T;
  options: { value: T; label: string; href: string }[];
  scrollable?: boolean;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex gap-1.5",
        // The row scrolls inside itself, so its padding (offset by the negative margin) leaves room for the focus ring of the chips.
        scrollable ? "-m-1 overflow-x-auto p-1 sm:m-0 sm:flex-wrap sm:overflow-visible sm:p-0" : "flex-wrap",
      )}
    >
      {options.map((o) => {
        const isActive = o.value === active;
        return (
          <Link
            key={String(o.value)}
            href={o.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              scrollable && "shrink-0 whitespace-nowrap",
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
