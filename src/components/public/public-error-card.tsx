"use client";

import Link from "next/link";
import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const TEXT = "Cette page n'a pas pu se charger. Réessayez dans un instant.";
const HOME_LABEL = "Retour à l'accueil";

/**
 * The error card of the public boundaries and of the root ones (G4b): the root `error.tsx` (a failure in a layout,
 * the `[slug]` one included), `global-error.tsx`, `[slug]/error.tsx` and the espace's. It takes the digest Next gives an
 * error, never the error itself: only that digest reaches the console, since a page error can carry what the page was
 * reading. Alone on its page (the `[slug]` layouts render their children only), so its title is the page's h1.
 */
export function PublicErrorCard({
  scope,
  digest,
  onRetry,
  homeHref,
}: {
  scope: string;
  digest: string | undefined;
  onRetry: () => void;
  homeHref?: string;
}) {
  useEffect(() => {
    console.error(`[${scope}] page error`, digest ?? "no digest");
  }, [scope, digest]);

  return (
    <Card role="alert" className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 px-6 py-12 text-center">
      <TriangleAlert className="size-8 text-zinc-600" aria-hidden />
      <h1 className="text-base font-semibold">Une erreur est survenue</h1>
      <p className="text-sm text-zinc-600">{TEXT}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={onRetry}>Réessayer</Button>
        {homeHref && (
          <Button asChild variant="secondary">
            <Link href={homeHref}>{HOME_LABEL}</Link>
          </Button>
        )}
      </div>
    </Card>
  );
}
