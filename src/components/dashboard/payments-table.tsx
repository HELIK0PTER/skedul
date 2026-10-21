import Link from "next/link";
import { Fragment } from "react";

import { BookingStatusBadge } from "@/components/dashboard/booking-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatWhenShort, planningHref, plural } from "@/lib/back-office/format";
import type { PaymentRow } from "@/lib/back-office/payments-reads";
import { formatDateShort } from "@/lib/datetime";
import { CLOSE_REASON_LABELS } from "@/lib/tickets-vocab";
import { formatMoney } from "@/lib/utils";

function closedLine(c: PaymentRow["closedNotes"][number]): string {
  const base = `${plural(c.count, "ticket clos", "tickets clos")} : ${CLOSE_REASON_LABELS[c.reason]}`;
  return c.note ? `${base} (${c.note})` : base;
}

function ClosedNotes({ notes }: { notes: PaymentRow["closedNotes"] }) {
  return (
    <ul className="space-y-0.5 text-xs text-zinc-600">
      {notes.map((c) => (
        <li key={`${c.reason}:${c.note ?? ""}`} className="wrap-anywhere">
          {closedLine(c)}
        </li>
      ))}
    </ul>
  );
}

function LinkedBooking({ booking, tz, now }: { booking: PaymentRow["booking"]; tz: string; now: Date }) {
  if (!booking) return <span className="text-zinc-600">Aucune</span>;
  return (
    <div className="min-w-0 space-y-1">
      <Link
        href={planningHref({ occurrenceId: booking.occurrenceId, startsAt: booking.startsAt, tz })}
        className="font-medium wrap-anywhere hover:underline"
      >
        {booking.title}
      </Link>
      <p className="text-xs text-zinc-600">{formatWhenShort(booking.startsAt, tz, now)}</p>
      {booking.status !== "confirmed" && <BookingStatusBadge status={booking.status} />}
    </div>
  );
}

function Amount({ row }: { row: PaymentRow }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <span className="font-semibold whitespace-nowrap">{formatMoney(row.amountCents, row.currency)}</span>
      {!row.livemode && <Badge variant="outline">Test</Badge>}
    </div>
  );
}

function ClientCell({ row }: { row: PaymentRow }) {
  return (
    <div className="min-w-0">
      <Link href={`/dashboard/clients/${row.customerId}`} className="font-medium wrap-anywhere hover:underline">
        {row.customerName}
      </Link>
      <p className="text-xs text-zinc-600 wrap-anywhere">{row.customerEmail}</p>
    </div>
  );
}

/** The paid purchases of the pro: a table from 640 px, cards below. The séance of a purchase names its year when it is not `now`'s. */
export function PaymentsTable({ rows, tz, now }: { rows: PaymentRow[]; tz: string; now: Date }) {
  return (
    <>
      <Card className="hidden overflow-hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Vos paiements</caption>
            <thead className="bg-muted/50 text-left text-xs text-zinc-600">
              <tr>
                <th scope="col" className="px-2 py-2.5 lg:px-3 font-medium">
                  Date
                </th>
                <th scope="col" className="px-2 py-2.5 lg:px-3 font-medium">
                  Client
                </th>
                <th scope="col" className="px-2 py-2.5 lg:px-3 font-medium">
                  Achat
                </th>
                <th scope="col" className="px-2 py-2.5 lg:px-3 font-medium">
                  Inscription liée
                </th>
                <th scope="col" className="px-2 py-2.5 lg:px-3 text-right font-medium">
                  Montant
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.purchaseId}>
                  <tr className="border-t border-border align-top first:border-t-0">
                    <td className="whitespace-nowrap px-2 py-3 lg:px-3">{formatDateShort(row.paidAt, tz)}</td>
                    <td className="min-w-38 px-2 py-3 lg:px-3">
                      <ClientCell row={row} />
                    </td>
                    <td className="px-2 py-3 lg:px-3 wrap-anywhere">{row.label}</td>
                    <td className="px-2 py-3 lg:px-3">
                      <LinkedBooking booking={row.booking} tz={tz} now={now} />
                    </td>
                    <td className="px-2 py-3 lg:px-3 text-right">
                      <Amount row={row} />
                    </td>
                  </tr>
                  {row.closedNotes.length > 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 pb-3 lg:px-3">
                        <ClosedNotes notes={row.closedNotes} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ul aria-label="Vos paiements" className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <li key={row.purchaseId} className="rounded-2xl border border-border bg-card p-4 shadow-(--shadow-card)">
            <div className="flex items-start justify-between gap-3">
              <ClientCell row={row} />
              <Amount row={row} />
            </div>
            <p className="mt-2 text-sm font-medium wrap-anywhere">{row.label}</p>
            <p className="text-xs text-zinc-600">{formatDateShort(row.paidAt, tz)}</p>
            <div className="mt-2 text-sm">
              <p className="text-xs text-zinc-600">Inscription liée</p>
              <LinkedBooking booking={row.booking} tz={tz} now={now} />
            </div>
            {row.closedNotes.length > 0 && (
              <div className="mt-2">
                <ClosedNotes notes={row.closedNotes} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
