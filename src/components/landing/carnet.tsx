"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import styles from "./landing.module.css";

/**
 * Hero object: the prepaid carnet as a real punch card. Each free case is a
 * button; stamping it stands for one session booked with one credit, and the
 * balance on the stub follows. Once the last case is stamped the carnet can
 * be reloaded, which deals a fresh card. The first render is deterministic
 * (no randomness, no dates) so the server paints the hero as-is.
 */

const TILT = [-8, 5, -4, 7, -6, 3, -7, 6, -3, 8];
/** Pre-stamped cases land in turn, inside the hero's single entrance. */
const PRESTAMP_DELAY_MS = 420;
const PRESTAMP_STEP_MS = 70;

interface CarnetProps {
  business: string;
  packName: string;
  priceLabel: string;
  credits: number;
  used: number;
}

export function Carnet(props: CarnetProps) {
  const [round, setRound] = useState(0);

  return (
    <figure className="w-full">
      <div className={styles.carnetStack}>
        <div aria-hidden className={styles.carnetBack} />
        <CarnetCard
          key={round}
          {...props}
          reloaded={round > 0}
          onReload={() => setRound((r) => r + 1)}
        />
      </div>
      <figcaption className="mt-10 text-center text-sm text-(--lp-ink-3)">
        {"Cliquez sur une case : chaque séance réservée en tamponne une."}
      </figcaption>
    </figure>
  );
}

function CarnetCard({
  business,
  packName,
  priceLabel,
  credits,
  used,
  reloaded,
  onReload,
}: CarnetProps & { reloaded: boolean; onReload: () => void }) {
  const [stamped, setStamped] = useState(() =>
    Array.from({ length: credits }, (_, i) => i < used),
  );
  const [touched, setTouched] = useState(false);
  const holeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const reloadRef = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);

  const remaining = stamped.filter((s) => !s).length;
  const firstFree = stamped.indexOf(false);

  // A stamped case stops being a button, so keep keyboard focus in the
  // carnet: next free case, or the reload button once it is full.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    const next = stamped.indexOf(false);
    if (next === -1) reloadRef.current?.focus();
    else holeRefs.current[next]?.focus();
  }, [stamped]);

  // A reloaded carnet takes over focus from the button that dealt it.
  useEffect(() => {
    if (reloaded) holeRefs.current[used]?.focus();
  }, [reloaded, used]);

  function stamp(index: number) {
    setTouched(true);
    moveFocus.current = true;
    setStamped((prev) => prev.map((s, i) => (i === index ? true : s)));
  }

  const plural = remaining > 1 ? "s" : "";

  return (
    <div
      role="group"
      aria-label={`${packName}, ${business}`}
      className={cn(styles.carnet, styles.carnetIn)}
    >
      <div className={styles.carnetTop}>
        <div className="flex items-baseline justify-between gap-4 font-mono text-[11px] uppercase tracking-[0.14em] text-(--lp-ink-3)">
          <span className="truncate">{business}</span>
          <span>Carnet</span>
        </div>
        <p className="mt-4 font-display text-[1.875rem] font-bold leading-none tracking-[-0.02em]">
          {packName}
        </p>
        <p className="mt-2 font-mono text-sm text-(--lp-ink-2)">
          {priceLabel} · payé en ligne
        </p>

        <div className={cn(styles.holes, "mt-6")}>
          {stamped.map((isStamped, i) =>
            isStamped ? (
              <span
                key={i}
                aria-hidden
                className={cn(styles.stamp, styles.stampIn)}
                style={
                  {
                    "--r": `${TILT[i % TILT.length]}deg`,
                    animationDelay:
                      i < used
                        ? `${PRESTAMP_DELAY_MS + i * PRESTAMP_STEP_MS}ms`
                        : undefined,
                  } as CSSProperties
                }
              >
                <Check className="size-5" strokeWidth={3} />
              </span>
            ) : (
              <button
                key={i}
                ref={(el) => {
                  holeRefs.current[i] = el;
                }}
                type="button"
                onClick={() => stamp(i)}
                aria-label={`Tamponner la case ${i + 1}`}
                className={cn(
                  styles.hole,
                  !touched && !reloaded && i === firstFree && styles.hint,
                )}
              />
            ),
          )}
        </div>
      </div>

      {/* Both stub states share one fixed row height (the reload button's),
          so finishing the carnet never makes the card grow. */}
      <div className={styles.carnetStub}>
        {remaining > 0 ? (
          <p className="flex h-8 items-center justify-between gap-3 text-sm">
            <span className="text-(--lp-ink-2)">Solde</span>
            <span className="font-mono font-semibold tabular-nums">
              {remaining} crédit{plural} sur {credits}
            </span>
          </p>
        ) : (
          <div className="flex h-8 items-center justify-between gap-3">
            <p className="text-sm font-semibold">Carnet terminé</p>
            <button
              ref={reloadRef}
              type="button"
              onClick={onReload}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full bg-(--lp-accent) px-3.5 text-xs font-semibold text-(--lp-on-accent) transition-[background-color,scale] duration-150 ease-(--lp-ease-out) hover:bg-(--lp-accent-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--lp-focus) motion-safe:active:scale-[0.97]"
            >
              <RotateCcw className="size-3.5" />
              Recharger le carnet
            </button>
          </div>
        )}
        <p aria-live="polite" className="sr-only">
          {remaining === 0
            ? "Carnet terminé. Rechargez-le pour continuer."
            : `${remaining} crédit${plural} restant${plural} sur ${credits}.`}
        </p>
      </div>
    </div>
  );
}
