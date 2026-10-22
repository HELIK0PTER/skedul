import { PageSkeleton } from "@/components/dashboard/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10">
      <PageSkeleton blocks={2} />
    </div>
  );
}
