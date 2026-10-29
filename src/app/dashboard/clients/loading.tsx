import { PageHeader } from "@/components/dashboard/page-header";
import { TableSkeleton } from "@/components/dashboard/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeader title="Clients" />
      <TableSkeleton rows={6} />
    </>
  );
}
