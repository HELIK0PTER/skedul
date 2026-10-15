import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-muted", className)} />;
}

/** Loading state of a page: a title block and `blocks` cards. */
export function PageSkeleton({ blocks = 3 }: { blocks?: number }) {
  return (
    <div aria-busy="true" className="space-y-6">
      <span className="sr-only">Chargement…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {Array.from({ length: blocks }, (_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-2xl" />
      ))}
    </div>
  );
}

/** Loading state of a list: `rows` table rows only, the page draws its own header above. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="space-y-2">
      <span className="sr-only">Chargement…</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
