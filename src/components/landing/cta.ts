import { cn } from "@/lib/utils";

/**
 * Landing CTA voice: full pills applied on top of the shared `Button`
 * (tailwind-merge swaps its radius, colours, press scale and
 * transition-all, so the app's own buttons keep their look).
 *
 * One hover signal per element. Page CTAs lift by 1px and push by 1px on
 * press; under reduced motion the lift becomes a colour shift instead.
 * Nav pills never move: their signal is the tint.
 */
const BASE =
  "rounded-full font-semibold shadow-none active:scale-100 focus-visible:ring-(--lp-focus) focus-visible:ring-offset-2 focus-visible:ring-offset-(--lp-paper)";

const LIFT =
  "transition-[translate,background-color] duration-150 ease-(--lp-ease-out) motion-safe:hover:-translate-y-px motion-safe:active:translate-y-px";
const TINT = "transition-[background-color,color] duration-150 ease-(--lp-ease-out)";

const LARGE = "h-12 px-6 text-[0.9375rem]";
/* Below 400px the pill nav has ~280px for the logo and both actions. */
const SMALL = "h-9 px-4 text-sm max-[400px]:px-3";

export const ctaPrimary = cn(
  BASE,
  LIFT,
  LARGE,
  // `hover:bg-*` restates the rest colour to drop the Button variant's hover.
  "bg-(--lp-accent) text-(--lp-on-accent) hover:bg-(--lp-accent) motion-reduce:hover:bg-(--lp-accent-hover)",
);

export const ctaSecondary = cn(
  BASE,
  LIFT,
  LARGE,
  "border border-(--lp-rule-2) bg-transparent text-(--lp-ink) hover:bg-transparent motion-reduce:hover:bg-(--lp-paper-2)",
);

export const navPrimary = cn(
  BASE,
  TINT,
  SMALL,
  "bg-(--lp-accent) text-(--lp-on-accent) hover:bg-(--lp-accent-hover)",
);

export const navQuiet = cn(
  BASE,
  TINT,
  SMALL,
  "bg-transparent text-(--lp-ink-2) hover:bg-(--lp-paper-2) hover:text-(--lp-ink) active:bg-(--lp-rule)",
);
