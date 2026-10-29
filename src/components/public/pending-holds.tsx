"use client";

import { useCallback, useId, useRef, useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { RDV_RELEASE_CONFIRM, RELEASE_CONFIRM } from "@/components/public/checkout-return";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { releaseOutcomeText } from "@/lib/public/checkout-return-view";
import { COPY } from "@/lib/public/messages";
import { PUBLIC_UNEXPECTED } from "@/lib/public/result";
import { abandonCheckoutAction } from "@/server/public";

/** `isRdv`: an RDV slot, whose row says « créneau » and never « place » (P5 § 3.13). */
type PendingHold = { purchaseId: string; isRdv: boolean; title: string; whenLabel: string; holdUntilLabel: string };

/**
 * « Paiements en attente » (SEC-I6, Decision 67): the live holds of the signed-in Owner at this pro. A stranger can start
 * a buy + book with her address, which parks a seat on her customer row for 45 minutes; here she sees it and releases it.
 * A séance seat and an RDV slot are listed together, each in its own words.
 * The page renders this for every Owner, even with no hold, so that the line left by a release survives the revalidation
 * that follows the action; the component renders nothing while it has no hold and no line to show.
 */
export function PendingHolds({ slug, holds }: { slug: string; holds: PendingHold[] }) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  /** Where the dialog gives the focus back: the row button that opened it, then the heading once the row is gone. */
  const opener = useRef<HTMLElement | null>(null);
  const returnFocus = useCallback(() => opener.current, []);
  const [target, setTarget] = useState<PendingHold | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  /** Purchases released from this page, hidden at once while the revalidated list catches up. */
  const [gone, setGone] = useState<readonly string[]>([]);
  const [pending, startTransition] = useTransition();

  const rows = holds.filter((h) => !gone.includes(h.purchaseId));
  if (rows.length === 0 && notice === "") return null;

  function ask(hold: PendingHold, button: HTMLButtonElement) {
    opener.current = button;
    setError(null);
    setTarget(hold);
  }

  function close() {
    if (pending) return;
    setTarget(null);
    setError(null);
  }

  function release() {
    if (target === null || pending) return;
    const hold = target;
    setError(null);
    // The previous line goes first (the `announce(null)` rule of CancelBookingButton, G3b): « Votre place est libérée. » set
    // twice in a row is the same value, and an always-mounted status region announces nothing for a text that did not change.
    setNotice("");
    startTransition(async () => {
      try {
        const res = await abandonCheckoutAction({ slug, purchaseId: hold.purchaseId });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        // The row goes with its button: the focus is handed to the section heading (WCAG 2.4.3).
        opener.current = heading.current;
        setNotice(releaseOutcomeText(res.outcome, hold.isRdv ? "rdv" : "buybook"));
        if (res.outcome !== "processing") setGone((ids) => [...ids, hold.purchaseId]);
        setTarget(null);
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
          {COPY.PENDING_HOLDS_TITLE}
        </h2>
        {/* Always mounted, so that a screen reader announces the line when it appears. */}
        <p role="status" className={notice ? "text-sm" : "sr-only"}>
          {notice}
        </p>
        {rows.length > 0 && (
          <ul className="divide-y divide-border">
            {rows.map((h) => (
              <li key={h.purchaseId} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium wrap-anywhere">{`${h.title} · ${h.whenLabel}`}</p>
                  <p className="text-sm text-zinc-600">
                    {h.isRdv ? `Créneau gardé jusqu'à ${h.holdUntilLabel}.` : `Place gardée jusqu'à ${h.holdUntilLabel}.`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full sm:w-auto"
                  disabled={pending}
                  aria-label={`${h.isRdv ? RDV_RELEASE_CONFIRM.confirm : RELEASE_CONFIRM.confirm} pour ${h.title}, ${h.whenLabel}`}
                  onClick={(e) => ask(h, e.currentTarget)}
                >
                  {h.isRdv ? RDV_RELEASE_CONFIRM.confirm : RELEASE_CONFIRM.confirm}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <ConfirmDialog
          open={target !== null}
          copy={target?.isRdv ? RDV_RELEASE_CONFIRM : RELEASE_CONFIRM}
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
