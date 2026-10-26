"use client";

import Link from "next/link";
import { useCallback, useId, useRef, useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ConfirmCopy } from "@/lib/back-office/confirm-copy";
import {
  READ_ONLY_TEXT,
  returnTextOf,
  returnViewOf,
  type CheckoutReturnProps,
} from "@/lib/public/checkout-return-view";
import type { AbandonOutcome } from "@/lib/public/release-actions";
import { PUBLIC_UNEXPECTED } from "@/lib/public/result";
import { abandonCheckoutAction } from "@/server/public";

/** The confirmation of « Libérer ma place » (spec L1166-1168, Decision 50): it says what the gesture costs. Shared with PendingHolds. */
export const RELEASE_CONFIRM: ConfirmCopy = {
  title: "Libérer votre place ?",
  body: "La place est rendue aux autres clients et le paiement en cours est annulé.",
  confirm: "Libérer ma place",
};

/**
 * The return from a Checkout page (spec L1099-1104, L1163-1168, Decisions 13, 31, 32, 33): shown for the `?p=` reference's
 * own purchase or the Owner's own pending booking, never for a guest cookie nor any other purchase id (Decisions 63, 71).
 * « Reprendre le paiement » only while the Checkout session is open (`resumeUrl`); « Libérer ma place » (buy + book only)
 * asks first, then lets the server decide: it never releases a paid, processing or unverifiable purchase. `readOnly` (an
 * admin impersonating someone, who has no client identity) shows the state without either control, and the core refuses
 * the release anyway (G4b).
 */
export function CheckoutReturn({
  slug,
  purchaseId,
  kind,
  status,
  processing,
  resumeUrl,
  holdUntilLabel,
  merciHref,
  readOnly,
}: CheckoutReturnProps) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  /** Where the dialog gives the focus back: the button that opened it, then the heading once a release removed the buttons. */
  const opener = useRef<HTMLElement | null>(null);
  const returnFocus = useCallback(() => opener.current, []);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AbandonOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  const view = returnViewOf({ status, processing, outcome });
  const text = returnTextOf({ view, kind, resumeUrl, holdUntilLabel, readOnly });
  const canRelease = kind === "buybook";

  function ask(e: React.MouseEvent<HTMLButtonElement>) {
    opener.current = e.currentTarget;
    setError(null);
    setOpen(true);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  function release() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await abandonCheckoutAction({ slug, purchaseId });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        // The buttons are gone with an outcome: the focus goes to the block heading, not to <body> (WCAG 2.4.3).
        opener.current = heading.current;
        setOutcome(res.outcome);
        setOpen(false);
      } catch {
        setError(PUBLIC_UNEXPECTED);
      }
    });
  }

  return (
    <Card className="p-5">
      <section aria-labelledby={headingId} className="space-y-3">
        <h2
          id={headingId}
          ref={heading}
          tabIndex={-1}
          className="rounded text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Paiement interrompu
        </h2>
        {/* Always mounted, so that a screen reader announces the outcome when it appears. */}
        <div role="status" className="space-y-1 text-sm">
          {text !== null && <p>{text}</p>}
        </div>
        {view === "paid" && (
          <Button asChild variant="secondary" size="sm" className="w-full sm:w-auto">
            <Link href={merciHref}>Voir la confirmation</Link>
          </Button>
        )}
        {view === "pending" && readOnly && <p className="text-sm text-zinc-600">{READ_ONLY_TEXT}</p>}
        {view === "pending" && !readOnly && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {resumeUrl !== null && (
              <Button asChild className="w-full sm:w-auto">
                <a href={resumeUrl}>Reprendre le paiement</a>
              </Button>
            )}
            {canRelease && (
              <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={ask} disabled={pending}>
                Libérer ma place
              </Button>
            )}
          </div>
        )}
        <ConfirmDialog
          open={open}
          copy={RELEASE_CONFIRM}
          pending={pending}
          error={error}
          onConfirm={release}
          onClose={close}
          returnFocusTo={returnFocus}
        />
      </section>
    </Card>
  );
}
