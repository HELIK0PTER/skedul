"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Info, Loader2 } from "lucide-react";

import { REQUEST_FAILED, focusFirstInvalid } from "@/components/dashboard/event-editor";
import { FormError } from "@/components/dashboard/form-error";
import {
  RecurrenceEditor,
  RecurrencePreview,
  START_DATE_ERROR,
  START_DATE_FIELD_ERROR,
  START_TIME_ERROR,
  START_TIME_FIELD_ERROR,
  startProblem,
} from "@/components/dashboard/recurrence-editor";
import { Button } from "@/components/ui/button";
import type { SchedulePreview } from "@/lib/back-office/event-actions";
import { changedKeys, RECURRENCE_ERROR_KEYS, withoutErrorsUnder } from "@/lib/back-office/form-errors";
import { plural } from "@/lib/back-office/format";
import { ruleFromForm, type RecurrenceFormValue } from "@/lib/back-office/recurrence-form";
import { formatDayMonth, formatDayMonthYear, type DateKey } from "@/lib/civil-date";
import { eventInputSchema, type RecurrenceRuleInput } from "@/lib/tickets";
import { parseFr } from "@/lib/zod-fr";
import { applyScheduleAction, previewScheduleAction } from "@/server/pro-catalog";

/** The two parts of an event this form edits, validated with the schema the server uses (keys `rule.*`, `durationMin`). */
const scheduleSchema = eventInputSchema.pick({ rule: true, durationMin: true });

const NO_FUTURE = "Plus aucune séance à venir dans cette série : l'horaire ne se modifie plus.";
const IN_PLACE_NOTE = "Aucune séance passée dans cette série : la modification s'applique directement.";

type Built = { rule: RecurrenceRuleInput; durationMin: number };
type Previewed = {
  /** The exact form value object the preview was computed for. */
  forValue: RecurrenceFormValue;
  built: Built;
  preview: SchedulePreview;
};

type ScheduleFormProps = {
  eventId: string;
  seenVersion: number;
  fromDate: DateKey | null;
  tz: string;
  nowIso: string;
  initial: RecurrenceFormValue;
  remainingCount: number | null;
  readOnly: boolean;
};

/**
 * The schedule card content. The page keys it on the saved schedule, so a real change remounts it on the refreshed
 * props: whatever must outlive that remount (the « Horaire appliqué. » confirmation) is owned by EventScheduleSection
 * and reached through `onApplied` / `onClear`.
 */
export function EventScheduleForm({
  eventId,
  seenVersion,
  fromDate,
  tz,
  nowIso,
  initial,
  remainingCount,
  readOnly,
  onApplied,
  onClear,
}: ScheduleFormProps & {
  /** The schedule was applied (called before the navigation). */
  onApplied?: () => void;
  /** A new edit or preview starts: a confirmation of the previous apply no longer holds. */
  onClear?: () => void;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  /** True while a preview or an apply runs: a second click before the buttons re-render must not send a second request. */
  const inFlight = useRef(false);
  const [value, setValue] = useState<RecurrenceFormValue>(initial);
  const [previewed, setPreviewed] = useState<Previewed | null>(null);
  const [orphans, setOrphans] = useState<"keep" | "cancel">("keep");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  /** Bumped with each failure of a server call: the effect below puts the focus on the error box once it is rendered. */
  const [errorFocus, setErrorFocus] = useState(0);
  const [previewing, startPreview] = useTransition();
  const [applying, startApply] = useTransition();

  // The buttons are disabled while a call runs, which drops the focus on the page: a keyboard or screen-reader user lands on the message.
  useEffect(() => {
    if (errorFocus > 0) errorBox.current?.focus();
  }, [errorFocus]);

  if (fromDate === null) {
    return <p className="text-sm text-zinc-600">{NO_FUTURE}</p>;
  }
  const from: DateKey = fromDate;

  /** Locked only while a request runs: after an apply that leaves the page key unchanged the form stays usable. */
  const locked = readOnly || previewing || applying;
  /** A preview counts only for the exact value it was computed for: any edit makes a new object. */
  const current = previewed !== null && previewed.forValue === value ? previewed : null;
  const orphanCount = current === null ? 0 : current.preview.summary.orphans;
  const summaryText =
    current === null ? "" : orphanCount > 0 && orphans === "cancel" ? current.preview.textCancel : current.preview.textKeep;

  /** An edit drops the messages of the fields it changed and the box above the buttons; the next preview validates everything again. */
  function edit(next: RecurrenceFormValue) {
    const keys = changedKeys(value, next).flatMap((key) => RECURRENCE_ERROR_KEYS[key]);
    setFieldErrors((errors) => withoutErrorsUnder(errors, keys));
    setFormError(null);
    onClear?.();
    setValue(next);
  }

  function validate(): Built | null {
    const built = ruleFromForm(value);
    if (!built) {
      // ruleFromForm is null only for a cleared or malformed start date or start time: no schema can name the field.
      const dateWrong = startProblem(value) === "date";
      setFieldErrors(
        dateWrong ? { "rule.startDate": START_DATE_FIELD_ERROR } : { "rule.startMinute": START_TIME_FIELD_ERROR },
      );
      setFormError(dateWrong ? START_DATE_ERROR : START_TIME_ERROR);
      focusFirstInvalid(rootRef.current);
      return null;
    }
    const parsed = parseFr(scheduleSchema, built);
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      setFormError(parsed.error);
      focusFirstInvalid(rootRef.current);
      return null;
    }
    setFieldErrors({});
    return built;
  }

  function runPreview() {
    if (locked || inFlight.current) return;
    const built = validate();
    if (!built) return;
    setFormError(null);
    onClear?.();
    inFlight.current = true;
    startPreview(async () => {
      try {
        const res = await previewScheduleAction({
          eventId,
          fromDate: from,
          rule: built.rule,
          durationMin: built.durationMin,
        });
        if (!res.ok) {
          setFormError(res.error);
          setErrorFocus((n) => n + 1);
          return;
        }
        setPreviewed({ forValue: value, built, preview: res.preview });
        setOrphans("keep");
      } catch {
        setFormError(REQUEST_FAILED);
        setErrorFocus((n) => n + 1);
      } finally {
        inFlight.current = false;
      }
    });
  }

  function apply() {
    if (locked || inFlight.current || current === null) return;
    inFlight.current = true;
    startApply(async () => {
      try {
        // seenVersion is this render's prop, read at submit time.
        const res = await applyScheduleAction({
          eventId,
          seenVersion,
          fromDate: from,
          rule: current.built.rule,
          durationMin: current.built.durationMin,
          orphans: orphanCount > 0 ? orphans : "keep",
        });
        if (!res.ok) {
          setFormError(res.error);
          setErrorFocus((n) => n + 1);
          return;
        }
        onApplied?.();
        // The preview was for the schedule just applied: a new one is needed before the next apply.
        setPreviewed(null);
        router.push(`/dashboard/events/${res.eventId}`);
      } catch {
        setFormError(REQUEST_FAILED);
        setErrorFocus((n) => n + 1);
      } finally {
        inFlight.current = false;
      }
    });
  }

  const orphansName = `schedule-${eventId}-orphans`;

  return (
    <div ref={rootRef} className="space-y-5">
      <p className="text-sm text-zinc-600">
        {`Les changements s'appliquent à partir du ${formatDayMonthYear(from)}, la première séance à venir.`}
        {remainingCount !== null && ` Il reste ${plural(remainingCount, "séance", "séances")}.`}
      </p>

      <RecurrenceEditor
        idPrefix={`schedule-${eventId}`}
        value={value}
        onChange={edit}
        minDate={from}
        disabled={locked}
        fieldErrors={fieldErrors}
      />
      <RecurrencePreview
        value={value}
        tz={tz}
        nowIso={nowIso}
        rdvConflicts={current ? current.preview.rdvConflicts : null}
      />

      {/* Always mounted (sr-only while empty, so it takes no room), so a screen reader announces the summary when it appears. */}
      <div
        aria-live="polite"
        className={current ? "space-y-3 rounded-xl border border-primary/30 bg-primary-muted/50 p-4 text-sm" : "sr-only"}
      >
        {current && (
          <>
            <p className="font-medium">{summaryText}</p>
            {orphanCount > 0 && (
              <fieldset disabled={locked} className="min-w-0 space-y-1">
                <legend className="mb-1 text-sm">
                  {`${plural(orphanCount, "séance avec inscrits n'est", "séances avec inscrits ne sont")} plus dans le nouvel horaire :`}
                </legend>
                <div className="flex flex-col">
                  <span className="inline-flex min-h-10 items-center gap-2">
                    <input
                      id={`${orphansName}-keep`}
                      type="radio"
                      name={orphansName}
                      checked={orphans === "keep"}
                      onChange={() => setOrphans("keep")}
                      className="size-4 cursor-pointer accent-primary"
                    />
                    <label htmlFor={`${orphansName}-keep`} className="cursor-pointer">
                      Garder (séance isolée)
                    </label>
                  </span>
                  <span className="inline-flex min-h-10 items-center gap-2">
                    <input
                      id={`${orphansName}-cancel`}
                      type="radio"
                      name={orphansName}
                      checked={orphans === "cancel"}
                      onChange={() => setOrphans("cancel")}
                      className="size-4 cursor-pointer accent-primary"
                    />
                    <label htmlFor={`${orphansName}-cancel`} className="cursor-pointer">
                      Annuler (tickets rendus)
                    </label>
                  </span>
                </div>
              </fieldset>
            )}
            {current.preview.inPlace && (
              <p className="flex items-start gap-1.5 text-xs">
                <Info className="mt-0.5 size-3.5 shrink-0 text-zinc-600" aria-hidden="true" />
                <span>{IN_PLACE_NOTE}</span>
              </p>
            )}
          </>
        )}
      </div>

      <FormError message={formError} ref={errorBox} tabIndex={-1} />

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={runPreview} disabled={locked}>
            {previewing && <Loader2 className="size-4 animate-spin" />}
            Prévisualiser les changements
          </Button>
          <Button type="button" onClick={apply} disabled={locked || current === null}>
            {applying && <Loader2 className="size-4 animate-spin" />}
            {`Appliquer à partir du ${formatDayMonth(from)}`}
          </Button>
        </div>
      )}
    </div>
  );
}

const APPLIED = "Horaire appliqué.";

/**
 * The schedule card content as the page renders it: the form (keyed by the page on the saved schedule, so a
 * real change remounts it on the refreshed props) and the confirmation line, which this component keeps across
 * that remount. The line is always mounted, empty when there is nothing to say, so a screen reader announces it.
 */
export function EventScheduleSection({ formKey, ...props }: ScheduleFormProps & { formKey: string }) {
  const [applied, setApplied] = useState(false);
  return (
    <div className="space-y-5">
      <EventScheduleForm key={formKey} {...props} onApplied={() => setApplied(true)} onClear={() => setApplied(false)} />
      <p role="status" className={applied ? "text-sm" : "sr-only"}>
        {applied && APPLIED}
      </p>
    </div>
  );
}
