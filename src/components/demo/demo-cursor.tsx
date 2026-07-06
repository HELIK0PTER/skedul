"use client";

import { MousePointer2 } from "lucide-react";

import { cn } from "@/lib/utils";

export interface CursorState {
  x: number;
  y: number;
  visible: boolean;
  /** Incrémenté à chaque clic — sert de `key` pour rejouer l'anneau de pulsation. */
  clickCount: number;
}

export function DemoCursor({ x, y, visible, clickCount }: CursorState) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-0 top-0 z-20 transition-transform duration-700 ease-[cubic-bezier(0.3,0.9,0.3,1)]",
        !visible && "opacity-0",
      )}
      style={{ transform: `translate3d(${x}px, ${y}px, 0)` }}
    >
      {clickCount > 0 && (
        <span
          key={clickCount}
          className="demo-click absolute -left-3 -top-3 size-8 rounded-full border-2 border-primary"
        />
      )}
      <MousePointer2 className="size-5 text-primary drop-shadow-md" fill="currentColor" />
    </div>
  );
}
