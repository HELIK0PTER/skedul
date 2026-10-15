"use client";

import { useId } from "react";
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
 * closed. « Retour » has the focus: a stray Enter never destroys anything.
 */
export function ConfirmDialog({
  open,
  copy,
  tone = "destructive",
  pending,
  error,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  copy: ConfirmCopy;
  tone?: "destructive" | "primary";
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const titleId = useId();
  const bodyId = useId();
  return (
    <Dialog
      open={open}
      onClose={pending ? noop : onClose}
      title={copy.title}
      labelledBy={titleId}
      describedBy={bodyId}
    >
      <p id={bodyId} className="text-sm text-muted-foreground">
        {copy.body}
      </p>
      {children && <div className="mt-4 space-y-3">{children}</div>}
      {error && (
        <div className="mt-4">
          <FormError message={error} />
        </div>
      )}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending} autoFocus>
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
