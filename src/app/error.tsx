"use client";

import { PublicErrorCard } from "@/components/public/public-error-card";

/**
 * The error state of every page under the root layout that has no boundary of its own, and of the layouts below it (a
 * segment's error.tsx does not wrap its own layout: a database failure in the `[slug]` layout lands here). French, like
 * the rest of the app; the card logs the digest only (G4b).
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-aurora px-5 py-10">
      <PublicErrorCard scope="app" digest={error.digest} onRetry={() => unstable_retry()} homeHref="/" />
    </div>
  );
}
