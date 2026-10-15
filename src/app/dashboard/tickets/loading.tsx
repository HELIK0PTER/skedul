import { Skeleton } from "@/components/dashboard/skeleton";

/** Same silhouette as the page: header with its button, then a two-column grid of cards. */
export default function Loading() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Chargement…</span>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-10 w-56" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-60" />
        ))}
      </div>
    </div>
  );
}
