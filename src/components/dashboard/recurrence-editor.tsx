"use client";

import { useMemo, type ReactNode } from "react";
import { Info, TriangleAlert } from "lucide-react";

import { FormField } from "@/components/dashboard/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatWhenShort, plural } from "@/lib/back-office/format";
import { WEEKDAY_LETTERS, WEEKDAY_NAMES, WEEK_ORDER } from "@/lib/back-office/labels";
import {
  dstNoteTexts,
  intervalWords,
  monthlyChoices,
  previewDates,
  recurrenceSummary,
  ruleFromForm,
  type RecurrenceFormValue,
} from "@/lib/back-office/recurrence-form";
import { isDayKey, submittableRule, upcomingOnly } from "@/lib/back-office/recurrence-submit";
import { addMonthsClamped, dayOfWeek, type DateKey } from "@/lib/civil-date";
import { BOUNDS, type RecurrenceEnd, type RecurrenceFreq } from "@/lib/tickets-vocab";
import { cn } from "@/lib/utils";

/** The pure gates live in a tested module; Tasks 19 and 20 import them from here with the editor. */
export { startProblem, submittableRule } from "@/lib/back-office/recurrence-submit";

/** How many séances the preview expands to find the daylight-saving changes (a daily series materialises 400 days). */
const DST_SCAN_LIMIT = 400;
const UPCOMING_SHOWN = 5;
const DST_NOTES_SHOWN = 3;

const FREQ_OPTIONS: readonly { value: RecurrenceFreq; label: string }[] = [
  { value: "once", label: "Une seule fois" },
  { value: "daily", label: "Tous les jours" },
  { value: "weekly", label: "Toutes les semaines" },
  { value: "monthly", label: "Tous les mois" },
];

/** Shown when the start time is cleared or malformed: ruleFromForm returns null, so no schema can name the field. */
export const START_TIME_ERROR = "Heure de début : indiquez une heure.";
export const START_TIME_FIELD_ERROR = "Indiquez une heure.";
/** Same for a cleared start date (a type=date input reads ""): the time field must not be blamed for it. */
export const START_DATE_ERROR = "Date de début : ce champ est obligatoire.";
export const START_DATE_FIELD_ERROR = "Ce champ est obligatoire.";

const WEEKDAYS_HELP = "Choisissez au moins un jour.";
const DURATION_HELP = "Par pas de 5 minutes.";
const MONTHLY_NEEDS_DATE = "Choisissez d'abord une date de début valide.";
const PREVIEW_INCOMPLETE = "Complétez la récurrence pour voir l'aperçu.";
const NO_UPCOMING = "Aucune séance à venir.";

/** AA on the page background and on the tinted preview panel (muted-foreground is only 4.6:1 on #fafafa). */
const MUTED_TEXT = "text-zinc-600";

function parseFreq(text: string): RecurrenceFreq | null {
  const found = FREQ_OPTIONS.find((option) => option.value === text);
  return found ? found.value : null;
}

/** A cleared or partial number field reads as 0, which every schema refuses with its own French message. */
function wholeNumber(input: HTMLInputElement): number {
  const n = input.valueAsNumber;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Field error by bare key, with the `rule.` prefix of parseFr(eventInputSchema) accepted too. */
function errorOf(errors: Record<string, string> | undefined, key: string): string | null {
  if (!errors) return null;
  return errors[`rule.${key}`] ?? errors[key] ?? null;
}

/**
 * aria-describedby for a control that FormField cannot wire itself (it sits in a
 * Fragment next to its unit text): the help and error ids FormField renders.
 */
function describedBy(id: string, hasHelp: boolean, error: string | null): string | undefined {
  const ids: string[] = [];
  if (hasHelp) ids.push(`${id}-help`);
  if (error) ids.push(`${id}-error`);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

function Radio({
  id,
  name,
  checked,
  onSelect,
  children,
}: {
  id: string;
  name: string;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex min-h-10 items-center gap-2">
      <input
        id={id}
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="size-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
      />
      <label htmlFor={id} className="cursor-pointer text-sm">
        {children}
      </label>
    </span>
  );
}

function GroupError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-rose-700">
      {message}
    </p>
  );
}

const LEGEND_CLASS = "mb-2 text-sm font-medium leading-none text-foreground";

export function RecurrenceEditor({
  idPrefix,
  value,
  onChange,
  minDate,
  disabled = false,
  fieldErrors,
}: {
  idPrefix: string;
  value: RecurrenceFormValue;
  onChange: (next: RecurrenceFormValue) => void;
  minDate: DateKey;
  disabled?: boolean;
  fieldErrors?: Record<string, string>;
}) {
  const freq = value.freq;
  /** A real day, not just a well-formed key: parseKey and the date arithmetic below throw on "2026-02-30". */
  const startKnown = isDayKey(value.startDate);
  const choices = useMemo(
    () => (startKnown ? monthlyChoices(value.startDate) : []),
    [startKnown, value.startDate],
  );
  const set = (patch: Partial<RecurrenceFormValue>) => onChange({ ...value, ...patch });

  const startDateId = `${idPrefix}-start-date`;
  const startTimeId = `${idPrefix}-start-time`;
  const durationId = `${idPrefix}-duration`;
  const freqId = `${idPrefix}-freq`;
  const intervalId = `${idPrefix}-interval`;
  const weekdaysId = `${idPrefix}-weekdays`;
  const monthlyId = `${idPrefix}-monthly`;
  const endId = `${idPrefix}-end`;
  const untilDateId = `${idPrefix}-until-date`;
  const countId = `${idPrefix}-count`;

  const startDateError = errorOf(fieldErrors, "startDate");
  const startTimeError = errorOf(fieldErrors, "startMinute");
  const durationError = errorOf(fieldErrors, "durationMin");
  const freqError = errorOf(fieldErrors, "freq");
  const intervalError = errorOf(fieldErrors, "interval");
  const weekdaysError = errorOf(fieldErrors, "weekdays");
  const monthlyError = errorOf(fieldErrors, "monthlyBy") ?? errorOf(fieldErrors, "monthWeek");
  const endModeError = errorOf(fieldErrors, "endMode");
  const untilError = errorOf(fieldErrors, "untilDate");
  const countError = errorOf(fieldErrors, "occurrenceCount");

  /** The weekday toggles and the monthly choice follow the start date while the user has not customised them. */
  function changeStartDate(next: string) {
    if (!isDayKey(next)) {
      set({ startDate: next });
      return;
    }
    const followed =
      startKnown && value.weekdays.length === 1 && value.weekdays[0] === dayOfWeek(value.startDate);
    const choiceStillOffered = monthlyChoices(next).some((c) => c.value === value.monthlyChoice);
    set({
      startDate: next,
      weekdays: followed ? [dayOfWeek(next)] : value.weekdays,
      monthlyChoice: choiceStillOffered ? value.monthlyChoice : "day_of_month",
    });
  }

  function changeFreq(next: RecurrenceFreq) {
    set({
      freq: next,
      interval: Math.min(Math.max(value.interval, 1), BOUNDS.interval[next]),
      weekdays:
        next === "weekly" && value.weekdays.length === 0 && startKnown
          ? [dayOfWeek(value.startDate)]
          : value.weekdays,
    });
  }

  function toggleWeekday(day: number) {
    const next = value.weekdays.includes(day)
      ? value.weekdays.filter((d) => d !== day)
      : [...value.weekdays, day];
    set({ weekdays: [...next].sort((a, b) => a - b) });
  }

  function changeEndMode(mode: RecurrenceEnd) {
    const untilUsable = isDayKey(value.untilDate) && value.untilDate >= value.startDate;
    if (mode === "until" && !untilUsable) {
      set({ endMode: mode, untilDate: startKnown ? addMonthsClamped(value.startDate, 3) : "" });
      return;
    }
    set({ endMode: mode });
  }

  const untilMax = startKnown ? addMonthsClamped(value.startDate, BOUNDS.untilYears * 12) : undefined;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* A control that is the single child of a FormField gets its aria-describedby / aria-invalid from it. */}
        <FormField label="Date de début" htmlFor={startDateId} error={startDateError}>
          <Input
            id={startDateId}
            type="date"
            min={minDate}
            value={value.startDate}
            disabled={disabled}
            onChange={(e) => changeStartDate(e.target.value)}
          />
        </FormField>
        <FormField label="Heure de début" htmlFor={startTimeId} error={startTimeError}>
          <Input
            id={startTimeId}
            type="time"
            step={300}
            value={value.startTime}
            disabled={disabled}
            onChange={(e) => set({ startTime: e.target.value })}
          />
        </FormField>
        {/* The Fragment keeps FormField from putting aria-invalid on the wrapper div: the input carries both itself. */}
        <FormField label="Durée" htmlFor={durationId} help={DURATION_HELP} error={durationError}>
          <>
            <div className="flex items-center gap-2">
              <Input
                id={durationId}
                type="number"
                inputMode="numeric"
                min={BOUNDS.eventDurationMin.min}
                max={BOUNDS.eventDurationMin.max}
                step={BOUNDS.eventDurationMin.step}
                value={value.durationMin > 0 ? value.durationMin : ""}
                disabled={disabled}
                aria-invalid={durationError ? true : undefined}
                aria-describedby={describedBy(durationId, true, durationError)}
                className="w-28"
                onChange={(e) => set({ durationMin: wholeNumber(e.target) })}
              />
              <span className={cn("text-sm", MUTED_TEXT)}>min</span>
            </div>
          </>
        </FormField>
        <FormField label="Répétition" htmlFor={freqId} error={freqError}>
          <Select
            id={freqId}
            value={freq}
            disabled={disabled}
            onChange={(e) => {
              const next = parseFreq(e.target.value);
              if (next) changeFreq(next);
            }}
          >
            {FREQ_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      {freq !== "once" && (
        <FormField label="Intervalle" htmlFor={intervalId} error={intervalError}>
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{intervalWords(freq, value.interval).lead}</span>
              <Input
                id={intervalId}
                type="number"
                inputMode="numeric"
                min={1}
                max={BOUNDS.interval[freq]}
                step={1}
                value={value.interval > 0 ? value.interval : ""}
                disabled={disabled}
                aria-invalid={intervalError ? true : undefined}
                aria-describedby={describedBy(intervalId, false, intervalError)}
                className="w-20"
                onChange={(e) => set({ interval: wholeNumber(e.target) })}
              />
              <span>{intervalWords(freq, value.interval).unit}</span>
            </div>
          </>
        </FormField>
      )}

      {freq === "weekly" && (
        <fieldset
          disabled={disabled}
          className="min-w-0 space-y-2"
          aria-describedby={describedBy(weekdaysId, true, weekdaysError)}
        >
          <legend className={LEGEND_CLASS}>Jours</legend>
          <div className="grid grid-cols-7 gap-1.5 sm:flex sm:gap-2">
            {WEEK_ORDER.map((day) => {
              const on = value.weekdays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  aria-label={WEEKDAY_NAMES[day]}
                  title={WEEKDAY_NAMES[day]}
                  onClick={() => toggleWeekday(day)}
                  className={cn(
                    "flex h-10 w-full cursor-pointer items-center justify-center rounded-xl border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:w-10",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-card text-foreground hover:bg-muted",
                  )}
                >
                  {WEEKDAY_LETTERS[day]}
                </button>
              );
            })}
          </div>
          <p id={`${weekdaysId}-help`} className={cn("text-xs", MUTED_TEXT)}>
            {WEEKDAYS_HELP}
          </p>
          <GroupError id={`${weekdaysId}-error`} message={weekdaysError} />
        </fieldset>
      )}

      {freq === "monthly" && (
        <fieldset
          disabled={disabled}
          className="min-w-0 space-y-1"
          aria-describedby={monthlyError ? `${monthlyId}-error` : undefined}
        >
          <legend className={LEGEND_CLASS}>Jour du mois</legend>
          {choices.length === 0 ? (
            <p className={cn("text-xs", MUTED_TEXT)}>{MONTHLY_NEEDS_DATE}</p>
          ) : (
            <div className="flex flex-col">
              {choices.map((choice) => (
                <Radio
                  key={choice.value}
                  id={`${monthlyId}-${choice.value}`}
                  name={monthlyId}
                  checked={value.monthlyChoice === choice.value}
                  onSelect={() => set({ monthlyChoice: choice.value })}
                >
                  {choice.label}
                </Radio>
              ))}
            </div>
          )}
          <GroupError id={`${monthlyId}-error`} message={monthlyError} />
        </fieldset>
      )}

      {freq !== "once" && (
        <fieldset
          disabled={disabled}
          className="min-w-0 space-y-1"
          aria-describedby={endModeError ? `${endId}-error` : undefined}
        >
          <legend className={LEGEND_CLASS}>Fin</legend>
          <div>
            <Radio
              id={`${endId}-never`}
              name={endId}
              checked={value.endMode === "never"}
              onSelect={() => changeEndMode("never")}
            >
              Jamais
            </Radio>
          </div>
          <div className="flex flex-wrap items-center gap-x-2">
            <Radio
              id={`${endId}-until`}
              name={endId}
              checked={value.endMode === "until"}
              onSelect={() => changeEndMode("until")}
            >
              Le
            </Radio>
            <Input
              id={untilDateId}
              type="date"
              aria-label="Date de fin"
              min={startKnown ? value.startDate : undefined}
              max={untilMax}
              value={value.untilDate}
              disabled={disabled}
              aria-invalid={untilError ? true : undefined}
              aria-describedby={untilError ? `${untilDateId}-error` : undefined}
              className="w-44"
              onChange={(e) => set({ endMode: "until", untilDate: e.target.value })}
            />
          </div>
          <GroupError id={`${untilDateId}-error`} message={untilError} />
          <div className="flex flex-wrap items-center gap-x-2">
            <Radio
              id={`${endId}-count`}
              name={endId}
              checked={value.endMode === "count"}
              onSelect={() => changeEndMode("count")}
            >
              Après
            </Radio>
            <Input
              id={countId}
              type="number"
              inputMode="numeric"
              aria-label="Nombre de séances"
              min={BOUNDS.occurrenceCount.min}
              max={BOUNDS.occurrenceCount.max}
              step={1}
              value={value.occurrenceCount > 0 ? value.occurrenceCount : ""}
              disabled={disabled}
              aria-invalid={countError ? true : undefined}
              aria-describedby={countError ? `${countId}-error` : undefined}
              className="w-24"
              onChange={(e) => set({ endMode: "count", occurrenceCount: wholeNumber(e.target) })}
            />
            <span className="text-sm">séances</span>
          </div>
          <GroupError id={`${countId}-error`} message={countError} />
          <GroupError id={`${endId}-error`} message={endModeError} />
        </fieldset>
      )}
    </div>
  );
}

type PreviewModel = {
  label: string;
  warning: string | null;
  dstNotes: string[];
  dstMore: number;
  upcoming: { key: string; text: string }[];
};

/** Everything the preview shows, computed from the form value; null when the form is not a valid rule yet. */
function buildPreview(value: RecurrenceFormValue, tz: string, now: Date): PreviewModel | null {
  const summary = recurrenceSummary(value);
  const built = ruleFromForm(value);
  if (!summary || !built) return null;
  // previewDates starts at local today: a séance of today that has already started is one the form could not create.
  const dates = upcomingOnly(previewDates(built.rule, built.durationMin, tz, now, DST_SCAN_LIMIT), now);
  const notes = dstNoteTexts(
    built.rule,
    built.durationMin,
    tz,
    dates.map((d) => d.seriesDate),
  );
  return {
    label: summary.label,
    warning: summary.warning,
    dstNotes: notes.slice(0, DST_NOTES_SHOWN),
    dstMore: Math.max(0, notes.length - DST_NOTES_SHOWN),
    upcoming: dates.slice(0, UPCOMING_SHOWN).map((d) => ({
      key: `${d.seriesDate}-${d.startsAt.getTime()}`,
      text: formatWhenShort(d.startsAt, tz),
    })),
  };
}

function PreviewBody({ preview, conflicts }: { preview: PreviewModel; conflicts: number }) {
  return (
    <>
      <div className="space-y-1">
        <p className="font-semibold">{preview.label}</p>
        {preview.warning && (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{preview.warning}</span>
          </p>
        )}
      </div>

      {preview.dstNotes.length > 0 && (
        <ul className="space-y-1">
          {preview.dstNotes.map((note) => (
            <li key={note} className="flex items-start gap-1.5 text-xs">
              <Info className={cn("mt-0.5 size-3.5 shrink-0", MUTED_TEXT)} aria-hidden="true" />
              <span>{note}</span>
            </li>
          ))}
          {preview.dstMore > 0 && (
            <li className={cn("pl-5 text-xs", MUTED_TEXT)}>
              {`et ${preview.dstMore} ${preview.dstMore === 1 ? "autre changement" : "autres changements"} d'heure`}
            </li>
          )}
        </ul>
      )}

      <div className="space-y-1">
        <p className={cn("text-xs font-medium", MUTED_TEXT)}>Prochaines séances</p>
        {preview.upcoming.length === 0 ? (
          <p className={cn("text-xs", MUTED_TEXT)}>{NO_UPCOMING}</p>
        ) : (
          <ul className="space-y-0.5">
            {preview.upcoming.map((item) => (
              <li key={item.key} className="tabular-nums">
                {item.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      {conflicts > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {`Conflit avec ${plural(conflicts, "RDV déjà réservé", "RDV déjà réservés")} : les deux apparaîtront dans votre planning.`}
          </span>
        </p>
      )}
    </>
  );
}

export function RecurrencePreview({
  value,
  tz,
  nowIso,
  rdvConflicts,
}: {
  value: RecurrenceFormValue;
  tz: string;
  nowIso: string;
  rdvConflicts: number | null;
}) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const preview = useMemo(() => buildPreview(value, tz, now), [value, tz, now]);
  // A count fetched for a previous value must not sit beside a form that cannot be submitted.
  const conflicts = submittableRule(value) ? (rdvConflicts ?? 0) : 0;

  // One live region element in both states: swapping a <p> for a <div> would replace the region itself, and assistive technology can miss the announcement.
  return (
    <div
      aria-live="polite"
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        preview ? "space-y-3 border-border bg-muted/40" : cn("border-dashed border-border", MUTED_TEXT),
      )}
    >
      {preview ? <PreviewBody preview={preview} conflicts={conflicts} /> : PREVIEW_INCOMPLETE}
    </div>
  );
}
