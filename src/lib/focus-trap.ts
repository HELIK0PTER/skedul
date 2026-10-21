/**
 * The pure part of the focus trap of `Dialog` (src/components/ui/dialog.tsx):
 * where Tab goes, and which of the open dialogs is on top. No DOM here, so both
 * are unit-tested.
 */

/** Where a tab stop of the dialog stands, in document order, compared with the element that holds the focus now. */
export type TabRelation = "before" | "self" | "after";

/**
 * The index of the tab stop that Tab (or Shift+Tab when `backwards`) must focus
 * inside a trapped dialog, or null when the dialog has no tab stop (the panel
 * itself keeps the focus). `relations` lists the tab stops in document order.
 * Forward is the first stop after the focused element, backwards the last stop
 * before it; with none left the focus wraps to the other end. The focused
 * element may be a stop, the panel itself, a control with `tabindex="-1"` or
 * something behind the dialog: the neighbour in document order is the answer
 * for all of them, so the focus never leaves the dialog.
 */
export function tabDestination(relations: readonly TabRelation[], backwards: boolean): number | null {
  if (relations.length === 0) return null;
  if (backwards) {
    for (let i = relations.length - 1; i >= 0; i--) if (relations[i] === "before") return i;
    return relations.length - 1;
  }
  const next = relations.indexOf("after");
  return next === -1 ? 0 : next;
}

/**
 * The dialog on top of the open ones: the last registered, except that a dialog
 * shown inside another one (`isInside(inner, outer)`) is above it whatever the
 * order of registration (the effects of a child run before those of its parent
 * when both open in the same commit). Null when none is open.
 */
export function topmostOf<T>(stack: readonly T[], isInside: (inner: T, outer: T) => boolean): T | null {
  let top: T | null = null;
  for (const item of stack) {
    if (top === null || !isInside(top, item)) top = item;
  }
  return top;
}
