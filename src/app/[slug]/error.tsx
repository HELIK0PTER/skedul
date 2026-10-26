"use client";

import { PublicErrorCard } from "@/components/public/public-error-card";

/**
 * The error state of the public pages of a pro. It does not wrap the `[slug]` layout above it (a failure there is the
 * root `error.tsx`'s). The card logs the digest Next gives an error, never the error itself: a page error can carry
 * what the page was reading.
 */
export default function PublicError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <PublicErrorCard scope="public" digest={error.digest} onRetry={() => unstable_retry()} />
    </div>
  );
}
