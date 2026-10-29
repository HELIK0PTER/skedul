"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Button } from "@/components/ui/button";
import { announceRelease } from "@/components/public/release-status";
import { Card } from "@/components/ui/card";
import type { ConfirmCopy } from "@/lib/back-office/confirm-copy";
import {
  READ_ONLY_TEXT,
  releaseOutcomeText,
  returnHeadingOf,
  returnTextOf,
  returnViewOf,
  type CheckoutReturnProps,
} from "@/lib/public/checkout-return-view";
import type { AbandonOutcome } from "@/lib/public/release-actions";
import { PUBLIC_UNEXPECTED } from "@/lib/public/result";
import { SEANCE_HEADING_ID } from "@/lib/public/seance-copy";
import { RDV_HEADING_ID } from "@/lib/public-anchors";
import { abandonCheckoutAction } from "@/server/public";

/** The confirmation of « Libérer ma place » (spec L1166-1168, Decision 50): it says what the gesture costs. Shared with PendingHolds. */
export const RELEASE_CONFIRM: ConfirmCopy = {
  title: "Libérer votre place ?",
  body: "La place est rendue aux autres clients et le paiement en cours est annulé.",
  confirm: "Libérer ma place",
};

/** The same confirmation for an RDV hold: a « créneau », never a « place » (P5 § 3.10). Shared with PendingHolds. */
export const RDV_RELEASE_CONFIRM: ConfirmCopy = {
  title: "Libérer votre créneau ?",
  body: "Le créneau est rendu aux autres clients et le paiement en cours est annulé.",
  confirm: "Libérer mon créneau",
};

/**
 * Where the focus goes once a release is done (WCAG 2.4.3). The buttons are gone with the outcome, and so may the whole
 * block be: the Owner's own pending purchase ends with the release, so the revalidated page no longer renders it. The
 * séance heading, or the RDV page's heading, is on the page whatever it renders; the block's own heading is the fallback
 * where there is none.
 */
function afterReleaseTarget(own: HTMLElement | null): HTMLElement | null {
  return document.getElementById(SEANCE_HEADING_ID) ?? document.getElementById(RDV_HEADING_ID) ?? own;
}

/**
 * The return from a Checkout page (spec L1099-1104, L1163-1168, Decisions 13, 31, 32, 33): shown for the `?p=` reference's
 * own purchase or the Owner's own pending booking, never for a guest cookie nor any other purchase id (Decisions 63, 71).
 * « Reprendre le paiement » only while the Checkout session is open (`resumeUrl`); « Libérer ma place » (a séance or an
 * RDV hold, « Libérer mon créneau » for an RDV; never a shop purchase)
 * asks first, then lets the server decide: it never releases a paid, processing or unverifiable purchase. `readOnly` (an
 * admin impersonating someone, who has no client identity) shows the state without either control, and the core refuses
 * the release anyway (G4b). The block has no live region of its own: what a release did is said through the page's
 * `ReleaseStatus` (`announceRelease`), which stays when the revalidation removes the block (G4c).
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
  /** Where the dialog gives the focus back: the button that opened it, then the séance heading once a release removed the buttons. */
  const opener = useRef<HTMLElement | null>(null);
  /** False once the block is gone: the Server Action applies the revalidated page before its answer reaches this component. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const returnFocus = useCallback(() => opener.current, []);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AbandonOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  const view = returnViewOf({ status, processing, outcome });
  const text = returnTextOf({ view, kind, resumeUrl, holdUntilLabel, readOnly });
  const canRelease = kind !== "shop";
  const confirmCopy = kind === "rdv" ? RDV_RELEASE_CONFIRM : RELEASE_CONFIRM;

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
    // The previous line goes first (the `announce(null)` rule of CancelBookingButton, G3b): two releases in a row say the
    // same sentence, and a live region announces nothing for a text that did not change.
    setError(null);
    announceRelease("");
    startTransition(async () => {
      try {
        const res = await abandonCheckoutAction({ slug, purchaseId });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        // The buttons are gone with an outcome: the focus goes to a heading that stays, not to <body> (WCAG 2.4.3).
        opener.current = afterReleaseTarget(heading.current);
        setOutcome(res.outcome);
        setOpen(false);
        // Said through the page's own region, which the revalidation does not remove. When the answer comes back after the
        // block went, its dialog restored the focus to nothing: this component does it, once.
        announceRelease(releaseOutcomeText(res.outcome, kind));
        if (!alive.current) opener.current?.focus();
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
          {returnHeadingOf(view)}
        </h2>
        <div className="space-y-1 text-sm">
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
                {confirmCopy.confirm}
              </Button>
            )}
          </div>
        )}
        <ConfirmDialog
          open={open}
          copy={confirmCopy}
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
