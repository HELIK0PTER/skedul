"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Minimal anchored popover. Controlled via `open` / `onOpenChange`. The trigger
 * is rendered inside the same ref'd wrapper as the content so clicks on it are
 * not treated as "outside". Closes on outside pointerdown and Escape; opening is
 * the trigger's responsibility (wire its onClick to toggle `open`).
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  align = "start",
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  align?: "start" | "end";
  className?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <span ref={ref} className="relative inline-flex">
      {trigger}
      {open && (
        <div
          role="dialog"
          className={cn(
            "absolute top-full z-50 mt-2 min-w-[12rem] rounded-2xl border border-border bg-card p-3 text-card-foreground shadow-(--shadow-card)",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {children}
        </div>
      )}
    </span>
  );
}
