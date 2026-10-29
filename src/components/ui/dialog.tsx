"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";

import { restoreTarget, tabDestination, topmostOf, type TabRelation } from "@/lib/focus-trap";

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

/** The panels of the open dialogs, in the order they registered (see `topmostOf`). */
const openPanels: HTMLElement[] = [];

const TAB_STOPS =
  'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/** The tab stops inside `panel`, in document order: enabled, shown, and the one checked radio of each group. */
function tabStopsOf(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(TAB_STOPS)).filter((el) => {
    if (el.matches(":disabled") || el.closest("[inert]") || el.tabIndex < 0) return false;
    if (el.getClientRects().length === 0 || getComputedStyle(el).visibility === "hidden") return false;
    if (el instanceof HTMLInputElement && el.type === "radio" && el.name && !el.checked) {
      const group = (el.form ?? panel).querySelectorAll<HTMLInputElement>('input[type="radio"]');
      for (const other of group) if (other.name === el.name && other.checked) return false;
    }
    return true;
  });
}

/** Where `stop` stands in the document compared with `from` (the element that holds the focus). */
function relationOf(stop: HTMLElement, from: Element): TabRelation {
  if (stop === from) return "self";
  return from.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING ? "after" : "before";
}

/** True for a node inside any modal dialog panel, open dialogs that have not registered yet included. */
function inModalDialog(node: Node): boolean {
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest('[role="dialog"][aria-modal="true"]') != null;
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
 * focus goes back to `returnFocusTo` when the caller gave one, else to the
 * element that held it when the dialog opened, as long as that element is still
 * on the page and enabled (WCAG 2.4.3, `restoreTarget`). That element is read while
 * rendering, at the moment `open` turns true: an `autoFocus` control inside the
 * dialog takes the focus during the commit, before any effect runs, so an
 * effect would only ever see the dialog's own control. A dialog opened from a
 * dialog hands the focus back to its opener inside the outer one.
 *
 * While it is open the focus stays inside it: Tab and Shift+Tab cycle through
 * the tab stops of the dialog on top (see `tabDestination`), so the controls
 * behind it are never reached from the keyboard. Escape is untouched: every open
 * dialog still receives it, and the callers keep a sub-dialog from closing its
 * parent (the guards of `occurrence-dialog.tsx`, `booking-detail-dialog.tsx`).
 */
export function Dialog({
  open,
  onClose,
  title,
  labelledBy,
  describedBy,
  returnFocusTo,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  labelledBy?: string;
  describedBy?: string;
  /**
   * The element that takes the focus back when the dialog closes, asked at that moment. For a dialog whose opener
   * cannot be known when it opens: the trigger was disabled while the answer loaded, so it did not hold the focus.
   * Keep the function's identity stable (useCallback). Without it, or when the element is gone or disabled, the
   * focus returns to the element that held it when the dialog opened.
   */
  returnFocusTo?: () => HTMLElement | null;
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

  // Focus trap. Declared before the opener effect: on close its cleanup runs first, so the dialog has left the
  // stack when the opener takes the focus back. The panel is not rendered in a portal, so the page behind cannot be
  // made `inert` from here: Tab is steered by hand instead, and only by the dialog on top of the open ones.
  useEffect(() => {
    if (!open) return;
    const el = panel.current;
    if (!el) return;
    openPanels.push(el);
    const isTop = () => topmostOf(openPanels, (inner, outer) => outer !== inner && outer.contains(inner)) === el;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || !isTop()) return;
      const stops = tabStopsOf(el);
      e.preventDefault();
      if (stops.length === 0) {
        el.focus();
        return;
      }
      const from = document.activeElement ?? document.body;
      const to = tabDestination(
        stops.map((stop) => relationOf(stop, from)),
        e.shiftKey,
      );
      stops[to ?? 0].focus();
    };
    // Focus that lands behind every dialog (a script, the browser coming back from its own controls) is brought back in.
    const onFocusIn = (e: FocusEvent) => {
      if (!isTop() || !(e.target instanceof Node) || inModalDialog(e.target)) return;
      (tabStopsOf(el)[0] ?? el).focus();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      const at = openPanels.indexOf(el);
      if (at !== -1) openPanels.splice(at, 1);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = panel.current;
    return () => {
      // Strict Mode runs this cleanup once while the dialog is still on screen: nothing has closed then.
      if (el?.isConnected) return;
      restoreTarget(returnFocusTo?.(), opener)?.focus();
    };
  }, [open, opener, returnFocusTo]);

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
