"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function Outro({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="rounded-3xl bg-ink px-8 py-14 text-center text-ink-foreground shadow-(--shadow-card)">
      <p className="font-mono text-[11px] uppercase tracking-widest text-ink-foreground/70">
        Fin de la visite — à vous de jouer
      </p>
      <h2 className="mx-auto mt-3 max-w-md font-display text-3xl font-bold tracking-tight">
        Votre page de réservation, prête ce soir.
      </h2>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg" variant="secondary">
          <Link href="/sign-up">
            Créer ma page gratuitement <ArrowRight />
          </Link>
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="text-ink-foreground hover:bg-white/10 hover:text-ink-foreground"
          onClick={onRestart}
        >
          Revoir la démo
        </Button>
      </div>
      <p className="mt-6 text-xs text-ink-foreground/60">
        Envie de voir une vraie page ?{" "}
        <Link
          href="/altinha-paris"
          className="underline underline-offset-4 hover:text-ink-foreground"
        >
          altinha-paris
        </Link>
      </p>
    </div>
  );
}
