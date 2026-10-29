"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRightLeft, ArrowUpRight, Ban, CircleCheck, MapPin, Pencil, RotateCcw, UserMinus, UserPlus } from "lucide-react";

import { BookingStatusBadge } from "@/components/dashboard/booking-status-badge";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { CoverageBadge } from "@/components/dashboard/coverage-badge";
import { FormField } from "@/components/dashboard/form-field";
import { MoveAttendeeDialog } from "@/components/dashboard/move-attendee-dialog";
import { OccurrenceEditForm } from "@/components/dashboard/occurrence-edit-form";
import { RegisterAttendeeDialog } from "@/components/dashboard/register-attendee-dialog";
import { SessionCapacityControl } from "@/components/dashboard/session-capacity-control";
import { TypeChip } from "@/components/dashboard/type-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelOccurrenceCopy,
  restoreOccurrenceCopy,
  unenrollCopy,
  unenrollLabel,
  unenrollReasonHelp,
} from "@/lib/back-office/confirm-copy";
import { formatWhen, plural } from "@/lib/back-office/format";
import { MODE_SHORT_LABELS } from "@/lib/back-office/labels";
import { seatsSummary, unenrolledMessage, type PlanningAttendeeVM, type PlanningItemVM } from "@/lib/back-office/planning-view";
import { REQUEST_FAILED } from "@/lib/pro-messages";
import { BOUNDS } from "@/lib/tickets-vocab";
import { cancelOccurrenceAction, restoreOccurrenceAction, unenrollAction } from "@/server/pro-planning";

type Confirm = { kind: "cancel" } | { kind: "restore" } | { kind: "unenroll"; ids: string[] };

function AttendeeRow({
  attendee,
  isRdv,
  selectable,
  selected,
  disabled,
  onToggle,
  onUnenroll,
  onMove,
}: {
  attendee: PlanningAttendeeVM;
  /** an RDV slot: a lapsed hold freed a « créneau », never a « place » (P5 § 3.14) */
  isRdv: boolean;
  selectable: boolean;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onUnenroll: () => void;
  onMove?: () => void;
}) {
  // An RDV attendee is cancelled with « Annuler le rendez-vous », never « Désinscrire » (P5 D § 3.10).
  const unenrollText = unenrollLabel(isRdv ? "rdv" : "seance");
  return (
    <li className="rounded-xl border border-border p-3 text-sm">
      <div className="flex items-start gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            disabled={disabled}
            aria-label={`Sélectionner ${attendee.name}`}
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <Link
                href={`/dashboard/clients/${attendee.customerId}`}
                className="min-w-0 rounded font-medium text-foreground underline-offset-4 wrap-anywhere hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {attendee.name}
              </Link>
              <span className="min-w-0 truncate text-xs text-muted-foreground" title={attendee.email}>
                {attendee.email}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <CoverageBadge coverage={attendee.coverage} />
              <BookingStatusBadge status={attendee.status} />
              {attendee.moved && <Badge variant="neutral">Déplacé</Badge>}
            </div>
            {attendee.ticketLabel && (
              <p className="mt-2 text-xs text-muted-foreground wrap-anywhere">{attendee.ticketLabel}</p>
            )}
            {attendee.holdLapsed ? (
              <p className="mt-1 text-xs text-zinc-600">
                {isRdv ? "Paiement non finalisé, créneau libéré" : "Paiement non finalisé, place libérée"}
              </p>
            ) : (
              attendee.holdUntil && (
                <p className="mt-1 text-xs text-warning">{`Paiement en cours jusqu'à ${attendee.holdUntil}`}</p>
              )
            )}
            {attendee.answers.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {attendee.answers.map((a, i) => (
                  <li key={`${a.label}-${i}`} className="wrap-anywhere">{`${a.label} : ${a.value}`}</li>
                ))}
              </ul>
            )}
            {attendee.notes && (
              <p className="mt-1 text-xs text-muted-foreground wrap-anywhere">{`Note : ${attendee.notes}`}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1 self-start sm:flex-col sm:items-stretch">
            {onMove && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onMove}
                disabled={disabled}
                aria-label={`Déplacer ${attendee.name}`}
              >
                <ArrowRightLeft />
                Déplacer
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onUnenroll}
              disabled={disabled}
              aria-label={isRdv ? `${unenrollText} de ${attendee.name}` : `${unenrollText} ${attendee.name}`}
            >
              <UserMinus />
              {unenrollText}
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

type DialogProps = {
  item: PlanningItemVM;
  tz: string;
  nowIso: string;
  onClose: (notice?: string) => void;
};

/**
 * A séance or an RDV of the planning. The caller keeps the occurrence's id and
 * passes the item freshly read from the page data, so seats and attendees are
 * never the ones clicked before an action. Every destructive action is behind
 * a ConfirmDialog (texts in confirm-copy.ts); a failure stays in that dialog,
 * a success shows a status line at the top of this one and moves the focus to
 * it (the button that opened the confirmation is usually gone by then).
 * `onClose(notice)` closes the dialog and may hand the page a status line when
 * the séance leaves the page data, in which case this dialog cannot show the
 * line itself: an RDV that is cancelled, or loses its only attendee, is ended
 * and not read any more, and an emptied or restored séance under a time off is
 * hidden. The first case calls `onClose(line)` at once; the second is caught
 * when the page unmounts the dialog while a success line was not yet closed.
 *
 * The state of the dialog (success line, confirmation, selection, reason) belongs
 * to one séance: it is keyed by the occurrence id, so a deep link or a Back/Forward
 * that swaps the séance starts again from nothing. The key sits here, not at the
 * call sites: a dialog that the page unmounts hands its unclosed line to the page,
 * and when another séance replaces it there is nothing to hand over (a key at the
 * call site would close the new séance with the old line).
 */
export function OccurrenceDialog(props: DialogProps) {
  const { item, onClose } = props;
  // The success line the pro has not closed the dialog on yet, and the latest `onClose` for the unmount below.
  const unclosedLine = useRef<string | null>(null);
  const latestOnClose = useRef(onClose);
  useEffect(() => {
    latestOnClose.current = onClose;
  });
  // Declared first: on unmount it runs before the reset below. A replacement by another séance only runs the reset.
  useEffect(
    () => () => {
      if (unclosedLine.current !== null) latestOnClose.current(unclosedLine.current);
    },
    [],
  );
  useEffect(
    () => () => {
      unclosedLine.current = null;
    },
    [item.id],
  );
  return (
    <OccurrenceDialogBody
      key={item.id}
      {...props}
      onLine={(line) => {
        unclosedLine.current = line;
      }}
    />
  );
}

function OccurrenceDialogBody({
  item,
  tz,
  nowIso,
  onClose,
  onLine,
}: DialogProps & { onLine: (line: string | null) => void }) {
  const summaryId = useId();
  const reasonId = useId();
  const registerHelpId = useId();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const refocusEditButton = useRef(false);
  const [done, setDone] = useState<{ text: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  // True while the edit form has a request in flight: the dialog cannot be left then.
  const [editBusy, setEditBusy] = useState(false);
  const [moving, setMoving] = useState<{ bookingId: string; customerName: string } | null>(null);
  const [registering, setRegistering] = useState(false);

  // An action that answers after this séance was swapped for another one must not touch the page any more.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A new success line takes the focus: the button that opened the confirmation has left the page by then.
  useEffect(() => {
    if (done) statusRef.current?.focus();
  }, [done]);

  // Back from the edit form without saving: the button that opened it takes the focus back (it was unmounted meanwhile).
  useEffect(() => {
    if (!editing && refocusEditButton.current) {
      refocusEditButton.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  const cancelled = item.status === "cancelled";
  const scheduled = item.status === "scheduled";
  const isSeance = item.kind === "seance";
  // An RDV has no location (P5 O12): its dialog shows no place row at all, rather than « Lieu non précisé ».
  const place = !isSeance
    ? null
    : item.location
      ? `Lieu : ${item.location}${item.locationOverride !== null ? " (pour cette séance)" : ""}`
      : "Lieu non précisé";

  // Selection by booking id, limited to the rows still there after a refresh.
  const selected = item.attendees.filter((a) => picked.includes(a.bookingId));

  const peopleOf = (ids: string[]) => item.attendees.filter((a) => ids.includes(a.bookingId));
  // A lapsed hold is a seat already freed and a payment already dead: the texts count the live bookings only.
  const copy = (() => {
    if (!confirm) return null;
    if (confirm.kind === "cancel") {
      const live = item.attendees.filter((a) => !a.holdLapsed);
      // only a booking that holds a ticket gets it back (a free, guest or paid place has none)
      const tickets = live.filter((a) => a.coverage === "ticket" && a.status === "confirmed").length;
      return cancelOccurrenceCopy({ kind: item.kind, registrants: live.length, tickets, past: item.past });
    }
    if (confirm.kind === "restore") return restoreOccurrenceCopy();
    const people = peopleOf(confirm.ids);
    // Everyone chosen has left the page data meanwhile: there is nothing left to confirm.
    if (people.length === 0) return null;
    return unenrollCopy({
      kind: item.kind,
      names: people.map((p) => p.name),
      ticketCount: people.filter((p) => p.coverage === "ticket" && p.status === "confirmed").length,
      pendingCount: people.filter((p) => p.status === "pending" && !p.holdLapsed).length,
    });
  })();
  const confirming = confirm !== null && copy !== null;

  function closeConfirm() {
    if (pending) return;
    setConfirm(null);
    setError(null);
    setReason("");
  }

  // `Dialog` calls its onClose with the click event (backdrop, close button): never pass `onClose` itself, it reads a notice.
  // Escape and the backdrop close a sub-dialog (the confirmation, « Déplacer », « Inscrire ») first, never both dialogs at once.
  function closeSelf() {
    if (confirming || pending || moving !== null || registering) return;
    onLine(null);
    onClose();
  }

  // « Modifier cette séance » swaps the body of the dialog for the form; Escape, the backdrop and the close button go
  // back to the details (never close the whole séance dialog) and the button that opened the form takes the focus back.
  function leaveEdit() {
    if (editBusy) return;
    refocusEditButton.current = true;
    setEditing(false);
  }

  // The success line of an edit or of a move, shown in the details and handed to the page if the séance leaves its data.
  function announce(text: string) {
    if (!alive.current) return;
    onLine(text);
    setDone({ text });
  }

  function run() {
    if (!confirm || pending) return;
    const action = confirm;
    const people = action.kind === "unenroll" ? peopleOf(action.ids) : [];
    setError(null);
    startTransition(async () => {
      try {
        let text: string;
        if (action.kind === "cancel") {
          const res = await cancelOccurrenceAction({ occurrenceId: item.id });
          if (!res.ok) {
            setError(res.error);
            return;
          }
          text =
            item.kind === "rdv"
              ? "Rendez-vous annulé. Le client est prévenu par email."
              : res.bookingsCancelled > 0
                ? "Séance annulée. Les inscrits sont prévenus par email."
                : "Séance annulée.";
        } else if (action.kind === "restore") {
          const res = await restoreOccurrenceAction({ occurrenceId: item.id });
          if (!res.ok) {
            setError(res.error);
            return;
          }
          text = "Séance rétablie.";
        } else {
          const res = await unenrollAction({
            occurrenceId: item.id,
            bookingIds: people.map((p) => p.bookingId),
            reason: reason.trim() === "" ? null : reason.trim(),
          });
          if (!res.ok) {
            setError(res.error);
            return;
          }
          text = unenrolledMessage(
            people.map((p) => p.name),
            res.cancelled,
            res.ticketsReturned,
            item.kind,
          );
          setPicked([]);
          setReason("");
        }
        if (!alive.current) return;
        if (item.kind === "rdv") {
          // The RDV is ended and leaves the page data: the calendar shows the line, this dialog goes away.
          onLine(null);
          onClose(text);
          return;
        }
        onLine(text);
        setDone({ text });
        setConfirm(null);
      } catch {
        setError(REQUEST_FAILED);
      }
    });
  }

  // The edit view is a Dialog at the same place of the tree as the details one, so React keeps the same dialog (and the
  // element it hands the focus back to when it closes) and only swaps what is inside.
  if (editing && isSeance && scheduled) {
    return (
      <Dialog open onClose={leaveEdit} title={item.title}>
        <OccurrenceEditForm
          item={item}
          tz={tz}
          nowIso={nowIso}
          onCancel={leaveEdit}
          onBusyChange={setEditBusy}
          onDone={(text) => {
            setEditing(false);
            announce(text);
          }}
        />
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open onClose={closeSelf} title={item.title} describedBy={summaryId}>
        {done && (
          <p
            ref={statusRef}
            role="status"
            tabIndex={-1}
            className="mb-3 flex items-start gap-2 rounded-xl bg-success-muted px-3 py-2 text-sm text-foreground wrap-anywhere focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            {done.text}
          </p>
        )}

        <div id={summaryId} className="grid gap-3">
          <p className="text-sm text-foreground">{formatWhen(new Date(item.startsAt), new Date(item.endsAt), tz)}</p>
          {place !== null && (
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 wrap-anywhere">{place}</span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {cancelled && <Badge variant="destructive">{isSeance ? "Annulée" : "Annulé"}</Badge>}
            {isSeance && item.bookingMode && <Badge variant="outline">{MODE_SHORT_LABELS[item.bookingMode]}</Badge>}
            {item.isPrivate && <Badge variant="neutral">Privé</Badge>}
            {item.acceptedTypes.map((t) => (
              <TypeChip key={t.id} name={t.name} color={t.color} />
            ))}
          </div>
          {isSeance && (
            <p className="text-sm font-medium tabular-nums">
              {seatsSummary(item)}
            </p>
          )}
        </div>

        {isSeance && scheduled && (
          <div className="mt-3 rounded-xl bg-muted/50 p-3">
            <SessionCapacityControl
              occurrenceId={item.id}
              seenStartsAt={item.startsAt}
              capacity={item.capacity}
              seatsTaken={item.seatsTaken}
              seenVersion={item.eventVersion}
              recurring={item.recurring}
            />
          </div>
        )}

        {isSeance && (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              variant="secondary"
              size="sm"
              disabled={!scheduled || pending}
              aria-describedby={cancelled ? registerHelpId : undefined}
              onClick={() => {
                setDone(null);
                onLine(null);
                setRegistering(true);
              }}
            >
              <UserPlus />
              Inscrire
            </Button>
            {cancelled && (
              // A past séance cannot be restored (no « Rétablir » then): the line must not point to a button that is not there.
              <p id={registerHelpId} className="text-xs text-zinc-600">
                {item.canRestore
                  ? "Rétablissez la séance pour inscrire quelqu'un."
                  : "Une séance annulée ne prend plus d'inscription."}
              </p>
            )}
          </div>
        )}

        {selected.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2">
            <span className="text-sm text-foreground">{plural(selected.length, "sélectionné", "sélectionnés")}</span>
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => setConfirm({ kind: "unenroll", ids: selected.map((a) => a.bookingId) })}
            >
              {`Désinscrire la sélection (${selected.length})`}
            </Button>
          </div>
        )}

        {item.attendees.length === 0 ? (
          <p className="mt-4 rounded-xl bg-muted/60 px-3 py-4 text-sm text-muted-foreground">
            Personne n&apos;est inscrit pour le moment.
          </p>
        ) : (
          <ul className="mt-4 grid gap-2" aria-label={isSeance ? "Inscrits" : "Client"}>
            {item.attendees.map((a) => (
              <AttendeeRow
                key={a.bookingId}
                attendee={a}
                isRdv={!isSeance}
                selectable={isSeance}
                selected={picked.includes(a.bookingId)}
                disabled={pending}
                onToggle={() =>
                  setPicked((ids) =>
                    ids.includes(a.bookingId) ? ids.filter((id) => id !== a.bookingId) : [...ids, a.bookingId],
                  )
                }
                onUnenroll={() => setConfirm({ kind: "unenroll", ids: [a.bookingId] })}
                onMove={
                  isSeance && scheduled && a.status === "confirmed"
                    ? () => setMoving({ bookingId: a.bookingId, customerName: a.name })
                    : undefined
                }
              />
            ))}
          </ul>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {isSeance && scheduled && (
              <Button
                ref={editButtonRef}
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setDone(null);
                  onLine(null);
                  setEditing(true);
                }}
              >
                <Pencil />
                Modifier cette séance
              </Button>
            )}
            {scheduled && (
              <Button
                variant="outline"
                size="sm"
                className="text-rose-700"
                disabled={pending}
                onClick={() => setConfirm({ kind: "cancel" })}
              >
                <Ban />
                {isSeance ? "Annuler la séance" : "Annuler le rendez-vous"}
              </Button>
            )}
            {item.canRestore && (
              <Button variant="secondary" size="sm" disabled={pending} onClick={() => setConfirm({ kind: "restore" })}>
                <RotateCcw />
                Rétablir
              </Button>
            )}
          </div>
          {isSeance && item.eventId && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/dashboard/events/${item.eventId}`}>
                Ouvrir l&apos;événement
                <ArrowUpRight />
              </Link>
            </Button>
          )}
        </div>
      </Dialog>

      {confirm && copy && (
        <ConfirmDialog
          open
          copy={copy}
          tone={confirm.kind === "restore" ? "primary" : "destructive"}
          pending={pending}
          error={error}
          onConfirm={run}
          onClose={closeConfirm}
        >
          {confirm.kind === "unenroll" && (
            <FormField
              label="Motif"
              htmlFor={reasonId}
              optional
              help={unenrollReasonHelp({ count: peopleOf(confirm.ids).length })}
            >
              <Textarea
                id={reasonId}
                value={reason}
                maxLength={BOUNDS.note}
                rows={2}
                disabled={pending}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>
          )}
        </ConfirmDialog>
      )}

      {moving && (
        <MoveAttendeeDialog
          bookingId={moving.bookingId}
          customerName={moving.customerName}
          onClose={() => setMoving(null)}
          onDone={(text) => {
            setMoving(null);
            announce(text);
          }}
        />
      )}

      {registering && (
        <RegisterAttendeeDialog
          item={item}
          onClose={() => setRegistering(false)}
          onDone={(text) => {
            setRegistering(false);
            announce(text);
          }}
        />
      )}
    </>
  );
}
