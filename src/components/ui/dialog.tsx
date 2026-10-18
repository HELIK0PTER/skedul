"use client";

import { useEffect, useId } from "react";
import { X } from "lucide-react";

/**
 * A modal dialog. The title heading names it (`aria-labelledby`): its id is
 * `labelledBy` when given, else generated. `describedBy` is the id of the
 * element of `children` that explains the dialog (set on that element by the
 * caller); without it the dialog has no description.
 */
export function Dialog({
  open,
  onClose,
  title,
  labelledBy,
  describedBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  labelledBy?: string;
  describedBy?: string;
  children: React.ReactNode;
}) {
  const generatedTitleId = useId();
  const titleId = labelledBy ?? generatedTitleId;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="min-w-0 text-base font-semibold wrap-anywhere">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Fermer"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
