"use client";

import Link from "next/link";
import { startTransition, useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";

import { BookingStatusBadge } from "@/components/dashboard/booking-status-badge";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { CoverageBadge } from "@/components/dashboard/coverage-badge";
import { MoveAttendeeDialog } from "@/components/dashboard/move-attendee-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ClientBookingRow } from "@/lib/back-office/client-reads";
import { unenrollCopy } from "@/lib/back-office/confirm-copy";
import { formatCount } from "@/lib/back-office/format";
import { unenrolledMessage } from "@/lib/back-office/planning-view";
import { REQUEST_FAILED } from "@/lib/pro-messages";
import { unenrollAction } from "@/server/pro-planning";

/**
 * One list of registrations. « Déplacer » and « Désinscrire » come from the read (`canMove`, `canUnenroll`): a
 * cancelled or expired registration (a lapsed payment hold, already freed by the engine) offers neither.
 */
function BookingList({
  rows,
  onMove,
  onUnenroll,
}: {
  rows: ClientBookingRow[];
  onMove: (bookingId: string) => void;
  onUnenroll: (bookingId: string) => void;
}) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li key={row.bookingId} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium wrap-anywhere">{row.title}</p>
            <p className="text-xs text-zinc-600">{row.whenLabel}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <CoverageBadge coverage={row.coverage} />
              <BookingStatusBadge status={row.status} />
              {row.ticketTypeName && (
                <Badge variant="outline" className="max-w-full wrap-anywhere">
                  {row.ticketTypeName}
                </Badge>
              )}
              {row.moved && <Badge variant="neutral">Déplacé</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={row.planningHref}>Voir dans le planning</Link>
            </Button>
            {row.canMove && (
              <Button type="button" size="sm" variant="secondary" onClick={() => onMove(row.bookingId)}>
                Déplacer
              </Button>
            )}
            {row.canUnenroll && (
              <Button type="button" size="sm" variant="secondary" onClick={() => onUnenroll(row.bookingId)}>
                Désinscrire
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** « Inscriptions »: what the client is signed up to, to come then past, with « Voir dans le planning », « Déplacer » and « Désinscrire ». */
export function ClientBookings({
  customerName,
  upcoming,
  past,
}: {
  customerName: string;
  upcoming: ClientBookingRow[];
  past: ClientBookingRow[];
}) {
  // The dialogs hold a booking id and look the row up on every render: after an action the page brings new rows,
  // and a dialog never shows a stale one. Only one of the two is open at a time.
  const [moveId, setMoveId] = useState<string | null>(null);
  const [unenrollId, setUnenrollId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startAction] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Bumped when an action succeeded: the effect below keeps the keyboard focus on the page if the button is gone. */
  const [doneCount, setDoneCount] = useState(0);
  const noticeBox = useRef<HTMLDivElement>(null);

  const all = [...upcoming, ...past];
  const moving = moveId === null ? null : (all.find((r) => r.bookingId === moveId) ?? null);
  const unenrolling = unenrollId === null ? null : (all.find((r) => r.bookingId === unenrollId) ?? null);
  const rowsKey = all.map((r) => `${r.bookingId}:${r.status}`).join();

  // The dialog hands the focus back to the button that opened it. After a success that button may be gone (a cancelled
  // registration moves to « Passées », which has neither action): the focus fell on the page, it goes to the line that
  // says what happened. The check runs again when the rows change, as the new page may arrive after the dialog closed.
  useEffect(() => {
    if (doneCount === 0) return;
    const active = document.activeElement;
    if (active === null || active === document.body) noticeBox.current?.focus();
  }, [doneCount, rowsKey]);

  function openMove(bookingId: string) {
    setNotice(null);
    setUnenrollId(null);
    setMoveId(bookingId);
  }

  function openUnenroll(bookingId: string) {
    setNotice(null);
    setError(null);
    setMoveId(null);
    setUnenrollId(bookingId);
  }

  function closeUnenroll() {
    setUnenrollId(null);
    setError(null);
  }

  function confirmUnenroll() {
    if (unenrolling === null || pending) return;
    const { occurrenceId, bookingId } = unenrolling;
    setError(null);
    startAction(async () => {
      let res: Awaited<ReturnType<typeof unenrollAction>>;
      try {
        res = await unenrollAction({ occurrenceId, bookingIds: [bookingId], reason: null });
      } catch {
        res = { ok: false, error: REQUEST_FAILED };
      }
      // After an await the updates leave the transition: wrapped again, they commit together with the new rows.
      startTransition(() => {
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setUnenrollId(null);
        setNotice(unenrolledMessage([customerName], res.cancelled, res.ticketsReturned));
        setDoneCount((n) => n + 1);
      });
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inscriptions</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Always mounted, so that a screen reader announces the text when it appears. */}
        <div ref={noticeBox} role="status" tabIndex={-1} className="outline-none">
          {notice && (
            <p className="mb-4 flex items-start gap-1.5 text-sm text-foreground wrap-anywhere">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-700" aria-hidden />
              {notice}
            </p>
          )}
        </div>

        {all.length === 0 ? (
          <p className="text-sm text-zinc-600">Aucune inscription.</p>
        ) : (
          <div className="space-y-4">
            <section>
              <h4 className="text-sm font-medium">À venir</h4>
              {upcoming.length === 0 ? (
                <p className="mt-1 text-sm text-zinc-600">Aucune inscription à venir.</p>
              ) : (
                <BookingList rows={upcoming} onMove={openMove} onUnenroll={openUnenroll} />
              )}
            </section>
            {past.length > 0 && (
              <details>
                <summary className="cursor-pointer rounded text-sm font-medium text-zinc-600 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {`Passées (${formatCount(past.length)})`}
                </summary>
                <BookingList rows={past} onMove={openMove} onUnenroll={openUnenroll} />
              </details>
            )}
          </div>
        )}
      </CardContent>

      {moving && (
        <MoveAttendeeDialog
          bookingId={moving.bookingId}
          customerName={customerName}
          onClose={() => setMoveId(null)}
          onDone={(message) => {
            setMoveId(null);
            setNotice(message);
            setDoneCount((n) => n + 1);
          }}
        />
      )}
      <ConfirmDialog
        open={unenrolling !== null}
        copy={unenrollCopy({
          names: [customerName],
          ticketCount: unenrolling?.hasTicket ? 1 : 0,
          pendingCount: unenrolling?.pending ? 1 : 0,
        })}
        pending={pending}
        error={error}
        onConfirm={confirmUnenroll}
        onClose={closeUnenroll}
      />
    </Card>
  );
}
