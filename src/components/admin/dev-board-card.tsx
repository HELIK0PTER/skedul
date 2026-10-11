"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { STAGE_LABELS, formatEta, type SupportStage } from "@/lib/support";
import { setSupportStage } from "@/server/support-admin";

type BoardCard = {
  id: string;
  number: number;
  subject: string;
  authorName: string;
  age: string;
  eta: string | null;
};

/** A kanban card; the arrows move the request one column back or forward. */
export function DevBoardCard({
  card,
  prev,
  next,
}: {
  card: BoardCard;
  prev: SupportStage | null;
  next: SupportStage | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function move(stage: SupportStage) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await setSupportStage({ id: card.id, stage });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.refresh();
      } catch {
        setError("Connexion perdue. Réessayez.");
      }
    });
  }

  return (
    <article className="rounded-xl border border-border bg-card p-3 shadow-(--shadow-card)">
      <Link
        href={`/admin/support/${card.id}`}
        className="block text-sm font-medium leading-snug transition-colors hover:text-primary"
      >
        {card.subject}
      </Link>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        #{card.number}, {card.authorName}
      </p>
      <p className="text-xs text-muted-foreground">{card.age}</p>
      {card.eta && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5" aria-hidden />
          {formatEta(card.eta)}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-2"
          disabled={!prev || pending}
          onClick={() => prev && move(prev)}
          aria-label={prev ? `Revenir à ${STAGE_LABELS[prev]}` : "Première colonne"}
        >
          <ArrowLeft />
        </Button>
        {next && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => move(next)}
            aria-label={`Passer à ${STAGE_LABELS[next]}`}
          >
            {STAGE_LABELS[next]}
            <ArrowRight />
          </Button>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </article>
  );
}
