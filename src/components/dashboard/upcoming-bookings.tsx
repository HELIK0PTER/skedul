"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

import {
  BookingDetailDialog,
  paymentBadge,
  type BookingDetailVM,
} from "@/components/dashboard/booking-detail-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatSlot } from "@/lib/datetime";

/** Dashboard « Prochaines réservations »: each row opens the booking's details. */
export function UpcomingBookings({
  bookings,
  tz,
  currency,
}: {
  bookings: BookingDetailVM[];
  tz: string;
  currency: string;
}) {
  // By id, so a cancelled booking closes its dialog once the list refreshes.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = bookings.find((b) => b.id === selectedId) ?? null;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Prochaines réservations</CardTitle>
      </CardHeader>
      <CardContent>
        {bookings.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Aucune réservation à venir pour le moment.
          </p>
        ) : (
          <ul className="-mx-2 -my-2 divide-y divide-border">
            {bookings.map((b) => {
              const badge = paymentBadge(b);
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(b.id)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: b.eventColor }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {b.eventTitle} · {b.customerName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatSlot(new Date(b.startAt), new Date(b.endAt), tz)}
                      </p>
                    </div>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {selected && (
        <BookingDetailDialog
          booking={selected}
          tz={tz}
          currency={currency}
          onClose={() => setSelectedId(null)}
        />
      )}
    </Card>
  );
}
