import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { demoHref } from "@/components/demo/demo-script";
import { cn } from "@/lib/utils";

const TONES = {
  /* Ink label on a hairline that turns violet: the violet alone is under
     4.5:1 as body-size text, on both the light and the dark paper. */
  paper: {
    label: "text-(--lp-ink) decoration-(--lp-rule-2) group-hover:decoration-(--lp-accent)",
    arrow: "text-(--lp-accent)",
    focus: "focus-visible:outline-(--lp-focus)",
  },
  ticket: {
    label:
      "text-(--lp-ticket-ink) decoration-(--lp-ticket-rule) group-hover:decoration-(--lp-ticket-ink)",
    arrow: "text-(--lp-ticket-ink-2)",
    focus: "focus-visible:outline-(--lp-ticket-ink-2)",
  },
};

/**
 * Quiet in-section CTA: opens the guided tour on the screen the section
 * talks about (`step`, a `DEMO_STEPS` id). One hover signal, the underline
 * colour, so it also holds under reduced motion.
 */
export function DemoLink({
  step,
  tone = "paper",
  className,
  children,
}: {
  step?: string;
  tone?: keyof typeof TONES;
  className?: string;
  children: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <Link
      href={demoHref(step)}
      className={cn(
        "group flex w-fit items-center gap-1.5 rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4",
        t.focus,
        className,
      )}
    >
      <span
        className={cn(
          "underline decoration-[1.5px] underline-offset-[6px] transition-[text-decoration-color] duration-150 ease-(--lp-ease-out)",
          t.label,
        )}
      >
        {children}
      </span>
      <ArrowRight aria-hidden className={cn("size-4 shrink-0", t.arrow)} />
    </Link>
  );
}
