"use client";

import { useCallback, useRef, useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { upcomingHeading, useSpaceStatus } from "@/components/public/space-status";
import { Button } from "@/components/ui/button";
import { callOrFail } from "@/lib/pro-messages";
import { COPY } from "@/lib/public/messages";
import { CANCEL_LABEL, cancelBookingCopy, cancelButtonName } from "@/lib/public/space-view";
import type { BookingCoverage } from "@/lib/tickets-vocab";
import { cancelMyBookingAction } from "@/server/client";

/**
 * « Annuler » on one upcoming inscription (E5). The confirmation states the consequences (the ticket comes back for a
 * ticket booking, the pro is told, the client gets an e-mail). A success is announced in the shared status line and the
 * focus goes to the section heading: the row, and this component with it, is gone once the page revalidates, and
 * Dialog calls `returnFocusTo` when it closes or unmounts. A refusal (« Seul(e) … peut annuler maintenant. », a booking
 * that changed, the throttle) stays in the dialog. Closed without cancelling (« Retour », Escape, « Fermer »), the
 * dialog gives the focus back to this button.
 */
export function CancelBookingButton({
  slug,
  bookingId,
  title,
  whenLabel,
  coverage,
  businessName,
}: {
  slug: string;
  bookingId: string;
  title: string;
  whenLabel: string;
  coverage: BookingCoverage;
  businessName: string;
}) {
  const announce = useSpaceStatus();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Set when « Annuler l'inscription » is clicked, BEFORE the answer is awaited: on success the revalidated page may
  // unmount this row (and the dialog with it) before the code after the await runs. Read by Dialog when it closes:
  // the heading after a cancellation, else null, so the dialog gives the focus back to « Annuler » (its opener).
  const leaving = useRef(false);
  const focusAfterClose = useCallback(() => (leaving.current ? upcomingHeading() : null), []);

  function submit() {
    setError(null);
    // The useSpaceStatus contract: a new action clears the previous line, so a second success with the same text is a
    // change of state and is announced again.
    announce(null);
    leaving.current = true;
    startTransition(async () => {
      const res = await callOrFail(() => cancelMyBookingAction({ slug, bookingId }));
      if (!res.ok) {
        leaving.current = false;
        setError(res.error);
        return;
      }
      announce(COPY.CANCELLED_OK);
      setOpen(false);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-label={cancelButtonName(title, whenLabel)}
        onClick={() => {
          leaving.current = false;
          setError(null);
          setOpen(true);
        }}
      >
        {CANCEL_LABEL}
      </Button>
      <ConfirmDialog
        open={open}
        copy={cancelBookingCopy(coverage, businessName)}
        pending={pending}
        error={error}
        onConfirm={submit}
        onClose={() => setOpen(false)}
        returnFocusTo={focusAfterClose}
      />
    </>
  );
}
