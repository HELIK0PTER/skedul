import { CalendarClock } from "lucide-react";

import { cn } from "@/lib/utils";

export function Logo({
  className,
  withWordmark = true,
}: {
  className?: string;
  withWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground shadow-(--shadow-pop)">
        <CalendarClock className="size-4.5" />
      </span>
      {withWordmark && (
        <span className="text-lg font-bold tracking-tight">Skedul</span>
      )}
    </span>
  );
}
