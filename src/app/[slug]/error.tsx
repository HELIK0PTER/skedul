"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The error state of the public pages of a pro (the espace keeps its own). Only the digest Next gives an error reaches
 * the console, never the error itself: a page error can carry what the page was reading.
 */
export default function PublicError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[public] page error", error.digest ?? "no digest");
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <Card role="alert" className="mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-12 text-center">
        <TriangleAlert className="size-8 text-zinc-600" aria-hidden />
        <h2 className="text-base font-semibold">Une erreur est survenue</h2>
        <p className="text-sm text-zinc-600">Cette page n&apos;a pas pu se charger. Réessayez dans un instant.</p>
        <Button onClick={() => unstable_retry()}>Réessayer</Button>
      </Card>
    </div>
  );
}
