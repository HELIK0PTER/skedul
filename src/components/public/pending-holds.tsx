"use client";

import { useCallback, useId, useRef, useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { RELEASE_CONFIRM, releaseOutcomeText } from "@/components/public/checkout-return";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { COPY } from "@/lib/public/messages";
import { PUBLIC_UNEXPECTED } from "@/lib/public/result";
import { abandonCheckoutAction } from "@/server/public";

type PendingHold = { purchaseId: string; title: string; whenLabel: string; holdUntilLabel: string };

/**
 * « Paiements en attente » (SEC-I6, Decision 67): the live holds of the signed-in Owner at this pro. A stranger can start
 * a buy + book with her address, which parks a seat on her customer row for 45 minutes; here she sees it and releases it.
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
    startTransition(async () => {
      try {
        const res = await abandonCheckoutAction({ slug, purchaseId: hold.purchaseId });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        // The row goes with its button: the focus is handed to the section heading (WCAG 2.4.3).
        opener.current = heading.current;
        setNotice(releaseOutcomeText(res.outcome));
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
                  <p className="text-sm text-zinc-600">{`Place gardée jusqu'à ${h.holdUntilLabel}.`}</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full sm:w-auto"
                  disabled={pending}
                  aria-label={`Libérer ma place pour ${h.title}, ${h.whenLabel}`}
                  onClick={(e) => ask(h, e.currentTarget)}
                >
                  Libérer ma place
                </Button>
              </li>
            ))}
          </ul>
        )}
        <ConfirmDialog
          open={target !== null}
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
