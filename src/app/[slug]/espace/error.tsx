"use client";

import { PublicErrorCard } from "@/components/public/public-error-card";

/** The error state of the espace (P3 Task 41): the public card, which logs the digest only (G4b). */
export default function EspaceError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <PublicErrorCard scope="espace" digest={error.digest} onRetry={() => unstable_retry()} />
    </div>
  );
}
