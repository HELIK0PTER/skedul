import { Skeleton } from "@/components/dashboard/skeleton";

/** Header with its back button, then the stacked cards of the page. */
export default function Loading() {
  return (
    <div aria-busy="true" className="max-w-3xl">
      <span className="sr-only">Chargement…</span>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="space-y-6">
        <Skeleton className="h-64" />
        <Skeleton className="h-72" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
