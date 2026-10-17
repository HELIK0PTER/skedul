import { Skeleton, TableSkeleton } from "@/components/dashboard/skeleton";

/** Same silhouette as the page: a title block, then `TableSkeleton` (rows only, it draws no header). */
export default function Loading() {
  return (
    <>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <TableSkeleton rows={5} />
    </>
  );
}
