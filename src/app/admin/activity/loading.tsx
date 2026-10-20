import { TableSkeleton } from "@/components/dashboard/skeleton";
import { PageHeader } from "@/components/dashboard/page-header";

export default function Loading() {
  return (
    <>
      <PageHeader title="Activité" />
      <TableSkeleton rows={8} />
    </>
  );
}
