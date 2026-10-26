import { PageSkeleton } from "@/components/dashboard/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <PageSkeleton blocks={2} />
    </div>
  );
}
