"use client";

import Link from "next/link";
import { ArrowRight, Check, ChevronLeft, Pause, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DemoStep } from "./demo-script";

const CHAPTER_LABELS = {
  client: "Côté client",
  pro: "Côté pro",
  outro: "Et maintenant ?",
} as const;

interface TourControlsProps {
  steps: DemoStep[];
  index: number;
  playing: boolean;
  onPrev: () => void;
  onNext: () => void;
  onJump: (i: number) => void;
  onTogglePlay: () => void;
}

export function TourControls({
  steps,
  index,
  playing,
  onPrev,
  onNext,
  onJump,
  onTogglePlay,
}: TourControlsProps) {
  const step = steps[index];
  const isLast = index === steps.length - 1;

  return (
    <div className="relative rounded-2xl border border-dashed border-border bg-card p-5 shadow-(--shadow-card)">
      {/* aria-live englobe le chapitre + numéro d'étape en plus du titre/description,
          pour que le changement d'étape soit annoncé en entier aux lecteurs d'écran. */}
      <div aria-live="polite">
        <p className="font-mono text-[11px] uppercase tracking-widest text-primary">
          {CHAPTER_LABELS[step.chapter]} · étape {index + 1}/{steps.length}
        </p>
        <h2 className="mt-1 font-display text-xl font-bold tracking-tight">{step.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
      </div>

      {/* Carnet à tampons : une case par étape, tamponnée quand elle est franchie. */}
      <div className="mt-4 flex flex-wrap gap-1.5 border-t border-dashed border-border pt-4">
        {steps.map((s, i) => (
          <button
            key={s.id}
            type="button"
            aria-label={`Étape ${i + 1} : ${s.title}`}
            aria-current={i === index ? "step" : undefined}
            onClick={() => onJump(i)}
            className={cn(
              "grid size-7 cursor-pointer place-items-center rounded-full border text-[10px] font-medium transition-colors",
              i < index && "stamp border-transparent bg-stamp text-white",
              i === index && "border-primary font-semibold text-primary ring-2 ring-ring/40",
              i > index && "border-dashed border-border text-muted-foreground hover:border-primary",
            )}
          >
            {i < index ? <Check className="size-3.5" /> : i + 1}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onPrev} disabled={index === 0}>
          <ChevronLeft /> Précédent
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onTogglePlay}
          disabled={isLast}
          aria-label={playing ? "Mettre en pause" : "Lecture automatique"}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <span className="flex-1" />
        {isLast ? (
          <Button asChild>
            <Link href="/sign-up">
              Créer ma page <ArrowRight />
            </Link>
          </Button>
        ) : (
          <Button onClick={onNext}>
            Suivant <ArrowRight />
          </Button>
        )}
      </div>
    </div>
  );
}
