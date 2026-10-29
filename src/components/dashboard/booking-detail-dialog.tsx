"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { BookingStatusBadge } from "@/components/dashboard/booking-status-badge";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { CoverageBadge } from "@/components/dashboard/coverage-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { unenrollCopy, unenrollLabel } from "@/lib/back-office/confirm-copy";
import type { BookingDetailVM } from "@/lib/back-office/dashboard-reads";
import { unenrolledMessage } from "@/lib/back-office/planning-view";
import { REQUEST_FAILED } from "@/lib/pro-messages";
import type { PurchaseStatus } from "@/lib/tickets-vocab";
import { unenrollAction } from "@/server/pro-planning";

const PAYMENT_TEXT: Record<Exclude<PurchaseStatus, "paid">, string> = {
  pending: "Paiement en attente",
  expired: "Paiement expiré",
};

function PaymentLine({ purchase }: { purchase: NonNullable<BookingDetailVM["purchase"]> }) {
  if (purchase.status !== "paid") return <p className="text-sm">{PAYMENT_TEXT[purchase.status]}</p>;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <span>{`Payé ${purchase.amountLabel}`}</span>
      {!purchase.livemode && <Badge variant="outline">Test</Badge>}
    </p>
  );
}

/**
 * The details of one upcoming booking, with « Voir dans le planning » and « Désinscrire » (« Annuler le rendez-vous »
 * on an RDV, D § 3.10). It is only offered on a live booking (confirmed, or pending), and goes through the engine
 * behind a ConfirmDialog; a failure
 * stays in that confirmation. The details dialog stays open under the confirmation, so « Retour » hands the focus
 * back to the button that opened it, and Escape or the backdrop close the confirmation first, never both.
 * `onClose(notice)` closes the dialog; after a success the notice is the status line for the page (the booking
 * leaves the list on the next refresh, so this dialog cannot show it itself).
 */
export function BookingDetailDialog({
  booking,
  onClose,
}: {
  booking: BookingDetailVM;
  onClose: (notice?: string) => void;
}) {
  const summaryId = useId();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = booking.status === "confirmed" || booking.status === "pending";

  // `Dialog` calls its onClose with the click event (backdrop, close button): never pass `onClose` itself, it reads a notice.
  function closeSelf() {
    if (confirming || pending) return;
    onClose();
  }

  function closeConfirm() {
    if (pending) return;
    setConfirming(false);
    setError(null);
  }

  async function unenroll() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await unenrollAction({
        occurrenceId: booking.occurrenceId,
        bookingIds: [booking.bookingId],
        reason: null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirming(false);
      onClose(unenrolledMessage([booking.customerName], res.cancelled, res.ticketsReturned, booking.kind));
    } catch {
      setError(REQUEST_FAILED);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Dialog open onClose={closeSelf} title={booking.title} describedBy={summaryId}>
        <div id={summaryId}>
          <p className="text-sm text-zinc-600">{booking.whenLabel}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <CoverageBadge coverage={booking.coverage} />
            {booking.ticketTypeName && <span className="text-sm text-zinc-600 wrap-anywhere">{booking.ticketTypeName}</span>}
            {booking.status !== "confirmed" && <BookingStatusBadge status={booking.status} />}
          </div>
          {booking.purchase && (
            <div className="mt-2">
              <PaymentLine purchase={booking.purchase} />
            </div>
          )}
        </div>

        <div className="mt-4 rounded-xl bg-muted/50 p-3 text-sm">
          <p className="text-xs text-zinc-600">Client</p>
          <Link
            href={`/dashboard/clients/${booking.customerId}`}
            className="mt-1 block rounded font-medium wrap-anywhere hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {booking.customerName}
          </Link>
          <a
            href={`mailto:${booking.customerEmail}`}
            className="block rounded text-zinc-600 wrap-anywhere hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {booking.customerEmail}
          </a>
          {booking.customerPhone && (
            <a
              href={`tel:${booking.customerPhone}`}
              className="block rounded text-zinc-600 wrap-anywhere hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {booking.customerPhone}
            </a>
          )}
        </div>

        {(booking.answers.length > 0 || booking.notes) && (
          <dl className="mt-4 space-y-3 text-sm">
            {booking.answers.map((a, i) => (
              <div key={i}>
                <dt className="text-xs text-zinc-600 wrap-anywhere">{a.label}</dt>
                <dd className="mt-0.5 whitespace-pre-line wrap-anywhere">{a.value}</dd>
              </div>
            ))}
            {booking.notes && (
              <div>
                <dt className="text-xs text-zinc-600">Message du client</dt>
                <dd className="mt-0.5 whitespace-pre-line wrap-anywhere">{booking.notes}</dd>
              </div>
            )}
          </dl>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <Button asChild variant="secondary" size="sm">
            <Link href={booking.planningHref}>Voir dans le planning</Link>
          </Button>
          {live && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              {unenrollLabel(booking.kind)}
            </Button>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        copy={unenrollCopy({
          kind: booking.kind,
          names: [booking.customerName],
          ticketCount: booking.coverage === "ticket" ? 1 : 0,
          pendingCount: booking.status === "pending" ? 1 : 0,
        })}
        pending={pending}
        error={error}
        onConfirm={unenroll}
        onClose={closeConfirm}
      />
    </>
  );
}
