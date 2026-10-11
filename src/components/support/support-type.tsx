import {
  Bug,
  LifeBuoy,
  Lightbulb,
  MessageCircleQuestionMark,
  type LucideIcon,
} from "lucide-react";

import { TYPE_LABELS, type SupportType } from "@/lib/support";
import { cn } from "@/lib/utils";

export const TYPE_ICONS: Record<SupportType, LucideIcon> = {
  question: MessageCircleQuestionMark,
  bug: Bug,
  feature: Lightbulb,
  other: LifeBuoy,
};

export function SupportTypeChip({ type, className }: { type: SupportType; className?: string }) {
  const Icon = TYPE_ICONS[type];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {TYPE_LABELS[type]}
    </span>
  );
}
