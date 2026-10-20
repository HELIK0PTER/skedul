"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, CircleCheck } from "lucide-react";

import { BookingDetailDialog } from "@/components/dashboard/booking-detail-dialog";
import { CoverageBadge } from "@/components/dashboard/coverage-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BookingDetailVM } from "@/lib/back-office/dashboard-reads";

/**
 * Dashboard « Prochaines inscriptions »: each row opens the booking's details. The dialog is held by id, so an
 * unenrolled booking closes it once the list refreshes. The success line of an unenrollment lives here, in a status
 * region that is always mounted (a region added together with its text is not reliably announced): the dialog and
 * the row it came from are gone by then, so the line takes the focus.
 */
export function UpcomingBookings({ bookings }: { bookings: BookingDetailVM[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const statusLine = useRef<HTMLParagraphElement>(null);
  const selected = bookings.find((b) => b.bookingId === selectedId) ?? null;

  useEffect(() => {
    if (notice) statusLine.current?.focus();
  }, [notice]);

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Prochaines inscriptions</CardTitle>
      </CardHeader>
      <CardContent>
        <p
          ref={statusLine}
          role="status"
          tabIndex={-1}
          className={
            notice
              ? "mb-3 flex items-start gap-2 rounded-xl bg-success-muted px-3 py-2 text-sm text-foreground wrap-anywhere focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              : "sr-only"
          }
        >
          {notice && <CircleCheck className="mt-0.5 size-4 shrink-0 text-green-700" aria-hidden />}
          {notice}
        </p>
        {bookings.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-600">Aucune inscription à venir pour le moment.</p>
        ) : (
          <ul className="-mx-2 -my-2 divide-y divide-border">
            {bookings.map((b) => (
              <li key={b.bookingId}>
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setSelectedId(b.bookingId);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} aria-hidden />
                  <span className="block min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{`${b.title} · ${b.customerName}`}</span>
                    <span className="block truncate text-xs text-zinc-600">{b.whenLabel}</span>
                    {/* Below 640 px the badge sits under the date: beside the text it would squeeze the title. */}
                    <span className="mt-1 inline-flex sm:hidden">
                      <CoverageBadge coverage={b.coverage} />
                    </span>
                  </span>
                  <span className="hidden shrink-0 sm:inline-flex">
                    <CoverageBadge coverage={b.coverage} />
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-zinc-600" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {selected && (
        <BookingDetailDialog
          booking={selected}
          onClose={(text) => {
            setSelectedId(null);
            // Only a string is a notice: whatever else a caller hands over is dropped.
            if (typeof text === "string" && text !== "") setNotice(text);
          }}
        />
      )}
    </Card>
  );
}
