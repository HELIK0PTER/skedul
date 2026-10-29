import { Skeleton, TableSkeleton } from "@/components/dashboard/skeleton";

export default function Loading() {
  return (
    <div>
      <Skeleton className="mb-6 h-14 w-72 max-w-full" />
      <Skeleton className="mb-6 h-28 w-full" />
      <TableSkeleton rows={6} />
    </div>
  );
}
