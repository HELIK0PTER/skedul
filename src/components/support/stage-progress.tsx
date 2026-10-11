import type { CSSProperties } from "react";
import { Check, Lock, X } from "lucide-react";

import {
  STAGE_LABELS,
  TRACK_STEPS,
  formatEta,
  statusLabel,
  stepIndex,
  type RequestState,
  type SupportStage,
} from "@/lib/support";
import { cn } from "@/lib/utils";

const DAY = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Paris",
});

type Props = RequestState & {
  /** When each step was reached (`stageReachedAt`); full size only. */
  reachedAt?: Partial<Record<SupportStage, Date>>;
  /** Estimated delivery (YYYY-MM-DD), development track only. */
  eta?: string | null;
  size?: "full" | "mini";
  className?: string;
};

/**
 * A request's progress: 3 steps (support) or 6 (development). A declined or
 * closed request keeps its bar where it stopped, greyed out.
 */
export function StageProgress({
  track,
  stage,
  resolution,
  reachedAt = {},
  eta = null,
  size = "full",
  className,
}: Props) {
  const steps = TRACK_STEPS[track];
  const current = stepIndex(track, stage);
  const last = steps.length - 1;
  const ended = resolution !== null;
  const label = statusLabel({ track, stage, resolution });

  if (size === "mini") {
    return (
      <div className={cn("min-w-0", className)}>
        <div className="flex gap-1" aria-hidden>
          {steps.map((s, i) => (
            <span
              key={s}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                i > current ? "bg-border" : ended ? "bg-muted-foreground/40" : "bg-primary",
              )}
            />
          ))}
        </div>
        <p className="mt-1.5 truncate text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{label}</span>
          {!ended && current < last && `, étape ${current + 1} sur ${steps.length}`}
        </p>
      </div>
    );
  }

  const fill = last > 0 ? (current / last) * 100 : 0;
  // the rail runs from the centre of the first column to the centre of the last
  const inset = `calc(100% / ${steps.length * 2})`;

  return (
    <section
      aria-label="Avancement de la demande"
      className={cn(
        "rounded-2xl border border-border bg-card p-5 shadow-(--shadow-card) sm:p-6",
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p
          className={cn(
            "flex items-center gap-2 font-display text-lg font-bold tracking-tight",
            ended && "text-muted-foreground",
          )}
        >
          {resolution === "declined" && <X className="size-4" aria-hidden />}
          {resolution === "closed" && <Lock className="size-4" aria-hidden />}
          {label}
        </p>
        {eta && !ended && track === "development" && current < last && (
          <p className="text-sm text-muted-foreground">
            Livraison estimée :{" "}
            <span className="font-medium text-foreground">{formatEta(eta)}</span>
          </p>
        )}
      </div>

      <div className="relative mt-6">
        <div
          aria-hidden
          className="absolute top-[11px] hidden h-0.5 rounded-full bg-border sm:block"
          style={{ left: inset, right: inset }}
        >
          <div
            className={cn(
              "h-full origin-left rounded-full motion-safe:animate-[progress-grow_900ms_cubic-bezier(0.16,1,0.3,1)_both]",
              ended ? "bg-muted-foreground/40" : "bg-primary",
            )}
            style={{ width: `${fill}%` }}
          />
        </div>
        <ol
          className="relative grid gap-3 sm:grid-cols-[repeat(var(--steps),minmax(0,1fr))] sm:gap-2"
          style={{ "--steps": steps.length } as CSSProperties}
        >
          {steps.map((s, i) => {
            const isCurrent = i === current;
            const complete = i < current || (isCurrent && i === last);
            const date = i <= current ? reachedAt[s] : undefined;
            return (
              <li
                key={s}
                aria-current={isCurrent ? "step" : undefined}
                className="flex items-center gap-3 sm:flex-col sm:gap-2 sm:text-center"
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border-2 bg-card",
                    complete
                      ? ended
                        ? "border-transparent bg-muted-foreground/40 text-white"
                        : "border-primary bg-primary text-primary-foreground"
                      : isCurrent
                        ? ended
                          ? "border-muted-foreground/40 text-muted-foreground"
                          : "border-primary text-primary"
                        : "border-border",
                  )}
                >
                  {complete ? (
                    <Check className="size-3.5" strokeWidth={3} aria-hidden />
                  ) : isCurrent && !ended ? (
                    <span className="size-2 rounded-full bg-primary motion-safe:animate-pulse" />
                  ) : isCurrent && resolution === "declined" ? (
                    <X className="size-3.5" strokeWidth={3} aria-hidden />
                  ) : isCurrent && resolution === "closed" ? (
                    <Lock className="size-3" aria-hidden />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-sm leading-tight",
                      isCurrent ? "font-semibold" : !complete && "text-muted-foreground",
                    )}
                  >
                    {STAGE_LABELS[s]}
                  </span>
                  {date && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {isCurrent && !complete ? `depuis le ${DAY.format(date)}` : DAY.format(date)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
