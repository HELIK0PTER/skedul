import { ALERT_LABELS, type AlertTone } from "@/lib/back-office/labels";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<AlertTone, string> = {
  red: "bg-destructive",
  orange: "bg-amber-600",
};

/**
 * The 🔴 / 🟠 mark of the spec as a semantic dot: the meaning is in the
 * accessible name and the tooltip, never in the colour alone. No emoji in the UI.
 */
export function StatusMark({ tone, label, className }: { tone: AlertTone; label?: string; className?: string }) {
  const text = label ?? ALERT_LABELS[tone];
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      className={cn("inline-block size-2 shrink-0 rounded-full", TONE_CLASS[tone], className)}
    />
  );
}
