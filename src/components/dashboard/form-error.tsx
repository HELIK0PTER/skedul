import type { Ref } from "react";

/**
 * Error box of a form or a dialog: nothing for an empty message, else an alert.
 * A form that wants to put the focus on it after a failure passes a `ref` and
 * `tabIndex={-1}` (a box is not focusable by default).
 */
export function FormError({
  message,
  ref,
  tabIndex,
}: {
  message: string | null | undefined;
  ref?: Ref<HTMLParagraphElement>;
  tabIndex?: number;
}) {
  if (!message) return null;
  return (
    <p
      ref={ref}
      tabIndex={tabIndex}
      role="alert"
      className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {message}
    </p>
  );
}
