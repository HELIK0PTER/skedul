"use client";

import { useState } from "react";

import { FormField } from "@/components/dashboard/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { plural } from "@/lib/back-office/format";
import { NOTICE_PRESETS, noticeLabel } from "@/lib/back-office/notice";
import type { BookingWindow } from "@/lib/booking-window";
import type { WindowOverrides } from "@/lib/tickets";
import { BOUNDS } from "@/lib/tickets-vocab";

const INHERIT = "inherit";
const CUSTOM = "custom";
const SELECT_CLASS = "w-full sm:w-auto sm:min-w-64";

/**
 * A whole-number field that keeps what is being typed: the parent only receives
 * integers, and the text snaps back to the last valid value on blur.
 */
function OverrideNumber({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <Input
      type="number"
      inputMode="numeric"
      aria-label={label}
      min={min}
      max={max}
      step={1}
      className="w-24"
      value={text}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isInteger(n)) onChange(n);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

/**
 * Horizon, minimum notice and client cancellation overrides of a type or an
 * event. Each row starts with « Comme vos réglages (...) » (null) and offers a
 * custom value. Owns no persistence: the server refuses a notice longer than the
 * horizon (NOTICE_TOO_LONG) when the form is saved.
 */
export function WindowOverrideFields({
  idPrefix,
  value,
  onChange,
  proWindow,
  disabled,
}: {
  idPrefix: string;
  value: WindowOverrides;
  onChange: (next: WindowOverrides) => void;
  proWindow: BookingWindow;
  disabled?: boolean;
}) {
  const set = (patch: Partial<WindowOverrides>) => onChange({ ...value, ...patch });
  const notice = value.minNoticeMinutes;
  const noticeIsPreset = notice === null || NOTICE_PRESETS.some((p) => p.minutes === notice);

  return (
    <div className="space-y-4">
      <FormField label="Réservable jusqu'à" htmlFor={`${idPrefix}-horizon`}>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            id={`${idPrefix}-horizon`}
            className={SELECT_CLASS}
            disabled={disabled}
            value={value.bookingHorizonDays === null ? INHERIT : CUSTOM}
            onChange={(e) => set({ bookingHorizonDays: e.target.value === INHERIT ? null : proWindow.bookingHorizonDays })}
          >
            <option value={INHERIT}>{`Comme vos réglages (${plural(proWindow.bookingHorizonDays, "jour", "jours")})`}</option>
            <option value={CUSTOM}>Valeur personnalisée</option>
          </Select>
          {value.bookingHorizonDays !== null && (
            <>
              <OverrideNumber
                label="Nombre de jours"
                value={value.bookingHorizonDays}
                min={BOUNDS.bookingHorizonDays.min}
                max={BOUNDS.bookingHorizonDays.max}
                disabled={disabled}
                onChange={(next) => set({ bookingHorizonDays: next })}
              />
              <span className="text-sm text-muted-foreground">{"jours à l'avance"}</span>
            </>
          )}
        </div>
      </FormField>

      <FormField label="Au plus tard" htmlFor={`${idPrefix}-notice`}>
        <Select
          id={`${idPrefix}-notice`}
          className={SELECT_CLASS}
          disabled={disabled}
          value={notice === null ? INHERIT : String(notice)}
          onChange={(e) => set({ minNoticeMinutes: e.target.value === INHERIT ? null : Number(e.target.value) })}
        >
          <option value={INHERIT}>{`Comme vos réglages (${noticeLabel(proWindow.minNoticeMinutes)})`}</option>
          {!noticeIsPreset && notice !== null && <option value={String(notice)}>{noticeLabel(notice)}</option>}
          {NOTICE_PRESETS.map((p) => (
            <option key={p.minutes} value={String(p.minutes)}>
              {p.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Annulation par le client jusqu'à" htmlFor={`${idPrefix}-cancel`}>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            id={`${idPrefix}-cancel`}
            className={SELECT_CLASS}
            disabled={disabled}
            value={value.cancelDeadlineHours === null ? INHERIT : CUSTOM}
            onChange={(e) => set({ cancelDeadlineHours: e.target.value === INHERIT ? null : proWindow.cancelDeadlineHours })}
          >
            <option value={INHERIT}>{`Comme vos réglages (${proWindow.cancelDeadlineHours} h avant)`}</option>
            <option value={CUSTOM}>Valeur personnalisée</option>
          </Select>
          {value.cancelDeadlineHours !== null && (
            <>
              <OverrideNumber
                label="Nombre d'heures"
                value={value.cancelDeadlineHours}
                min={BOUNDS.cancelDeadlineHours.min}
                max={BOUNDS.cancelDeadlineHours.max}
                disabled={disabled}
                onChange={(next) => set({ cancelDeadlineHours: next })}
              />
              <span className="text-sm text-muted-foreground">heures avant le début</span>
            </>
          )}
        </div>
      </FormField>
    </div>
  );
}
