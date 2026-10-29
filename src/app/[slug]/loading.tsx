import { PageSkeleton } from "@/components/dashboard/skeleton";

/** The loading state of every public page of a pro that has none of its own (the planning and the Boutique, the séance, the offer). */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <PageSkeleton blocks={3} />
    </div>
  );
}
