"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const TEXT = "Cette page n'a pas pu se charger. Réessayez dans un instant.";

export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card role="alert" className="mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-12 text-center">
      <TriangleAlert className="size-8 text-muted-foreground" aria-hidden />
      <h2 className="text-base font-semibold">Une erreur est survenue</h2>
      <p className="text-sm text-muted-foreground">{TEXT}</p>
      <Button onClick={() => unstable_retry()}>Réessayer</Button>
    </Card>
  );
}
