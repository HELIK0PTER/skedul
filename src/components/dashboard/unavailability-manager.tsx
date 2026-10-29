"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, CircleCheck, Loader2, Plus, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { Switch } from "@/components/dashboard/switch";
import { TimeOffConflictDialog } from "@/components/dashboard/time-off-conflict-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deleteTimeOffCopy } from "@/lib/back-office/confirm-copy";
import { plural } from "@/lib/back-office/format";
import { dayLongLabel } from "@/lib/back-office/planning-view";
import type { TimeOffConflictVM, TimeOffForm } from "@/lib/back-office/time-off-actions";
import {
  addDays,
  addMonthsClamped,
  daysInMonth,
  diffDays,
  isDateKey,
  makeKey,
  mondayOf,
  parseKey,
  type DateKey,
} from "@/lib/civil-date";
import { REQUEST_FAILED } from "@/lib/pro-messages";
import { cn } from "@/lib/utils";
import { createTimeOffAction, deleteTimeOffAction, previewTimeOffAction } from "@/server/pro-planning";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTH_FORMAT = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

const TIMES_REQUIRED = "Indiquez l'heure de début et l'heure de fin.";
/** The registrations changed between the preview and the creation, and the new preview lists none: nothing to choose, the pro asks again. */
const STALE_NOTHING_LEFT = "Des inscriptions ont changé pendant la vérification : cliquez de nouveau sur « Ajouter ».";

export interface TimeOffEntry {
  id: string;
  label: string;
  allDay: boolean;
  reason: string | null;
}

/** The conflicts the pro is looking at, with the exact form they were computed for. */
type Review = { form: TimeOffForm; conflicts: TimeOffConflictVM[] };

/** "09:00" to minutes from midnight; null for an empty or malformed field. */
function parseTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** First day of the month of `key`. */
function monthOf(key: DateKey): DateKey {
  const { y, m } = parseKey(key);
  return makeKey(y, m, 1);
}

/** The Monday-first weeks that cover the month of `month`, as a flat list of days. */
function monthDays(month: DateKey): DateKey[] {
  const { y, m } = parseKey(month);
  const start = mondayOf(makeKey(y, m, 1));
  const end = addDays(mondayOf(makeKey(y, m, daysInMonth(y, m))), 6);
  return Array.from({ length: diffDays(start, end) + 1 }, (_, i) => addDays(start, i));
}

/** « lundi 3 novembre 2026 », « dimanche 1er novembre 2026 ». */
function dayLabel(day: DateKey): string {
  return `${dayLongLabel(day)} ${parseKey(day).y}`;
}

export function UnavailabilityManager({
  markedDays,
  entries,
  todayKey,
}: {
  markedDays: DateKey[];
  entries: TimeOffEntry[];
  todayKey: DateKey;
}) {
  const [pending, startTransition] = useTransition();
  /** True while a request runs: a second click before the buttons re-render must not send a second request. */
  const inFlight = useRef(false);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const noticeBox = useRef<HTMLDivElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped with each failure of a server call: the effect below puts the focus on the error box once it is rendered. */
  const [errorFocus, setErrorFocus] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  /** Bumped with each success line, even when its text repeats (two deletions in a row): the effect below focuses it. */
  const [noticeFocus, setNoticeFocus] = useState(0);
  const [viewMonth, setViewMonth] = useState<DateKey>(() => monthOf(todayKey));
  const [startDate, setStartDate] = useState<string>(todayKey);
  const [endDate, setEndDate] = useState<string>(todayKey);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [reason, setReason] = useState("");
  // which bound the next calendar click sets; "end" right after a start is picked
  const [picking, setPicking] = useState<"start" | "end">("start");
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // The buttons are disabled while a call runs, which drops the focus on the page: a keyboard or screen-reader user lands on the message.
  useEffect(() => {
    if (errorFocus > 0) errorBox.current?.focus();
  }, [errorFocus]);
  // A new success line takes the focus too: the button that started the action (or the dialog) has gone by then.
  useEffect(() => {
    if (noticeFocus > 0) noticeBox.current?.focus();
  }, [noticeFocus]);

  const marked = useMemo(() => new Set(markedDays), [markedDays]);
  const grid = useMemo(() => monthDays(viewMonth), [viewMonth]);
  const labels = useMemo(() => new Map(grid.map((day) => [day, dayLabel(day)])), [grid]);

  const choosingEnd = allDay && picking === "end";
  // while choosing the end, hovering a later day previews the range
  const previewing = choosingEnd && hoverKey !== null && hoverKey >= startDate;
  const shownEnd = previewing ? hoverKey : allDay ? endDate : startDate;

  /** An edit drops the message of the previous attempt: the next submit validates everything again. */
  function edited() {
    setError(null);
    setNotice(null);
  }

  function fail(message: string) {
    setError(message);
    setErrorFocus((n) => n + 1);
  }

  function succeed(message: string) {
    setNotice(message);
    setNoticeFocus((n) => n + 1);
  }

  function pickDay(day: DateKey) {
    edited();
    if (!allDay) {
      setStartDate(day);
      setEndDate(day);
      return;
    }
    if (picking === "end" && day >= startDate) {
      setEndDate(day);
      setPicking("start");
      return;
    }
    // first click, or a day before the current start: the range restarts there
    setStartDate(day);
    setEndDate(day);
    setPicking("end");
  }

  function showMonthOf(key: string) {
    if (isDateKey(key)) setViewMonth(monthOf(key));
  }

  function formOf(): TimeOffForm | null {
    const trimmed = reason.trim();
    const note = trimmed === "" ? undefined : trimmed;
    if (allDay) return { startDate, endDate, allDay: true, reason: note };
    const startMinute = parseTime(startTime);
    const endMinute = parseTime(endTime);
    if (startMinute === null || endMinute === null) return null;
    return { startDate, endDate: startDate, allDay: false, startMinute, endMinute, reason: note };
  }

  /** After a `stale` answer: ask the engine again and keep the dialog open on the new list. */
  async function reviewAgain(form: TimeOffForm, message: string) {
    const preview = await previewTimeOffAction(form);
    if (!preview.ok) {
      setReview(null);
      fail(preview.error);
      return;
    }
    if (preview.conflicts.length === 0) {
      setReview(null);
      fail(STALE_NOTHING_LEFT);
      return;
    }
    setReview({ form, conflicts: preview.conflicts });
    setReviewError(message);
  }

  function added(cancelled: number) {
    setReview(null);
    setReviewError(null);
    setReason("");
    setPicking("start");
    succeed(
      cancelled > 0
        ? `Indisponibilité ajoutée. ${plural(cancelled, "séance annulée", "séances annulées")}.`
        : "Indisponibilité ajoutée.",
    );
  }

  function submit() {
    if (pending || inFlight.current) return;
    edited();
    const form = formOf();
    if (form === null) {
      fail(TIMES_REQUIRED);
      return;
    }
    inFlight.current = true;
    startTransition(async () => {
      try {
        const preview = await previewTimeOffAction(form);
        if (!preview.ok) {
          fail(preview.error);
          return;
        }
        if (preview.conflicts.length > 0) {
          setReviewError(null);
          setReview({ form, conflicts: preview.conflicts });
          return;
        }
        const res = await createTimeOffAction({ ...form, seenOccurrenceIds: [], cancelBooked: false });
        if (!res.ok) {
          if (res.code === "stale") await reviewAgain(form, res.error);
          else fail(res.error);
          return;
        }
        added(0);
      } catch {
        fail(REQUEST_FAILED);
      } finally {
        inFlight.current = false;
      }
    });
  }

  function resolve(cancelBooked: boolean) {
    if (review === null || pending || inFlight.current) return;
    const { form, conflicts } = review;
    setReviewError(null);
    inFlight.current = true;
    startTransition(async () => {
      try {
        const res = await createTimeOffAction({
          ...form,
          seenOccurrenceIds: conflicts.map((c) => c.occurrenceId),
          cancelBooked,
        });
        if (res.ok) added(res.cancelledOccurrences);
        else if (res.code === "stale") await reviewAgain(form, res.error);
        else setReviewError(res.error);
      } catch {
        setReviewError(REQUEST_FAILED);
      } finally {
        inFlight.current = false;
      }
    });
  }

  function confirmDelete() {
    if (toDelete === null || pending || inFlight.current) return;
    const timeOffId = toDelete;
    setDeleteError(null);
    inFlight.current = true;
    startTransition(async () => {
      try {
        const res = await deleteTimeOffAction({ timeOffId });
        if (!res.ok) {
          setDeleteError(res.error);
          return;
        }
        setToDelete(null);
        succeed("Indisponibilité supprimée.");
      } catch {
        setDeleteError(REQUEST_FAILED);
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Calendar */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Mois précédent"
              onClick={() => setViewMonth((m) => addMonthsClamped(m, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm font-semibold capitalize">
              {MONTH_FORMAT.format(new Date(`${viewMonth.slice(0, 7)}-01T12:00:00Z`))}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Mois suivant"
              onClick={() => setViewMonth((m) => addMonthsClamped(m, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <p className="mb-2 text-center text-xs text-zinc-600" aria-live="polite">
            {!allDay
              ? "Choisissez le jour."
              : picking === "start"
                ? "Choisissez le premier jour."
                : "Choisissez le dernier jour, ou le même pour une seule journée."}
          </p>

          <div className="grid grid-cols-7 text-center text-xs text-zinc-600">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-y-1" onMouseLeave={() => setHoverKey(null)}>
            {grid.map((day, i) => {
              const inMonth = day.slice(0, 7) === viewMonth.slice(0, 7);
              const past = day < todayKey;
              const isMarked = marked.has(day);
              const isStart = day === startDate;
              const isEnd = day === shownEnd;
              const inBand = shownEnd > startDate && day >= startDate && day <= shownEnd;
              const solid = isStart || (isEnd && !previewing);
              const col = i % 7;
              return (
                <div key={day} className="relative">
                  {/* range band; half-width on the bounds so it tucks under them */}
                  {inBand && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-y-0 bg-primary-muted",
                        isStart ? "left-1/2" : "left-0",
                        isEnd ? "right-1/2" : "right-0",
                        col === 0 && "rounded-l-lg",
                        col === 6 && "rounded-r-lg",
                      )}
                    />
                  )}
                  <button
                    type="button"
                    disabled={past || pending}
                    onClick={() => pickDay(day)}
                    onMouseEnter={() => setHoverKey(day)}
                    aria-label={`${labels.get(day) ?? day}${isMarked ? " (indisponibilité existante)" : ""}`}
                    aria-pressed={isStart || isEnd}
                    className={cn(
                      "relative flex aspect-square w-full items-center justify-center rounded-lg text-sm transition-colors",
                      !inMonth && "text-zinc-500",
                      past && "cursor-not-allowed opacity-40",
                      inBand && !solid && "text-accent-foreground",
                      !solid && !past && (inBand ? "hover:bg-primary/15" : "hover:bg-muted"),
                      solid && "bg-primary font-medium text-primary-foreground",
                      isEnd && previewing && !isStart && "ring-2 ring-inset ring-primary",
                    )}
                  >
                    {parseKey(day).d}
                    {isMarked && (
                      <span
                        aria-hidden
                        className={cn(
                          "absolute bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full",
                          solid ? "bg-primary-foreground" : "bg-primary",
                        )}
                      />
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
            <span className="flex items-center gap-2">
              <span className="inline-block size-3 rounded bg-primary" aria-hidden="true" />
              Période sélectionnée
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-flex size-3 items-center justify-center" aria-hidden="true">
                <span className="size-1.5 rounded-full bg-primary" />
              </span>
              Indisponibilité existante
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Add form + list */}
      <div className="space-y-6">
        <Card>
          <CardContent className="p-4">
            <form
              method="post"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="space-y-4"
            >
              <h2 className="text-sm font-semibold">Ajouter une indisponibilité</h2>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Du" htmlFor="timeoff-start">
                  <Input
                    id="timeoff-start"
                    type="date"
                    value={startDate}
                    min={todayKey}
                    disabled={pending}
                    onFocus={() => setPicking("start")}
                    onChange={(e) => {
                      const value = e.target.value;
                      edited();
                      setStartDate(value);
                      setEndDate((prev) => (prev < value ? value : prev));
                      showMonthOf(value);
                    }}
                  />
                </FormField>
                <FormField label="Au" htmlFor="timeoff-end">
                  <Input
                    id="timeoff-end"
                    type="date"
                    value={allDay ? endDate : startDate}
                    min={startDate}
                    disabled={!allDay || pending}
                    onFocus={() => setPicking("end")}
                    onChange={(e) => {
                      edited();
                      setEndDate(e.target.value);
                      showMonthOf(e.target.value);
                    }}
                  />
                </FormField>
              </div>

              <Switch
                id="timeoff-allday"
                checked={allDay}
                onCheckedChange={(value) => {
                  edited();
                  setAllDay(value);
                  setPicking("start");
                }}
                label="Toute la journée"
                disabled={pending}
              />

              {!allDay && (
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Début" htmlFor="timeoff-stime">
                    <Input
                      id="timeoff-stime"
                      type="time"
                      value={startTime}
                      disabled={pending}
                      onChange={(e) => {
                        edited();
                        setStartTime(e.target.value);
                      }}
                    />
                  </FormField>
                  <FormField label="Fin" htmlFor="timeoff-etime">
                    <Input
                      id="timeoff-etime"
                      type="time"
                      value={endTime}
                      disabled={pending}
                      onChange={(e) => {
                        edited();
                        setEndTime(e.target.value);
                      }}
                    />
                  </FormField>
                </div>
              )}

              <FormField label="Motif" htmlFor="timeoff-reason" optional>
                <Input
                  id="timeoff-reason"
                  value={reason}
                  disabled={pending}
                  onChange={(e) => {
                    edited();
                    setReason(e.target.value);
                  }}
                />
              </FormField>

              <FormError message={error} ref={errorBox} tabIndex={-1} />
              <div
                ref={noticeBox}
                role="status"
                tabIndex={-1}
                className={cn(
                  notice &&
                    "flex items-start gap-2 rounded-xl bg-success-muted px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                {notice && (
                  <>
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-green-700" aria-hidden="true" />
                    {notice}
                  </>
                )}
              </div>

              <Button ref={submitButton} type="submit" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
                Ajouter
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h2 className="mb-3 text-sm font-semibold">À venir</h2>
            {entries.length === 0 ? (
              <p className="text-sm text-zinc-600">Aucune indisponibilité programmée.</p>
            ) : (
              <ul className="space-y-2">
                {entries.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium first-letter:uppercase">{e.label}</p>
                      {e.reason && <p className="break-words text-xs text-zinc-600">{e.reason}</p>}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      aria-label={`Supprimer l'indisponibilité : ${e.label}${e.reason ? `, ${e.reason}` : ""}`}
                      disabled={pending}
                      onClick={() => {
                        setDeleteError(null);
                        setToDelete(e.id);
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <TimeOffConflictDialog
        open={review !== null}
        conflicts={review?.conflicts ?? []}
        pending={pending}
        error={reviewError}
        onCancelThem={() => resolve(true)}
        onKeep={() => resolve(false)}
        onClose={() => {
          setReview(null);
          setReviewError(null);
          // The button that opened the dialog was disabled while the preview ran, so the dialog has no opener to give the focus back to.
          submitButton.current?.focus();
        }}
      />
      <ConfirmDialog
        open={toDelete !== null}
        copy={deleteTimeOffCopy()}
        pending={pending}
        error={deleteError}
        onConfirm={confirmDelete}
        onClose={() => {
          setToDelete(null);
          setDeleteError(null);
        }}
      />
    </div>
  );
}
