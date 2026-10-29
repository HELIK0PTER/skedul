import { PageSkeleton } from "@/components/dashboard/skeleton";

/** The RDV page streams behind its own skeleton (P5 § 3.11); a notFound() behind it answers 200 with the 404's noindex metadata. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <PageSkeleton blocks={2} />
    </div>
  );
}
