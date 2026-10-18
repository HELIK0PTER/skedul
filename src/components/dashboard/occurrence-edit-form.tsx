"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changedKeys, withoutErrorsUnder } from "@/lib/back-office/form-errors";
import type { PlanningItemVM } from "@/lib/back-office/planning-view";
import { formatDayMonth, todayKey } from "@/lib/civil-date";
import { minutesToLabel } from "@/lib/datetime";
import { REQUEST_FAILED } from "@/lib/pro-messages";
import { BOUNDS } from "@/lib/tickets-vocab";
import {
  applyFollowingAction,
  expiringBeforeAction,
  previewFollowingAction,
  updateOccurrenceAction,
} from "@/server/pro-planning";

type ExpiringBooking = { bookingId: string; customerName: string; expiryText: string };
/** The expiring-ticket list is only valid for the date and time it was computed for (`key`). */
type ExpiringState = { key: string; bookings: ExpiringBooking[] };
/** The « suivantes » preview is only valid for the time and duration it was computed for (`key`). */
type FollowingState = { key: string; text: string; fromDate: string };
type ExpiredChoice = "keep" | "unenroll";
/** Which request is running, so that the spinner sits on the button the pro pressed. */
type Running = "save" | "preview" | "apply";
/** Where the focus goes once the next render is on screen (the button that was pressed is disabled by then). */
type Attention = { target: "field" | "error" | "expiring" | "preview" };

type FormValue = { date: string; time: string; duration: string; place: string };
/** The error keys that editing each field resolves (a field added to FormValue must be listed here). */
const ERROR_KEYS: Record<keyof FormValue, readonly string[]> = {
  date: ["date"],
  time: ["time"],
  duration: ["duration"],
  place: [],
};

const DATE_FIELD_ERROR = "Indiquez une date.";
const DATE_ERROR = "Date : indiquez une date.";
const TIME_FIELD_ERROR = "Indiquez une heure.";
const TIME_ERROR = "Heure de début : indiquez une heure.";
const DURATION_RANGE = `${BOUNDS.eventDurationMin.min} à ${BOUNDS.eventDurationMin.max} minutes, par pas de ${BOUNDS.eventDurationMin.step}`;
const DURATION_HELP = `De ${DURATION_RANGE}.`;
const DURATION_FIELD_ERROR = "Indiquez une durée valide.";
const DURATION_ERROR = `Durée : indiquez une durée valide (de ${DURATION_RANGE}).`;
const STARTED_NOTE = "Cette séance a commencé : seul le lieu se modifie ici.";

/** "19:30" to minutes from midnight; null for an empty or malformed field. */
function parseTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Length of the séance in minutes, from its two ISO instants. */
function durationOf(item: PlanningItemVM): number {
  return Math.round((Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60_000);
}

/**
 * « Modifier cette séance »: date, time, duration and place of ONE séance, or its time and duration for the following ones.
 * Every derived value (what changed, which preview is still valid) is computed while rendering from the inputs, so no
 * effect sets state. `onBusyChange` tells the dialog around the form that a request is running: it must not close then.
 */
export function OccurrenceEditForm({
  item,
  tz,
  nowIso,
  onDone,
  onCancel,
  onBusyChange,
}: {
  item: PlanningItemVM;
  tz: string;
  nowIso: string;
  onDone: (message: string) => void;
  onCancel: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const expiringBox = useRef<HTMLDivElement>(null);
  const previewBox = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<Running | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [attention, setAttention] = useState<Attention | null>(null);

  const currentDuration = durationOf(item);
  const initialTime = minutesToLabel(item.startMinute);
  const [value, setValue] = useState<FormValue>({
    date: item.dayKey,
    time: initialTime,
    duration: String(currentDuration),
    place: item.locationOverride ?? "",
  });
  const { date, time, duration, place } = value;
  const [choice, setChoice] = useState<ExpiredChoice>("keep");
  const [expiring, setExpiring] = useState<ExpiringState | null>(null);
  const [following, setFollowing] = useState<FollowingState | null>(null);

  const today = todayKey(new Date(nowIso), tz);
  const minute = parseTime(time);
  const durationValue = Number(duration);
  const durationValid =
    duration.trim() !== "" &&
    Number.isInteger(durationValue) &&
    durationValue >= BOUNDS.eventDurationMin.min &&
    durationValue <= BOUNDS.eventDurationMin.max &&
    durationValue % BOUNDS.eventDurationMin.step === 0;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const placeValue = place.trim() === "" ? null : place.trim();

  // A cleared or malformed field counts as a change: « Enregistrer » then says what is wrong instead of staying dead.
  const dateChanged = date !== item.dayKey;
  const timeChanged = time !== initialTime;
  const startChanged = dateChanged || timeChanged;
  const durationChanged = durationValid ? durationValue !== currentDuration : duration.trim() !== String(currentDuration);
  const placeChanged = placeValue !== (item.locationOverride ?? null);
  const hasChanges = startChanged || durationChanged || placeChanged;
  const formValid = dateValid && minute !== null && durationValid;
  const canSave = hasChanges && !pending;
  // A séance moved alone no longer follows the series time (the engine refuses it): the option is not offered.
  const canFollow =
    item.recurring &&
    item.eventVersion !== null &&
    !item.started &&
    !item.timeDetached &&
    formValid &&
    !dateChanged &&
    !placeChanged &&
    (timeChanged || durationChanged);

  const startKey = `${date}|${time}`;
  const followKey = `${time}|${duration}`;
  const activeExpiring = expiring !== null && expiring.key === startKey ? expiring : null;
  const activeFollowing = following !== null && following.key === followKey ? following : null;

  // The buttons are disabled while a request runs, which drops the focus on the page: it lands on what the pro must read next.
  useEffect(() => {
    if (attention === null) return;
    if (attention.target === "field") {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    } else if (attention.target === "error") {
      errorBox.current?.focus();
    } else if (attention.target === "expiring") {
      expiringBox.current?.focus();
    } else {
      previewBox.current?.focus();
    }
  }, [attention]);

  // The form replaces the details inside the same dialog: the focus goes to its first field.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input:not(:disabled)")?.focus();
  }, []);

  /** An edit drops the messages of the fields it changed and the box above the buttons; the next save validates everything again. */
  function edit(patch: Partial<FormValue>) {
    const next = { ...value, ...patch };
    const keys = changedKeys(value, next).flatMap((key) => ERROR_KEYS[key]);
    setFieldErrors((errors) => withoutErrorsUnder(errors, keys));
    setFormError(null);
    setValue(next);
  }

  function fail(message: string) {
    setFormError(message);
    setAttention({ target: "error" });
  }

  /**
   * Runs one request: the dialog is told it is busy, a thrown request (network) reads like any other failure.
   * The state changes before the transition are urgent: those made inside it would wait for the request to end.
   */
  function run(kind: Running, task: () => Promise<void>) {
    setFormError(null);
    setRunning(kind);
    onBusyChange?.(true);
    startTransition(async () => {
      try {
        await task();
      } catch {
        fail(REQUEST_FAILED);
      } finally {
        onBusyChange?.(false);
        setRunning(null);
      }
    });
  }

  /** The values of a valid form; else the field messages, the box above the buttons and the focus on the first wrong field. */
  function validated(): { minute: number; durationMin: number } | null {
    if (dateValid && minute !== null && durationValid) return { minute, durationMin: durationValue };
    const errors: Record<string, string> = {};
    let summary: string | null = null;
    if (!dateValid) {
      errors.date = DATE_FIELD_ERROR;
      summary = DATE_ERROR;
    }
    if (minute === null) {
      errors.time = TIME_FIELD_ERROR;
      summary = summary ?? TIME_ERROR;
    }
    if (!durationValid) {
      errors.duration = DURATION_FIELD_ERROR;
      summary = summary ?? DURATION_ERROR;
    }
    setFieldErrors(errors);
    setFormError(summary);
    setAttention({ target: "field" });
    return null;
  }

  function save() {
    if (!canSave) return;
    const ok = validated();
    if (ok === null) return;
    setFieldErrors({});
    run("save", async () => {
      if (startChanged && activeExpiring === null) {
        const check = await expiringBeforeAction({ occurrenceId: item.id, date, startMinute: ok.minute });
        if (!check.ok) {
          fail(check.error);
          return;
        }
        if (check.bookings.length > 0) {
          setChoice("keep");
          setExpiring({ key: startKey, bookings: check.bookings });
          setAttention({ target: "expiring" });
          return;
        }
      }
      const unenroll =
        activeExpiring !== null && choice === "unenroll" ? activeExpiring.bookings.map((b) => b.bookingId) : [];
      const res = await updateOccurrenceAction({
        occurrenceId: item.id,
        seenStartsAt: item.startsAt,
        ...(startChanged ? { date, startMinute: ok.minute } : {}),
        ...(durationChanged ? { durationMin: ok.durationMin } : {}),
        ...(placeChanged ? { locationOverride: placeValue } : {}),
        unenrollBookingIds: unenroll,
      });
      if (!res.ok) {
        fail(res.error);
        return;
      }
      onDone("Séance modifiée.");
    });
  }

  function previewFollowing() {
    if (!canFollow || minute === null || pending) return;
    run("preview", async () => {
      const res = await previewFollowingAction({
        occurrenceId: item.id,
        startMinute: minute,
        durationMin: durationValue,
      });
      if (!res.ok) {
        fail(res.error);
        return;
      }
      setFollowing({ key: followKey, text: res.text, fromDate: res.fromDate });
      setAttention({ target: "preview" });
    });
  }

  function applyFollowing() {
    if (!canFollow || minute === null || item.eventVersion === null || pending) return;
    const seenVersion = item.eventVersion;
    run("apply", async () => {
      const res = await applyFollowingAction({
        occurrenceId: item.id,
        seenVersion,
        startMinute: minute,
        durationMin: durationValue,
      });
      if (!res.ok) {
        fail(res.error);
        return;
      }
      onDone("Horaire modifié pour cette séance et les suivantes.");
    });
  }

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Date" htmlFor={`${uid}-date`} error={fieldErrors.date}>
          <Input
            id={`${uid}-date`}
            type="date"
            value={date}
            min={today}
            disabled={item.started || pending}
            onChange={(e) => edit({ date: e.target.value })}
          />
        </FormField>
        <FormField label="Heure de début" htmlFor={`${uid}-time`} error={fieldErrors.time}>
          <Input
            id={`${uid}-time`}
            type="time"
            value={time}
            disabled={item.started || pending}
            onChange={(e) => edit({ time: e.target.value })}
          />
        </FormField>
      </div>

      <FormField
        label="Durée"
        htmlFor={`${uid}-duration`}
        help={item.started ? STARTED_NOTE : DURATION_HELP}
        error={fieldErrors.duration}
      >
        <Input
          id={`${uid}-duration`}
          type="number"
          inputMode="numeric"
          min={BOUNDS.eventDurationMin.min}
          max={BOUNDS.eventDurationMin.max}
          step={BOUNDS.eventDurationMin.step}
          value={duration}
          disabled={item.started || pending}
          onChange={(e) => edit({ duration: e.target.value })}
          className="w-28"
        />
      </FormField>

      <div className="wrap-anywhere">
        <FormField
          label="Lieu de cette séance"
          htmlFor={`${uid}-place`}
          optional
          help={`Laissez vide pour le lieu de l'événement : ${item.eventLocation ?? "aucun"}.`}
        >
          <Input
            id={`${uid}-place`}
            value={place}
            maxLength={BOUNDS.location}
            disabled={pending}
            onChange={(e) => edit({ place: e.target.value })}
          />
        </FormField>
      </div>

      {item.attendees.length > 0 && hasChanges && (
        <p className="text-sm text-zinc-600">Les inscrits sont prévenus par email.</p>
      )}

      {activeExpiring !== null && (
        <div
          ref={expiringBox}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${uid}-expiring`}
          className="space-y-3 rounded-xl border border-border bg-muted/40 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p id={`${uid}-expiring`} className="text-sm font-medium">
            Ces inscrits ont un ticket qui expire avant la nouvelle date :
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {activeExpiring.bookings.map((b) => (
              <li key={b.bookingId} className="wrap-anywhere">{`${b.customerName} (${b.expiryText})`}</li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`${uid}-expired-choice`}
              checked={choice === "keep"}
              disabled={pending}
              onChange={() => setChoice("keep")}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>Les garder (le ticket reste utilisé)</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`${uid}-expired-choice`}
              checked={choice === "unenroll"}
              disabled={pending}
              onChange={() => setChoice("unenroll")}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>Les désinscrire (ticket rendu, client prévenu)</span>
          </label>
        </div>
      )}

      {activeFollowing !== null && (
        <div
          ref={previewBox}
          tabIndex={-1}
          role="status"
          className="space-y-1 rounded-xl border border-border bg-muted/40 p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p>{activeFollowing.text}</p>
          <p className="text-zinc-600">{`À partir du ${formatDayMonth(activeFollowing.fromDate)}.`}</p>
        </div>
      )}

      <FormError message={formError} ref={errorBox} tabIndex={-1} />

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Retour
        </Button>
        {canFollow &&
          (activeFollowing !== null ? (
            <Button
              type="button"
              onClick={applyFollowing}
              disabled={pending}
              className="h-auto whitespace-normal py-2 text-center sm:whitespace-nowrap"
            >
              {running === "apply" && <Loader2 className="animate-spin" />}
              Confirmer pour cette séance et les suivantes
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={previewFollowing}
              disabled={pending}
              className="h-auto whitespace-normal py-2 text-center sm:whitespace-nowrap"
            >
              {running === "preview" && <Loader2 className="animate-spin" />}
              Appliquer aussi aux séances suivantes
            </Button>
          ))}
        <Button
          type="submit"
          variant={activeFollowing !== null ? "secondary" : "primary"}
          disabled={!canSave}
          className="h-auto whitespace-normal py-2 text-center sm:whitespace-nowrap"
        >
          {running === "save" && <Loader2 className="animate-spin" />}
          {activeExpiring !== null ? "Confirmer" : "Enregistrer pour cette séance"}
        </Button>
      </div>
    </form>
  );
}
