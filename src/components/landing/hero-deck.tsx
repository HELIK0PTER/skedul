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

import { DEMO_BRAND, demoEvent, ticketType, type DemoOffer } from "@/components/demo/demo-data";
import { parseDayKey } from "@/lib/calendar-grid";
import { cn, formatMoney } from "@/lib/utils";
import styles from "./landing.module.css";

/*
 * The hero's sample data is the guided tour's catalog (demo-data.ts, itself pinned to the real Altinha Paris one in
 * scripts/content/altinha.ts): the Carnet de 10 of Cours collectif, the Altinha débutants séances, and a Cours
 * particulier booked as a rendez-vous in the pro's hours.
 */
const COLLECTIF = ticketType("collectif");
const PARTICULIER = ticketType("particulier");
const SEANCES = demoEvent("debutants");

function offerOf(offers: readonly DemoOffer[], quantity: number): DemoOffer {
  const found = offers.find((o) => o.quantity === quantity);
  if (!found) throw new Error(`the hero offer of ${quantity} is missing`);
  return found;
}

/** The carnet of card 1, and the single tickets that price a séance (card 2) and a rendez-vous (card 3). */
const CARNET = offerOf(COLLECTIF.offers, 10);
const SEANCE_PRICE_CENTS = offerOf(COLLECTIF.offers, 1).priceCents;
const RDV_PRICE_CENTS = offerOf(PARTICULIER.offers, 1).priceCents;
const RDV_MINUTES = PARTICULIER.rdv?.durationMin ?? 60;
/** One-hour starts inside the pro's hours (Monday to Saturday, 10:00 to 13:00 and 17:30 to 20:30). */
const RDV_TIMES = ["10:00", "11:00", "12:00", "17:30", "18:30", "19:30"];

/**
 * Hero object: a deck of three product cards, dealt in a fixed order.
 * Use the tickets of a carnet, pick the date of a séance, pick the time of a
 * rendez-vous: completing a card lets it settle, then deals the next one. The
 * order is fixed (not random) and the dates derive from a day key computed on
 * the server, so the first render is deterministic and the hero paints before
 * hydration. Every card shares the same skeleton (one-line title and meta, a
 * fixed-ratio body, a fixed-height stub), so the deck never changes height.
 */

type CardId = "carnet" | "agenda" | "creneaux";

const ORDER: CardId[] = ["carnet", "agenda", "creneaux"];

const CAPTIONS: Record<CardId, string> = {
  carnet: "Cliquez sur une case : chaque séance réservée utilise un ticket.",
  agenda: "Choisissez une date : les jours pointés ont une séance.",
  creneaux: "Choisissez une heure : les heures barrées sont déjà prises.",
};

const NAMES: Record<CardId, string> = {
  carnet: "le carnet",
  agenda: "les séances",
  creneaux: "le rendez-vous",
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
        {id === "creneaux" && <RdvCard key={dealt} {...cardProps} />}
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

function ticketsLabel(count: number): string {
  return `${count} ticket${count > 1 ? "s" : ""}`;
}

/* ------------------------------------------------- card 1: the carnet */

/** Tickets of the carnet already used when the card is dealt. */
const USED = 4;
const TILT = [-8, 5, -4, 7, -6, 3, -7, 6, -3, 8];
/** Pre-stamped cases land in turn, inside the card's entrance. */
const PRESTAMP_DELAY_MS = 420;
const PRESTAMP_STEP_MS = 70;

function CarnetCard({ onComplete, hint, shell }: CardProps) {
  const total = CARNET.quantity;
  const [stamped, setStamped] = useState(() =>
    Array.from({ length: total }, (_, i) => i < USED),
  );
  const [touched, setTouched] = useState(false);
  const holeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const moveFocus = useRef(false);

  const remaining = stamped.filter((s) => !s).length;
  const firstFree = stamped.indexOf(false);

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
      title={CARNET.label}
      meta={`${COLLECTIF.name} · ${formatMoney(CARNET.priceCents)}`}
      stubLabel="Reste"
      stubValue={
        remaining > 0 ? (
          <span className="font-mono tabular-nums">
            {ticketsLabel(remaining)} sur {total}
          </span>
        ) : (
          <Done>Carnet terminé</Done>
        )
      }
      status={
        remaining > 0
          ? `${ticketsLabel(remaining)} restant${remaining > 1 ? "s" : ""} sur ${total}.`
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
                aria-label={`Utiliser le ticket ${i + 1}`}
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

/* ------------------------------------------------- card 2: the séances */

const STRIP_DAYS = 14;
/** The event's days, as JavaScript weekdays (0 = Sunday); the event counts from Monday (0 = Monday). */
const SEANCE_WEEKDAYS = new Set(SEANCES.days.map((d) => (d + 1) % 7));
const SEANCE_TIME = `${String(Math.floor(SEANCES.startMinute / 60)).padStart(2, "0")}:${String(SEANCES.startMinute % 60).padStart(2, "0")}`;

function AgendaCard({ onComplete, todayKey, shell }: CardProps) {
  const today = parseDayKey(todayKey);
  const days = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i));
  const [picked, setPicked] = useState<number | null>(null);

  function pick(index: number) {
    if (picked !== null) return;
    setPicked(index);
    onComplete();
  }

  const pickedLabel =
    picked === null
      ? null
      : `${format(days[picked], "EEEE d MMMM", { locale: fr })}, ${SEANCE_TIME}`;

  return (
    <CardShell
      shell={shell}
      label="Séances"
      title={SEANCES.title}
      meta={`${durationLabel(SEANCES.durationMin)} · 1 ticket ou ${formatMoney(SEANCE_PRICE_CENTS)}`}
      stubLabel="Séance"
      stubValue={
        pickedLabel ? (
          <Done>{pickedLabel}</Done>
        ) : (
          <span className="font-normal text-(--lp-ink-2)">Aucune séance choisie</span>
        )
      }
      status={pickedLabel ? `Séance choisie : ${pickedLabel}.` : ""}
      body={
        <div className={cn(BODY, "grid-cols-7 gap-1.5")}>
          {days.map((day, i) => {
            const open = SEANCE_WEEKDAYS.has(day.getDay());
            const selected = picked === i;
            return (
              <button
                key={i}
                type="button"
                disabled={!open}
                onClick={() => pick(i)}
                aria-label={`${format(day, "EEEE d MMMM", { locale: fr })}${open ? `, séance à ${SEANCE_TIME}` : ", aucune séance"}`}
                aria-pressed={open ? selected : undefined}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl text-sm leading-none transition-[background-color,border-color,color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--lp-focus)",
                  !open && "cursor-not-allowed text-(--lp-ink-3) opacity-55",
                  open &&
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
                    open && !selected && "bg-(--lp-accent)",
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

/* ------------------------------------------------ card 3: the rendez-vous */

/** The rendez-vous is two days ahead, moved to Monday when that is a Sunday (the pro's hours run Monday to Saturday). */
const RDV_DAY_OFFSET = 2;
const TAKEN_TIMES = new Set(["11:00", "18:30"]);

function RdvCard({ onComplete, todayKey, shell }: CardProps) {
  const ahead = addDays(parseDayKey(todayKey), RDV_DAY_OFFSET);
  const day = ahead.getDay() === 0 ? addDays(ahead, 1) : ahead;
  const [picked, setPicked] = useState<string | null>(null);

  function pick(time: string) {
    if (picked) return;
    setPicked(time);
    onComplete();
  }

  return (
    <CardShell
      shell={shell}
      label="Rendez-vous"
      title={PARTICULIER.name}
      meta={`${format(day, "EEE d MMM", { locale: fr })}, ${durationLabel(RDV_MINUTES)} · 1 ticket ou ${formatMoney(RDV_PRICE_CENTS)}`}
      stubLabel="Heure"
      stubValue={
        picked ? (
          <Done>
            Réservé à <span className="font-mono tabular-nums">{picked}</span>
          </Done>
        ) : (
          <span className="font-normal text-(--lp-ink-2)">Aucune heure choisie</span>
        )
      }
      status={picked ? `Rendez-vous réservé à ${picked}.` : ""}
      body={
        <div className={cn(BODY, "grid-cols-3 gap-2.5")}>
          {RDV_TIMES.map((time) => {
            const taken = TAKEN_TIMES.has(time);
            const selected = picked === time;
            return (
              <button
                key={time}
                type="button"
                disabled={taken}
                onClick={() => pick(time)}
                aria-label={taken ? `${time}, déjà pris` : time}
                aria-pressed={taken ? undefined : selected}
                className={cn(
                  "flex items-center justify-center rounded-xl font-mono text-sm tabular-nums transition-[background-color,border-color,color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--lp-focus)",
                  taken &&
                    "cursor-not-allowed border border-dashed border-(--lp-rule-2) text-(--lp-ink-3) line-through",
                  !taken &&
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
