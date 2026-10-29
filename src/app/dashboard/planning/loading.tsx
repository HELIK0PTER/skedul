import { Skeleton } from "@/components/dashboard/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Chargement…</span>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-8 w-40" />
      </div>
      <Skeleton className="mt-4 h-[32rem] w-full" />
    </div>
  );
}
