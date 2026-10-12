"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatSlot } from "@/lib/datetime";
import { formatMoney } from "@/lib/utils";
import { cancelBooking } from "@/server/pro";

export type BookingDetailVM = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  paymentType: string;
  amountPaidCents: number | null;
  packName: string | null;
  eventTitle: string;
  eventColor: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  notes: string | null;
  answers: { label: string; value: string }[];
  /** Planning page on the booking's week. */
  planningHref: string;
};

/** How the booking is paid, as a short badge. */
export function paymentBadge(b: Pick<BookingDetailVM, "paymentType" | "status">) {
  if (b.paymentType === "credit") return { label: "Crédit", variant: "default" as const };
  if (b.paymentType === "free") return { label: "Offert", variant: "neutral" as const };
  if (b.status === "pending")
    return { label: "Paiement en attente", variant: "warning" as const };
  return { label: "Payé", variant: "neutral" as const };
}

export function BookingDetailDialog({
  booking: b,
  tz,
  currency,
  onClose,
}: {
  booking: BookingDetailVM;
  tz: string;
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const badge = paymentBadge(b);
  const amount =
    b.paymentType === "direct" && b.amountPaidCents
      ? formatMoney(b.amountPaidCents, currency)
      : null;
  const paymentDetail =
    b.paymentType === "credit" && b.packName
      ? `Crédit du pack ${b.packName}`
      : amount
        ? `${badge.label} · ${amount}`
        : badge.label;

  const consequences = [
    "Le créneau sera libéré.",
    b.paymentType === "credit" && "Le crédit sera rendu au client.",
    b.paymentType === "direct" &&
      b.status !== "pending" &&
      "Le paiement n'est pas remboursé automatiquement.",
    "Skedul n'envoie pas d'e-mail au client.",
  ]
    .filter(Boolean)
    .join(" ");

  function cancel() {
    setError(null);
    startTransition(async () => {
      const res = await cancelBooking(b.id);
      if (!res.ok) {
        setError(res.error ?? "Action impossible.");
      } else {
        router.refresh();
        onClose();
      }
    });
  }

  return (
    <Dialog open onClose={onClose} title={b.eventTitle}>
      <p className="text-sm text-muted-foreground">
        {formatSlot(new Date(b.startAt), new Date(b.endAt), tz)}
      </p>
      <div className="mt-3">
        <Badge variant={badge.variant}>{paymentDetail}</Badge>
      </div>

      <div className="mt-4 rounded-xl bg-muted/50 p-3 text-sm">
        <p className="text-xs text-muted-foreground">Client</p>
        <p className="mt-1 font-medium">{b.customerName || "Sans nom"}</p>
        <a
          href={`mailto:${b.customerEmail}`}
          className="block truncate text-muted-foreground hover:text-foreground hover:underline"
        >
          {b.customerEmail}
        </a>
        {b.customerPhone && (
          <a
            href={`tel:${b.customerPhone}`}
            className="block text-muted-foreground hover:text-foreground hover:underline"
          >
            {b.customerPhone}
          </a>
        )}
      </div>

      {(b.answers.length > 0 || b.notes) && (
        <dl className="mt-4 space-y-3 text-sm">
          {b.answers.map((a, i) => (
            <div key={i}>
              <dt className="text-xs text-muted-foreground">{a.label}</dt>
              <dd className="mt-0.5 whitespace-pre-line">{a.value}</dd>
            </div>
          ))}
          {b.notes && (
            <div>
              <dt className="text-xs text-muted-foreground">Message du client</dt>
              <dd className="mt-0.5 whitespace-pre-line">{b.notes}</dd>
            </div>
          )}
        </dl>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-5 border-t border-border pt-4">
        {confirming ? (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-medium">Annuler cette réservation ?</span>{" "}
              <span className="text-muted-foreground">{consequences}</span>
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Retour
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={pending}
                onClick={cancel}
              >
                {pending ? "Annulation…" : "Confirmer l'annulation"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href={b.planningHref}>Voir dans le planning</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              Annuler la réservation
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
