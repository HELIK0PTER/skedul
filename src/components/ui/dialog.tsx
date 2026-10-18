"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";

/**
 * The element that holds the focus right now, when it is worth coming back to:
 * not `document.body`, which is where the focus rests when nothing has it. Null
 * on the server.
 */
function focusedElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

/**
 * A modal dialog. The title heading names it (`aria-labelledby`): its id is
 * `labelledBy` when given, else generated. `describedBy` is the id of the
 * element of `children` that explains the dialog (set on that element by the
 * caller); without it the dialog has no description. When it opens and no
 * control inside holds the focus (an `autoFocus` control that is disabled at
 * mount does not), the panel itself takes it, so assistive technology is taken
 * into the dialog.
 *
 * When it closes (`open` turns false, or the component unmounts while open) the
 * focus goes back to the element that held it when the dialog opened, as long
 * as that element is still on the page (WCAG 2.4.3). That element is read while
 * rendering, at the moment `open` turns true: an `autoFocus` control inside the
 * dialog takes the focus during the commit, before any effect runs, so an
 * effect would only ever see the dialog's own control. A dialog opened from a
 * dialog hands the focus back to its opener inside the outer one.
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
  const panel = useRef<HTMLDivElement>(null);

  // « Adjust state when a prop changes »: the opener is stored in the render where `open` turns true.
  const [wasOpen, setWasOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpener(focusedElement());
  }

  useEffect(() => {
    if (!open) return;
    const el = panel.current;
    if (el && !el.contains(document.activeElement)) el.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = panel.current;
    return () => {
      // Strict Mode runs this cleanup once while the dialog is still on screen: nothing has closed then.
      if (el?.isConnected) return;
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open, opener]);

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
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl outline-none"
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
