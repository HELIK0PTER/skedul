"use client";

import { useEffect, useId, useRef } from "react";

import { FormError } from "@/components/dashboard/form-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { timeOffConflictCopy } from "@/lib/back-office/confirm-copy";
import { plural } from "@/lib/back-office/format";
import type { TimeOffConflictVM } from "@/lib/back-office/time-off-actions";

const noop = () => {};

/**
 * E6c: the time off overlaps séances or RDVs that have registrants; the pro cancels them or keeps them.
 * While a request runs, both buttons are disabled and the dialog cannot be closed. « La garder » takes the
 * focus once the dialog is open: a stray Enter never cancels anybody. When a request fails (or the list is
 * out of date), the focus moves to the error text: the buttons were disabled while it ran, which dropped
 * the focus onto the page, and the message must be read.
 */
export function TimeOffConflictDialog({
  open,
  conflicts,
  pending,
  error,
  onCancelThem,
  onKeep,
  onClose,
}: {
  open: boolean;
  conflicts: TimeOffConflictVM[];
  pending: boolean;
  error: string | null;
  onCancelThem: () => void;
  onKeep: () => void;
  onClose: () => void;
}) {
  const copy = timeOffConflictCopy({ count: conflicts.length });
  const hasRdv = conflicts.some((c) => c.kind === "rdv");
  const bodyId = useId();
  const errorBox = useRef<HTMLParagraphElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  // The dialog opens (and an answer comes back) while the request that caused it still runs, so the buttons are
  // disabled at that moment and `autoFocus` would not hold: the focus is set once the request is over.
  useEffect(() => {
    if (!open || pending) return;
    (error ? errorBox : keepButton).current?.focus();
  }, [open, error, pending]);

  return (
    <Dialog open={open} onClose={pending ? noop : onClose} title={copy.title} describedBy={bodyId}>
      <div className="space-y-4">
        <p id={bodyId} className="text-sm">
          {copy.intro}
        </p>
        <ul className="max-h-60 space-y-1.5 overflow-y-auto rounded-xl border border-border bg-muted/40 p-3 text-sm">
          {conflicts.map((c) => (
            <li key={c.occurrenceId} className="break-words">
              {`${c.whenLabel} · ${c.title} · ${plural(c.activeBookings, "inscrit", "inscrits")}`}
            </li>
          ))}
        </ul>
        {hasRdv && <p className="text-xs text-zinc-600">{copy.rdvNote}</p>}
        <p className="text-sm text-zinc-600">{copy.keepNote}</p>
        <FormError message={error} ref={errorBox} tabIndex={-1} />
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="destructive"
            onClick={onCancelThem}
            disabled={pending}
            className="h-auto w-full whitespace-normal py-2 text-center"
          >
            {copy.cancelLabel}
          </Button>
          <Button ref={keepButton} type="button" variant="secondary" onClick={onKeep} disabled={pending} className="w-full">
            {copy.keepLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
