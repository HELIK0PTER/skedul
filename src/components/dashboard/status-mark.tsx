import { ALERT_LABELS, type AlertTone } from "@/lib/back-office/labels";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<AlertTone, string> = {
  red: "bg-destructive",
  orange: "bg-amber-600",
};

/**
 * The 🔴 / 🟠 mark of the spec as a semantic dot: the meaning is in the
 * accessible name and the tooltip, never in the colour alone. No emoji in the UI.
 * `decorative` hides it from assistive technology, for a mark that sits next to
 * visible text saying the same thing (the text carries the meaning).
 */
export function StatusMark({
  tone,
  label,
  decorative,
  className,
}: {
  tone: AlertTone;
  label?: string;
  decorative?: boolean;
  className?: string;
}) {
  const dot = cn("inline-block size-2 shrink-0 rounded-full", TONE_CLASS[tone], className);
  if (decorative) return <span aria-hidden className={dot} />;
  const text = label ?? ALERT_LABELS[tone];
  return <span role="img" aria-label={text} title={text} className={dot} />;
}
