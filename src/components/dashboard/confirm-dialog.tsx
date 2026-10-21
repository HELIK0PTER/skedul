"use client";

import { useEffect, useEffectEvent, useId, useRef } from "react";
import { Loader2 } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { ConfirmCopy } from "@/lib/back-office/confirm-copy";

const noop = () => {};

/**
 * The confirmation of a destructive action: the consequences (from
 * confirm-copy.ts, fed by a preview), optional extra fields as `children`
 * (a reason, a choice), the action error, « Retour » and the confirm button.
 * While the action runs, both buttons are disabled and the dialog cannot be
 * closed. « Retour » has the focus: a stray Enter never destroys anything. A
 * dialog that opens while an answer is awaited (`pending`) has « Retour »
 * disabled, so its `autoFocus` does nothing: « Retour » takes the focus when the
 * wait ends, on the same dialog instance (a remount would lose the opener the
 * dialog gives the focus back to). When the action fails, the focus moves to the
 * error text instead: the confirm button was disabled while it ran, which dropped
 * the focus onto the page, and the message must be read. `returnFocusTo`: see
 * `Dialog`.
 */
export function ConfirmDialog({
  open,
  copy,
  tone = "destructive",
  pending,
  error,
  onConfirm,
  onClose,
  returnFocusTo,
  children,
}: {
  open: boolean;
  copy: ConfirmCopy;
  tone?: "destructive" | "primary";
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
  children?: React.ReactNode;
}) {
  const titleId = useId();
  const bodyId = useId();
  const errorBox = useRef<HTMLParagraphElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open && error && !pending) errorBox.current?.focus();
  }, [open, error, pending]);
  // Only the end of a wait (or the opening) moves the focus here: a message that comes and goes while the pro types in a
  // field of the dialog must not take it away. A failed action is the error effect's business, above.
  const focusBack = useEffectEvent(() => {
    if (!error) back.current?.focus();
  });
  useEffect(() => {
    if (open && !pending) focusBack();
  }, [open, pending]);
  return (
    <Dialog
      open={open}
      onClose={pending ? noop : onClose}
      title={copy.title}
      labelledBy={titleId}
      describedBy={bodyId}
      returnFocusTo={returnFocusTo}
    >
      <p id={bodyId} className="text-sm text-muted-foreground">
        {copy.body}
      </p>
      {children && <div className="mt-4 space-y-3">{children}</div>}
      {error && (
        <div className="mt-4">
          <FormError message={error} ref={errorBox} tabIndex={-1} />
        </div>
      )}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button ref={back} type="button" variant="ghost" onClick={onClose} disabled={pending} autoFocus>
          Retour
        </Button>
        <Button
          type="button"
          variant={tone === "destructive" ? "destructive" : "primary"}
          onClick={onConfirm}
          disabled={pending}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {copy.confirm}
        </Button>
      </div>
    </Dialog>
  );
}
