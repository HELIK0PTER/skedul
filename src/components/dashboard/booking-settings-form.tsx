"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { BOOKING_ERROR_KEYS, checkBookingSettings } from "@/lib/back-office/booking-settings-form";
import { withoutErrorsUnder } from "@/lib/back-office/form-errors";
import { pluralWord } from "@/lib/back-office/format";
import { NOTICE_PRESETS, noticeLabel } from "@/lib/back-office/notice";
import { REQUEST_FAILED } from "@/lib/pro-messages";
import type { BookingSettings } from "@/lib/tickets";
import { BOUNDS } from "@/lib/tickets-vocab";
import { updateBookingSettingsAction } from "@/server/pro";

/** An empty field is sent as NaN so the server answers « Indiquez un nombre. » instead of a silent 0. */
function toNumber(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

/**
 * A whole number followed by its unit. FormField hands its aria props to this element, which forwards
 * them to the input itself (not to the wrapper), as a custom control must; the unit is read with the help.
 */
function UnitInput({
  unit,
  id,
  "aria-describedby": describedBy,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { unit: string; id: string }) {
  const unitId = `${id}-unit`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        step={1}
        aria-describedby={[unitId, describedBy].filter(Boolean).join(" ")}
        className="w-28"
        {...props}
      />
      <span id={unitId} className="text-sm text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}

/** « Réservations »: how far ahead, how late and how long before the start a client may book and cancel. */
export function BookingSettingsForm({ initial }: { initial: BookingSettings }) {
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  /** What the server refused or could not answer: the checks of the browser name their field instead. */
  const [error, setError] = useState<string | null>(null);
  /** The message of each field the browser check refused, keyed by field name. */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** Bumped with each failed save: the effect below puts the focus on the error box once it is rendered. */
  const [errorFocus, setErrorFocus] = useState(0);
  /** Bumped with each refused check: the effect below puts the focus on the first field rendered aria-invalid. */
  const [fieldFocus, setFieldFocus] = useState(0);
  const [saved, setSaved] = useState(false);
  const [horizon, setHorizon] = useState(String(initial.bookingHorizonDays));
  const [notice, setNotice] = useState(initial.minNoticeMinutes);
  const [deadline, setDeadline] = useState(String(initial.cancelDeadlineHours));

  // The fields are disabled while a call runs, which drops the focus on the page: a keyboard or screen-reader user lands on the message.
  useEffect(() => {
    if (errorFocus > 0) errorBox.current?.focus();
  }, [errorFocus]);
  // A refused check puts the focus on the first field that reads aria-invalid once the messages are rendered.
  useEffect(() => {
    if (fieldFocus > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fieldFocus]);

  // a value saved before the presets existed (« 45 min avant ») stays selectable
  const noticeOptions = NOTICE_PRESETS.some((p) => p.minutes === initial.minNoticeMinutes)
    ? NOTICE_PRESETS
    : [...NOTICE_PRESETS, { minutes: initial.minNoticeMinutes, label: noticeLabel(initial.minNoticeMinutes) }].sort(
        (a, b) => a.minutes - b.minutes,
      );

  /**
   * An edit drops the messages of the field it changed (the notice one too when the horizon changes) and the
   * box above the button: the next save validates everything again.
   */
  function edited(field: keyof BookingSettings) {
    setFieldErrors((errors) => withoutErrorsUnder(errors, BOOKING_ERROR_KEYS[field]));
    setError(null);
    setSaved(false);
  }

  function fail(message: string) {
    setError(message);
    setErrorFocus((n) => n + 1);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setSaved(false);
    const values: BookingSettings = {
      bookingHorizonDays: toNumber(horizon),
      minNoticeMinutes: notice,
      cancelDeadlineHours: toNumber(deadline),
    };
    // The server applies the same rules: naming the field here saves the round trip.
    const problems = checkBookingSettings(values);
    if (problems) {
      setFieldErrors(problems);
      setFieldFocus((n) => n + 1);
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      try {
        const res = await updateBookingSettingsAction(values);
        if (!res.ok) {
          fail(res.error);
          return;
        }
        setSaved(true);
      } catch {
        fail(REQUEST_FAILED);
      }
    });
  }

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="space-y-5">
      <FormField
        label="Réservable jusqu'à"
        htmlFor={`${uid}-horizon`}
        help="Au-delà, vos séances ne sont pas encore ouvertes aux réservations."
        error={fieldErrors.bookingHorizonDays}
      >
        <UnitInput
          id={`${uid}-horizon`}
          unit={`${pluralWord(toNumber(horizon), "jour", "jours")} à l'avance`}
          min={BOUNDS.bookingHorizonDays.min}
          max={BOUNDS.bookingHorizonDays.max}
          value={horizon}
          disabled={pending}
          onChange={(e) => {
            setHorizon(e.target.value);
            edited("bookingHorizonDays");
          }}
        />
      </FormField>

      <FormField
        label="Au plus tard"
        htmlFor={`${uid}-notice`}
        help="Passé ce délai, la séance affiche « Réservations fermées » en ligne. Vous pouvez toujours inscrire quelqu'un vous-même."
        error={fieldErrors.minNoticeMinutes}
      >
        <Select
          id={`${uid}-notice`}
          value={notice}
          disabled={pending}
          onChange={(e) => {
            setNotice(Number(e.target.value));
            edited("minNoticeMinutes");
          }}
        >
          {noticeOptions.map((p) => (
            <option key={p.minutes} value={p.minutes}>
              {p.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        label="Annulation par le client jusqu'à"
        htmlFor={`${uid}-deadline`}
        help="Passé ce délai, vous seul pouvez annuler. Un client garde ce droit jusqu'au début si vous avez changé l'horaire ou l'avez déplacé."
        error={fieldErrors.cancelDeadlineHours}
      >
        <UnitInput
          id={`${uid}-deadline`}
          unit={`${pluralWord(toNumber(deadline), "heure", "heures")} avant le début`}
          min={BOUNDS.cancelDeadlineHours.min}
          max={BOUNDS.cancelDeadlineHours.max}
          value={deadline}
          disabled={pending}
          onChange={(e) => {
            setDeadline(e.target.value);
            edited("cancelDeadlineHours");
          }}
        />
      </FormField>

      <p className="text-sm text-muted-foreground">
        Chaque événement et chaque type en RDV libre peut avoir ses propres règles.
      </p>

      <FormError message={error} ref={errorBox} tabIndex={-1} />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Enregistrer les réglages
        </Button>
        <span role="status" className="flex items-center gap-1.5 text-sm text-green-700">
          {saved && (
            <>
              <Check className="size-4" aria-hidden="true" />
              Enregistré
            </>
          )}
        </span>
      </div>
    </form>
  );
}
