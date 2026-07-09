"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Scissors } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The cinema-ticket CTA, built as two stacked pieces that read as one
 * ticket until cut. The dashed perforation between them is the tear line:
 * scissors sit at its left end (nudging sideways until touched) and cut as
 * you drag them across. Past the threshold the top piece lifts and leans
 * right like torn paper — pure transform, so the page layout never grows —
 * and uncovers the demo button that was sitting behind it, just above the
 * perforation. Released early, the cut heals. Keyboard: Enter/Space on the
 * scissors cuts.
 */

const TEAR_THRESHOLD = 0.8;
/* Horizontal padding so the scissors start inside the ticket's rounded corner. */
const EDGE_PX = 28;
/* How far the top piece lifts once torn. The opening this creates runs from
   the perforation up to (perforation - LIFT_PX); the button is centered in
   that span, so its offset must derive from the same constant. */
const LIFT_PX = 80;
/* Matches Button's default size (h-10). */
const REVEALED_BUTTON_HEIGHT_PX = 40;
/* The lift rotates around the piece's bottom-left corner, so at the
   horizontal center (where the button sits) the piece rises a bit less
   than LIFT_PX — this trims the naive midpoint to match the real opening. */
const TILT_COMPENSATION_PX = 7;
const REVEALED_BUTTON_BOTTOM_PX =
  LIFT_PX / 2 - REVEALED_BUTTON_HEIGHT_PX / 2 - TILT_COMPENSATION_PX;

export function TicketCta() {
  const rootRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [torn, setTorn] = useState(false);
  const [touched, setTouched] = useState(false);

  // The shared Slot primitive drops refs placed on Button children, so the
  // revealed link is focused by query instead of by ref.
  useEffect(() => {
    if (torn) rootRef.current?.querySelector("a")?.focus();
  }, [torn]);

  function moveTo(clientX: number) {
    const rect = lineRef.current?.getBoundingClientRect();
    if (!rect) return;
    const usable = rect.width - EDGE_PX * 2;
    setProgress(Math.min(1, Math.max(0, (clientX - rect.left - EDGE_PX) / usable)));
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (torn) return;
    setTouched(true);
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers (tests, some assistive tech) can lack a valid id.
    }
    moveTo(e.clientX);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (dragging && !torn) moveTo(e.clientX);
  }

  function endDrag() {
    if (!dragging) return;
    setDragging(false);
    if (progress >= TEAR_THRESHOLD) setTorn(true);
    else setProgress(0);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setProgress(1);
      setTorn(true);
    }
  }

  const handleLeft = `calc(${EDGE_PX}px + ${progress} * (100% - ${EDGE_PX * 2}px))`;

  return (
    <div ref={rootRef} className="relative">
      {/* Morceau du haut : se soulève en penchant à droite une fois découpé */}
      <div
        className={cn(
          "torn-edge-bottom relative z-10 rounded-t-3xl bg-ink p-10 text-ink-foreground md:p-14",
          !dragging &&
            "motion-safe:transition-[transform,filter] motion-safe:duration-500",
          torn &&
            "pointer-events-none [filter:drop-shadow(0_14px_20px_rgba(23,15,56,0.35))]",
        )}
        style={{
          transformOrigin: "bottom left",
          transform: torn
            ? `translateY(-${LIFT_PX}px) rotate(1.5deg)`
            : `rotate(${progress * 0.8}deg)`,
        }}
      >
        <p className="font-mono text-xs uppercase tracking-widest text-ink-foreground/60">
          Admission générale — sans engagement
        </p>
        <h2 className="mt-4 max-w-lg text-balance font-display text-3xl font-bold sm:text-4xl">
          Votre page de réservation, prête ce soir.
        </h2>
        <p className="mt-4 max-w-md text-ink-foreground/70">
          Créez votre page, ajoutez un carnet, partagez le lien. Vos règles,
          vos prix.
        </p>
      </div>

      {/* La perforation : ligne de découpe, encoches, ciseaux, et le bouton
          démo caché derrière le morceau du haut */}
      <div ref={lineRef} className="relative">
        <div
          aria-hidden={!torn}
          className="absolute inset-x-0 z-0 flex justify-center"
          style={{ bottom: REVEALED_BUTTON_BOTTOM_PX }}
        >
          <Button asChild className={cn(!torn && "pointer-events-none")}>
            <Link href="/demo" tabIndex={torn ? undefined : -1}>
              Voir la démo
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
        <div
          className={cn(
            "border-t border-dashed border-ink-foreground/30",
            torn && "opacity-0",
          )}
        />
        {/* La partie déjà coupée : les pointillés s'effacent derrière les ciseaux */}
        <span
          aria-hidden
          className={cn(
            "absolute -top-0.5 left-0 h-1 bg-ink",
            !dragging && !torn && "motion-safe:transition-[width] motion-safe:duration-300",
            torn && "opacity-0",
          )}
          style={{ width: torn ? "100%" : `${progress * 100}%` }}
        />
        <span className="ticket-notch -left-4 top-0 z-10 -translate-y-1/2" aria-hidden />
        <span className="ticket-notch -right-4 top-0 z-10 -translate-y-1/2" aria-hidden />
        {!torn && (
          <button
            type="button"
            aria-label="Découper le ticket pour révéler la démo"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            className={cn(
              "absolute top-0 z-20 grid size-10 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none place-items-center rounded-full border border-ink-foreground/30 bg-ink text-ink-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              dragging && "cursor-grabbing",
              !touched && "tear-hint",
              !dragging && "motion-safe:transition-[left] motion-safe:duration-300",
            )}
            style={{ left: handleLeft }}
          >
            <Scissors className="size-4" />
          </button>
        )}
      </div>

      {/* Le talon : reste en place quand le haut se détache */}
      <div className="torn-edge-top relative flex flex-col gap-4 rounded-b-3xl bg-ink p-8 text-ink-foreground sm:flex-row sm:items-center sm:justify-between md:px-14">
        <p className="font-mono text-xs uppercase tracking-widest text-ink-foreground/60">
          Gratuit pour démarrer
        </p>
        <Button asChild size="lg" variant="secondary">
          <Link href="/sign-up">
            Créer ma page
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
