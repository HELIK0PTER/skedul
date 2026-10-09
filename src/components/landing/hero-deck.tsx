"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { addDays, format } from "date-fns";
import { fr } from "date-fns/locale";
import { Check } from "lucide-react";

import {
  DEMO_BRAND,
  DEMO_PACK,
  DEMO_SERVICES,
  DEMO_SLOT_TIMES,
} from "@/components/demo/demo-data";
import { parseDayKey } from "@/lib/calendar-grid";
import { cn, formatMoney } from "@/lib/utils";
import styles from "./landing.module.css";

/**
 * Hero object: a deck of three product cards, dealt in a fixed order.
 * Stamp the carnet, pick a date, pick a slot: completing a card lets it
 * settle, then deals the next one. The order is fixed (not random) and the
 * dates derive from a day key computed on the server, so the first render
 * is deterministic and the hero paints before hydration. Every card shares
 * the same skeleton (one-line title and meta, a fixed-ratio body, a
 * fixed-height stub), so the deck never changes height.
 */

type CardId = "carnet" | "agenda" | "creneaux";

const ORDER: CardId[] = ["carnet", "agenda", "creneaux"];

const CAPTIONS: Record<CardId, string> = {
  carnet: "Cliquez sur une case : chaque séance réservée en tamponne une.",
  agenda: "Choisissez une date : les jours pointés sont libres.",
  creneaux: "Choisissez un créneau : les séances complètes sont barrées.",
};

const NAMES: Record<CardId, string> = {
  carnet: "le carnet",
  agenda: "l’agenda",
  creneaux: "les créneaux",
};

/** A completed card stays on screen this long before it leaves. */
const SETTLE_MS = 700;
/** Must match the .carnetOut animation in landing.module.css. */
const LEAVE_MS = 320;

export function HeroDeck({ todayKey }: { todayKey: string }) {
  const [index, setIndex] = useState(0);
  const [dealt, setDealt] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [announce, setAnnounce] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Keyboard users keep their focus in the deck when a new card is dealt.
  const keyboard = useRef(false);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const id = ORDER[index];

  function handleComplete() {
    const nextIndex = (index + 1) % ORDER.length;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const deal = () => {
      setLeaving(false);
      setIndex(nextIndex);
      setDealt((d) => d + 1);
      setAnnounce(`Carte suivante : ${NAMES[ORDER[nextIndex]]}.`);
    };
    if (reduce) {
      timers.current.push(setTimeout(deal, SETTLE_MS));
    } else {
      timers.current.push(
        setTimeout(() => setLeaving(true), SETTLE_MS),
        setTimeout(deal, SETTLE_MS + LEAVE_MS),
      );
    }
  }

  const cardProps: CardProps = {
    todayKey,
    onComplete: handleComplete,
    hint: dealt === 0,
    shell: { leaving, dealt: dealt > 0, keyboard },
  };

  return (
    <figure
      className="w-full"
      onKeyDown={() => {
        keyboard.current = true;
      }}
      onPointerDown={() => {
        keyboard.current = false;
      }}
    >
      <div className={styles.carnetStack}>
        <div aria-hidden className={styles.carnetBack} />
        {id === "carnet" && <CarnetCard key={dealt} {...cardProps} />}
        {id === "agenda" && <AgendaCard key={dealt} {...cardProps} />}
        {id === "creneaux" && <SlotsCard key={dealt} {...cardProps} />}
      </div>
      <figcaption className="mt-8 flex h-10 items-center justify-center text-center text-sm text-(--lp-ink-3)">
        {CAPTIONS[id]}
      </figcaption>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </figure>
  );
}

/* ------------------------------------------------------------ the shell */

interface ShellState {
  leaving: boolean;
  /** Dealt after the first card: enters without the page-load delay. */
  dealt: boolean;
  /** True while the visitor drives the deck with the keyboard. */
  keyboard: RefObject<boolean>;
}

interface CardProps {
  todayKey: string;
  onComplete: () => void;
  /** First card of the visit: show the one-time nudge. */
  hint: boolean;
  shell: ShellState;
}

function CardShell({
  label,
  title,
  meta,
  body,
  stubLabel,
  stubValue,
  status,
  shell: { leaving, dealt, keyboard },
}: {
  label: string;
  title: string;
  meta: string;
  body: ReactNode;
  stubLabel: string;
  stubValue: ReactNode;
  status: string;
  shell: ShellState;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // A freshly dealt card takes over keyboard focus, unless the visitor has
  // tabbed somewhere else in the meantime.
  useEffect(() => {
    if (!dealt || !keyboard.current) return;
    const active = document.activeElement;
    const elsewhere =
      active && active !== document.body && !ref.current?.parentElement?.contains(active);
    if (!elsewhere) {
      ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }
  }, [dealt, keyboard]);

  return (
    <div
      ref={ref}
      role="group"
      aria-label={`${title}, ${DEMO_BRAND.businessName}`}
      className={cn(
        styles.carnet,
        leaving ? styles.carnetOut : styles.carnetIn,
        dealt && styles.dealt,
      )}
    >
      <div className={styles.carnetTop}>
        <div className="flex items-baseline justify-between gap-4 font-mono text-[11px] uppercase tracking-[0.14em] text-(--lp-ink-3)">
          <span className="truncate">{DEMO_BRAND.businessName}</span>
          <span>{label}</span>
        </div>
        <p className="mt-4 truncate font-display text-2xl font-bold leading-none tracking-[-0.02em] sm:text-[1.875rem]">
          {title}
        </p>
        <p className="mt-2 truncate font-mono text-sm text-(--lp-ink-2)">
          {meta}
        </p>
        <div className="mt-6">{body}</div>
      </div>

      <div className={styles.carnetStub}>
        <p className="flex h-8 items-center justify-between gap-3 text-sm">
          <span className="text-(--lp-ink-2)">{stubLabel}</span>
          <span className="flex min-w-0 items-center gap-1.5 truncate font-semibold">
            {stubValue}
          </span>
        </p>
        <p aria-live="polite" className="sr-only">
          {status}
        </p>
      </div>
    </div>
  );
}

/** Every body shares this box: two rows in a fixed ratio, so cards match. */
const BODY = "grid aspect-[8/3] grid-rows-2";

function Done({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="truncate">{children}</span>
      <Check className="size-4 shrink-0 text-(--lp-accent)" strokeWidth={3} />
    </>
  );
}

function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m}` : `${h} h`;
}

/* ------------------------------------------------- card 1: the carnet */

const USED = 4;
const TILT = [-8, 5, -4, 7, -6, 3, -7, 6, -3, 8];
/** Pre-stamped cases land in turn, inside the card's entrance. */
const PRESTAMP_DELAY_MS = 420;
const PRESTAMP_STEP_MS = 70;

function CarnetCard({ onComplete, hint, shell }: CardProps) {
  const credits = DEMO_PACK.credits;
  const [stamped, setStamped] = useState(() =>
    Array.from({ length: credits }, (_, i) => i < USED),
  );
  const [touched, setTouched] = useState(false);
  const holeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const moveFocus = useRef(false);

  const remaining = stamped.filter((s) => !s).length;
  const firstFree = stamped.indexOf(false);
  const plural = remaining > 1 ? "s" : "";

  // A stamped case stops being a button: hand focus to the next free one.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    const next = stamped.indexOf(false);
    if (next !== -1) holeRefs.current[next]?.focus();
  }, [stamped]);

  function stamp(index: number) {
    if (stamped[index]) return;
    const next = stamped.map((s, i) => (i === index ? true : s));
    setTouched(true);
    moveFocus.current = true;
    setStamped(next);
    if (next.every(Boolean)) onComplete();
  }

  return (
    <CardShell
      shell={shell}
      label="Carnet"
      title={DEMO_PACK.name}
      meta={`${formatMoney(DEMO_PACK.priceCents)} · payé en ligne`}
      stubLabel="Solde"
      stubValue={
        remaining > 0 ? (
          <span className="font-mono tabular-nums">
            {remaining} crédit{plural} sur {credits}
          </span>
        ) : (
          <Done>Carnet terminé</Done>
        )
      }
      status={
        remaining > 0
          ? `${remaining} crédit${plural} restant${plural} sur ${credits}.`
          : "Carnet terminé."
      }
      body={
        <div className={cn(BODY, "grid-cols-5 gap-2.5")}>
          {stamped.map((isStamped, i) =>
            isStamped ? (
              <span
                key={i}
                aria-hidden
                className={cn(
                  styles.stamp,
                  styles.stampIn,
                  "h-full justify-self-center",
                )}
                style={
                  {
                    "--r": `${TILT[i % TILT.length]}deg`,
                    animationDelay:
                      i < USED
                        ? `${PRESTAMP_DELAY_MS + i * PRESTAMP_STEP_MS}ms`
                        : undefined,
                  } as CSSProperties
                }
              >
                <Check className="size-[40%]" strokeWidth={3} />
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
                  "h-full justify-self-center",
                  hint && !touched && i === firstFree && styles.hint,
                )}
              />
            ),
          )}
        </div>
      }
    />
  );
}

/* ------------------------------------------------- card 2: the agenda */

const STRIP_DAYS = 14;
/** Days (from today) the demo pro has free slots on. */
const FREE_OFFSETS = new Set([2, 3, 5, 7, 9, 10, 12]);

function AgendaCard({ onComplete, todayKey, shell }: CardProps) {
  const service = DEMO_SERVICES[0];
  const today = parseDayKey(todayKey);
  const days = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i));
  const [picked, setPicked] = useState<number | null>(null);

  function pick(index: number) {
    if (picked !== null) return;
    setPicked(index);
    onComplete();
  }

  const pickedLabel =
    picked === null ? null : format(days[picked], "EEEE d MMMM", { locale: fr });

  return (
    <CardShell
      shell={shell}
      label="Agenda"
      title={service.title}
      meta={`${durationLabel(service.durationMinutes)} · ${formatMoney(service.priceCents)} ou 1 crédit`}
      stubLabel="Date"
      stubValue={
        pickedLabel ? (
          <Done>{pickedLabel}</Done>
        ) : (
          <span className="font-normal text-(--lp-ink-2)">Aucune date choisie</span>
        )
      }
      status={pickedLabel ? `Date choisie : ${pickedLabel}.` : ""}
      body={
        <div className={cn(BODY, "grid-cols-7 gap-1.5")}>
          {days.map((day, i) => {
            const free = FREE_OFFSETS.has(i);
            const selected = picked === i;
            return (
              <button
                key={i}
                type="button"
                disabled={!free}
                onClick={() => pick(i)}
                aria-label={`${format(day, "EEEE d MMMM", { locale: fr })}${free ? "" : ", complet"}`}
                aria-pressed={free ? selected : undefined}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl text-sm leading-none transition-[background-color,border-color,color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--lp-focus)",
                  !free && "cursor-not-allowed text-(--lp-ink-3) opacity-55",
                  free &&
                    !selected &&
                    "cursor-pointer border border-(--lp-rule-2) hover:border-(--lp-accent) hover:bg-(--lp-accent-soft) active:bg-(--lp-accent-soft)",
                  selected && "bg-(--lp-accent) text-(--lp-on-accent)",
                )}
              >
                <span className="text-[10px] uppercase opacity-80">
                  {format(day, "EEEEE", { locale: fr })}
                </span>
                <span className="font-semibold tabular-nums">{day.getDate()}</span>
                <span
                  aria-hidden
                  className={cn(
                    "size-1 rounded-full",
                    free && !selected && "bg-(--lp-accent)",
                    selected && "bg-(--lp-on-accent)",
                  )}
                />
              </button>
            );
          })}
        </div>
      }
    />
  );
}

/* ------------------------------------------------ card 3: the slots */

const SLOTS_DAY_OFFSET = 2;
const FULL_SLOTS = new Set(["10:30", "16:30"]);

function SlotsCard({ onComplete, todayKey, shell }: CardProps) {
  const service = DEMO_SERVICES[1];
  const day = addDays(parseDayKey(todayKey), SLOTS_DAY_OFFSET);
  const [picked, setPicked] = useState<string | null>(null);

  function pick(time: string) {
    if (picked) return;
    setPicked(time);
    onComplete();
  }

  return (
    <CardShell
      shell={shell}
      label="Créneaux"
      title={service.title}
      meta={`${format(day, "EEE d MMM", { locale: fr })}, ${durationLabel(service.durationMinutes)} · ${formatMoney(service.priceCents)} ou 1 crédit`}
      stubLabel="Créneau"
      stubValue={
        picked ? (
          <Done>
            Réservé à <span className="font-mono tabular-nums">{picked}</span>
          </Done>
        ) : (
          <span className="font-normal text-(--lp-ink-2)">Aucun créneau choisi</span>
        )
      }
      status={picked ? `Créneau réservé à ${picked}.` : ""}
      body={
        <div className={cn(BODY, "grid-cols-3 gap-2.5")}>
          {DEMO_SLOT_TIMES.map((time) => {
            const full = FULL_SLOTS.has(time);
            const selected = picked === time;
            return (
              <button
                key={time}
                type="button"
                disabled={full}
                onClick={() => pick(time)}
                aria-label={full ? `${time}, complet` : time}
                aria-pressed={full ? undefined : selected}
                className={cn(
                  "flex items-center justify-center rounded-xl font-mono text-sm tabular-nums transition-[background-color,border-color,color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--lp-focus)",
                  full &&
                    "cursor-not-allowed border border-dashed border-(--lp-rule-2) text-(--lp-ink-3) line-through",
                  !full &&
                    !selected &&
                    "cursor-pointer border border-(--lp-rule-2) hover:border-(--lp-accent) hover:bg-(--lp-accent-soft) active:bg-(--lp-accent-soft)",
                  selected && "bg-(--lp-accent) font-semibold text-(--lp-on-accent)",
                )}
              >
                {time}
              </button>
            );
          })}
        </div>
      }
    />
  );
}
