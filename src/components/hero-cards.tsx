"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import { fr } from "date-fns/locale";
import { Check, Pointer } from "lucide-react";

import { DayCalendar } from "@/components/public/day-calendar";
import { parseDayKey, toDayKey } from "@/lib/calendar-grid";
import { cn } from "@/lib/utils";

/**
 * Interactive hero: a deck of three product-shaped mini cards. Each card has
 * its own way of being "completed" (stamp every credit, pick a date, pick a
 * slot); completing one flips to another card picked at random. The first
 * card is random too — picked on mount so SSR stays deterministic.
 */

type CardId = "carnet" | "calendar" | "slots";

const CARD_IDS: CardId[] = ["carnet", "calendar", "slots"];

const HINTS: Record<CardId, string> = {
  carnet: "Tamponnez les cases restantes",
  calendar: "Choisissez une date disponible",
  slots: "Choisissez un créneau",
};

function randomOf<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/* Doigt flottant qui indique un bouton précis, à l'endroit (non retourné) —
   son extrémité (pas le centre de l'icône) est ancrée exactement sur la
   cible, comme un vrai curseur qui repose sur ce qu'il pointe. Un petit
   mouvement de tap ; n'apparaît que sur la toute première card (avant toute
   interaction), jamais sur les cards suivantes du paquet. */
function TapHint({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <Pointer
      aria-hidden
      className={cn(
        "tap-hint pointer-events-none absolute z-20 size-6 text-primary drop-shadow-[0_2px_3px_rgba(24,24,27,0.25)]",
        className,
      )}
      style={style}
      strokeWidth={2}
      fill="currentColor"
    />
  );
}

/* --- Carte 1 : le carnet à tamponner ------------------------------------ */

const CREDITS = 10;
const PRE_STAMPED = 4;
const STAMP_TILT = [-8, 5, -4, 7, -6, 3, -7, 6, -3, 8];

function CarnetCard({
  onComplete,
  hint,
}: {
  onComplete: () => void;
  hint: boolean;
}) {
  const [stamped, setStamped] = useState(() =>
    Array.from({ length: CREDITS }, (_, i) => i < PRE_STAMPED),
  );
  const remaining = stamped.filter((s) => !s).length;
  const untouched = remaining === CREDITS - PRE_STAMPED;

  function stamp(i: number) {
    if (stamped[i]) return;
    const next = stamped.map((s, j) => (j === i ? true : s));
    setStamped(next);
    if (next.every(Boolean)) onComplete();
  }

  return (
    <>
      <div className="flex items-baseline justify-between font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        <span>Carnet nº 0042</span>
        <span>Altinha Paris</span>
      </div>
      <p className="mt-3 font-display text-3xl font-bold tracking-tight">
        Pack 10 heures
      </p>
      <p className="mt-1 font-mono text-sm text-muted-foreground">
        240 € — payé le 12/06
      </p>

      <div className="mt-6 grid grid-cols-5 gap-2.5">
        {stamped.map((isStamped, i) =>
          isStamped ? (
            <span
              key={i}
              className="stamp grid aspect-square place-items-center rounded-full bg-stamp/90 text-white"
              style={
                {
                  "--r": `${STAMP_TILT[i]}deg`,
                  animationDelay: i < PRE_STAMPED ? `${0.3 + i * 0.15}s` : "0s",
                } as React.CSSProperties
              }
              aria-hidden
            >
              <Check className="size-4" strokeWidth={3} />
            </span>
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => stamp(i)}
              aria-label={`Tamponner l'heure ${i + 1}`}
              className="relative aspect-square cursor-pointer rounded-full border-2 border-dashed border-border transition-colors hover:border-stamp/60 hover:bg-stamp/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {hint && untouched && i === PRE_STAMPED && (
                <TapHint className="left-3/4 top-3/4" />
              )}
            </button>
          ),
        )}
      </div>

      <div className="mt-6 flex items-baseline justify-between border-t border-dashed border-border pt-4 font-mono text-sm">
        {remaining > 0 ? (
          <>
            <span className="text-muted-foreground">Solde</span>
            <span className="font-semibold">
              {remaining} crédit{remaining > 1 ? "s" : ""}
            </span>
          </>
        ) : (
          <span className="mx-auto font-semibold text-stamp">
            Carnet complet ✓
          </span>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {remaining === 0
          ? "Carnet complet"
          : `${remaining} crédits restants sur ${CREDITS}`}
      </p>
    </>
  );
}

/* --- Carte 2 : le calendrier -------------------------------------------- */

function CalendarCard({
  onComplete,
  hint,
}: {
  onComplete: () => void;
  hint: boolean;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // A handful of "free" days spread over the coming weeks.
  const [availableKeys] = useState(() =>
    [2, 4, 7, 9, 14, 16, 21, 23].map((d) => toDayKey(addDays(new Date(), d))),
  );

  // DayCalendar is a shared component (also used in the real booking flow),
  // so its day buttons aren't ours to annotate directly — measure the first
  // available one instead and float the hint over it.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<{ left: number; top: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!hint || selectedKey) return;
    const wrap = wrapRef.current;
    const day = wrap?.querySelector<HTMLButtonElement>(
      ".grid-cols-7 button:not([disabled])",
    );
    if (!wrap || !day) return;
    const wrapRect = wrap.getBoundingClientRect();
    const dayRect = day.getBoundingClientRect();
    setTarget({
      left: dayRect.left - wrapRect.left + dayRect.width * 0.75,
      top: dayRect.top - wrapRect.top + dayRect.height * 0.75,
    });
  }, [hint, selectedKey]);

  return (
    <>
      <div className="flex items-baseline justify-between font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        <span>Agenda</span>
        <span>Altinha Paris</span>
      </div>
      <div ref={wrapRef} className="relative mt-4">
        {hint && !selectedKey && target && (
          <TapHint style={{ left: target.left, top: target.top }} />
        )}
        <DayCalendar
          availableKeys={availableKeys}
          selectedKey={selectedKey}
          onSelect={(key) => {
            if (selectedKey) return;
            setSelectedKey(key);
            onComplete();
          }}
        />
      </div>
      <div className="mt-4 border-t border-dashed border-border pt-4 text-center font-mono text-sm">
        {selectedKey ? (
          <span className="font-semibold text-primary">
            {format(parseDayKey(selectedKey), "EEEE d MMMM", { locale: fr })} ✓
          </span>
        ) : (
          <span className="text-muted-foreground">Aucune date choisie</span>
        )}
      </div>
    </>
  );
}

/* --- Carte 3 : le choix du créneau --------------------------------------- */

const SLOT_TIMES = ["09:00", "09:30", "10:00", "11:30", "14:00", "15:30"];
const SLOT_TAKEN = new Set(["10:00", "14:00"]);
const FIRST_FREE_SLOT = SLOT_TIMES.find((t) => !SLOT_TAKEN.has(t));

function SlotsCard({
  onComplete,
  hint,
}: {
  onComplete: () => void;
  hint: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [dayLabel] = useState(() =>
    format(addDays(new Date(), 2), "EEEE d MMMM", { locale: fr }),
  );

  function pick(time: string) {
    if (selected) return;
    setSelected(time);
    onComplete();
  }

  return (
    <>
      <div className="flex items-baseline justify-between font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        <span>Créneaux</span>
        <span>Altinha Paris</span>
      </div>
      <p className="mt-3 font-display text-2xl font-bold capitalize tracking-tight">
        {dayLabel}
      </p>
      <p className="mt-1 font-mono text-sm text-muted-foreground">
        Cours collectif — 1 h · 25 € ou 1 crédit
      </p>

      <div className="mt-6 grid grid-cols-3 gap-2.5">
        {SLOT_TIMES.map((time) => {
          const taken = SLOT_TAKEN.has(time);
          const isSelected = selected === time;
          return (
            <button
              key={time}
              type="button"
              disabled={taken}
              onClick={() => pick(time)}
              className={cn(
                "relative rounded-xl border py-2.5 font-mono text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                taken &&
                  "cursor-not-allowed border-dashed border-border text-muted-foreground/50 line-through",
                !taken &&
                  !isSelected &&
                  "cursor-pointer border-border hover:border-primary hover:bg-accent",
                isSelected &&
                  "border-primary bg-primary font-semibold text-primary-foreground",
              )}
            >
              {hint && !selected && time === FIRST_FREE_SLOT && (
                <TapHint className="left-3/4 top-3/4" />
              )}
              {time}
            </button>
          );
        })}
      </div>

      <div className="mt-6 border-t border-dashed border-border pt-4 text-center font-mono text-sm">
        {selected ? (
          <span className="font-semibold text-primary">
            Réservé — {selected} ✓
          </span>
        ) : (
          <span className="text-muted-foreground">Aucun créneau choisi</span>
        )}
      </div>
    </>
  );
}

/* --- Le paquet de cartes -------------------------------------------------- */

const CARD_COMPONENTS: Record<
  CardId,
  React.ComponentType<{ onComplete: () => void; hint: boolean }>
> = {
  carnet: CarnetCard,
  calendar: CalendarCard,
  slots: SlotsCard,
};

export function HeroCards() {
  const [card, setCard] = useState<CardId | null>(null);
  const [generation, setGeneration] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    setCard(randomOf(CARD_IDS));
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  function handleComplete() {
    // Let the completed state land, flip out, then deal the next card.
    timers.current.push(
      setTimeout(() => setLeaving(true), 700),
      setTimeout(() => {
        setCard((c) => randomOf(CARD_IDS.filter((id) => id !== c)));
        setGeneration((g) => g + 1);
        setLeaving(false);
      }, 1100),
    );
  }

  const CardBody = card ? CARD_COMPONENTS[card] : null;

  return (
    <div className="mx-auto flex min-h-[440px] w-full max-w-sm flex-col justify-center">
      {card && CardBody && (
        <div key={`${card}-${generation}`}>
          <div
            className={cn(
              "carnet relative rounded-2xl border border-border bg-card p-6",
              leaving ? "card-out" : "card-in",
            )}
          >
            <CardBody onComplete={handleComplete} hint={generation === 0} />
          </div>
          <p className="mt-8 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {HINTS[card]}
          </p>
        </div>
      )}
    </div>
  );
}
