import type { Ref } from "react";

/**
 * Error box of a form or a dialog: nothing for an empty message, else an alert.
 * A form that wants to put the focus on it after a failure passes a `ref` and
 * `tabIndex={-1}` (a box is not focusable by default).
 *
 * `alwaysMounted` keeps the alert in the page while there is nothing to say (an empty, screen-reader-only line), so a
 * screen reader announces the text when it arrives: a live region added together with its text is often not announced.
 * The public forms use it (G4c); the line they show is the same as the dashboard's.
 */
export function FormError({
  message,
  ref,
  tabIndex,
  alwaysMounted = false,
}: {
  message: string | null | undefined;
  ref?: Ref<HTMLParagraphElement>;
  tabIndex?: number;
  alwaysMounted?: boolean;
}) {
  if (!message && !alwaysMounted) return null;
  return (
    <p
      ref={ref}
      tabIndex={tabIndex}
      role="alert"
      className={
        message
          ? "rounded-lg bg-destructive/10 px-3 py-2 text-sm text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "sr-only"
      }
    >
      {message}
    </p>
  );
}
