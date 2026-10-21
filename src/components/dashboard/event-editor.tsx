"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { Check, Info, Loader2 } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import {
  QuestionsEditor,
  inputsFromDrafts,
  type QuestionDraft,
} from "@/components/dashboard/questions-editor";
import {
  RecurrenceEditor,
  RecurrencePreview,
  START_DATE_ERROR,
  START_DATE_FIELD_ERROR,
  START_TIME_ERROR,
  START_TIME_FIELD_ERROR,
  startProblem,
  submittableRule,
} from "@/components/dashboard/recurrence-editor";
import { Switch } from "@/components/dashboard/switch";
import { TypeChip } from "@/components/dashboard/type-chip";
import { WindowOverrideFields } from "@/components/dashboard/window-override-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { INLINE_LINK_CLASS } from "@/components/ui/link-class";
import { Textarea } from "@/components/ui/textarea";
import type { TypeOption } from "@/lib/back-office/catalog-reads";
import type { LaterSegment } from "@/lib/back-office/event-reads";
import { EVENT_DEFAULTS } from "@/lib/back-office/event-defaults";
import { plural } from "@/lib/back-office/format";
import { changedKeys, RECURRENCE_ERROR_KEYS, withoutErrorsUnder } from "@/lib/back-office/form-errors";
import { MODE_HELP } from "@/lib/back-office/labels";
import {
  defaultRecurrenceForm,
  ruleFromForm,
  type RecurrenceFormValue,
} from "@/lib/back-office/recurrence-form";
import type { BookingWindow } from "@/lib/booking-window";
import type { DateKey } from "@/lib/civil-date";
import { REQUEST_FAILED } from "@/lib/pro-messages";
import {
  eventInfoSchema,
  eventInputSchema,
  type EventInfoInput,
  type EventInput,
  type WindowOverrides,
} from "@/lib/tickets";
import { BOOKING_MODES, BOOKING_MODE_LABELS, BOUNDS, type BookingMode } from "@/lib/tickets-vocab";
import { parseFr } from "@/lib/zod-fr";
import { createEventAction, editEventInfoAction, previewNewEventAction } from "@/server/pro-catalog";

const PREVIEW_DEBOUNCE_MS = 600;
/** Dot colour of an archived type that is still linked (the page only knows its id and name). */
const ARCHIVED_DOT_COLOR = "#a1a1aa";
const LEGEND_CLASS = "mb-2 text-sm font-medium leading-none text-foreground";

const NO_OVERRIDES: WindowOverrides = {
  bookingHorizonDays: null,
  minNoticeMinutes: null,
  cancelDeadlineHours: null,
};
const NO_LINKED_ARCHIVED: { id: string; name: string }[] = [];

export type EventInfoValue = {
  title: string;
  description: string;
  location: string;
  color: string;
  bookingMode: BookingMode;
  isPrivate: boolean;
  capacity: number;
  overrides: WindowOverrides;
  ticketTypeIds: string[];
  questions: QuestionDraft[];
};

/**
 * The EventInfoInput of a form value ("" becomes null, questions go through inputsFromDrafts).
 * The ticked types are sent only for a « Sur tickets » event: the list is hidden in the other
 * modes, so ids ticked before switching must not link types to a free-registration event (the
 * form value keeps them, switching back restores the ticks).
 */
export function eventInfoInput(v: EventInfoValue): EventInfoInput {
  return {
    title: v.title,
    description: v.description.trim() === "" ? null : v.description,
    location: v.location.trim() === "" ? null : v.location,
    color: v.color,
    bookingMode: v.bookingMode,
    isPrivate: v.isPrivate,
    capacity: v.capacity,
    overrides: v.overrides,
    ticketTypeIds: v.bookingMode === "tickets" ? v.ticketTypeIds : [],
    questions: inputsFromDrafts(v.questions),
  };
}

function newEventInfo(): EventInfoValue {
  return {
    title: "",
    description: "",
    location: "",
    color: EVENT_DEFAULTS.color,
    bookingMode: EVENT_DEFAULTS.bookingMode,
    isPrivate: false,
    capacity: EVENT_DEFAULTS.capacity,
    overrides: NO_OVERRIDES,
    ticketTypeIds: [],
    questions: [],
  };
}

function hasOverrides(o: WindowOverrides): boolean {
  return o.bookingHorizonDays !== null || o.minNoticeMinutes !== null || o.cancelDeadlineHours !== null;
}

/** First message whose dotted key is `prefix` or starts with `prefix.` (parseFr keys: `questions.0.label`). */
function firstErrorUnder(errors: Record<string, string>, prefix: string): string | null {
  for (const [key, message] of Object.entries(errors)) {
    if (key === prefix || key.startsWith(`${prefix}.`)) return message;
  }
  return null;
}

function describedBy(id: string, hasHelp: boolean, error: string | null): string | undefined {
  const ids: string[] = [];
  if (hasHelp) ids.push(`${id}-help`);
  if (error) ids.push(`${id}-error`);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

function GroupError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-rose-700">
      {message}
    </p>
  );
}

/** After a refused submit: the controls rendered with aria-invalid take focus (the first one wins). `root` is the form, or the block that holds the fields. */
export function focusFirstInvalid(root: HTMLElement | null) {
  window.setTimeout(() => {
    root?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, 0);
}

export function EventInfoFields({
  idPrefix,
  value,
  onChange,
  typeOptions,
  linkedArchivedTypes,
  proWindow,
  fieldErrors,
  disabled = false,
}: {
  idPrefix: string;
  value: EventInfoValue;
  onChange: (next: EventInfoValue) => void;
  typeOptions: TypeOption[];
  linkedArchivedTypes: { id: string; name: string }[];
  proWindow: BookingWindow;
  fieldErrors: Record<string, string>;
  disabled?: boolean;
}) {
  const set = (patch: Partial<EventInfoValue>) => onChange({ ...value, ...patch });
  const [overridesOpen, setOverridesOpen] = useState(() => hasOverrides(value.overrides));

  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;
  const locationId = `${idPrefix}-location`;
  const colorId = `${idPrefix}-color`;
  const capacityId = `${idPrefix}-capacity`;
  const modeName = `${idPrefix}-mode`;
  const typesId = `${idPrefix}-types`;
  const questionsId = `${idPrefix}-questions`;
  const privateId = `${idPrefix}-private`;
  const overridesId = `${idPrefix}-overrides`;

  const titleError = fieldErrors.title ?? null;
  const descriptionError = fieldErrors.description ?? null;
  const locationError = fieldErrors.location ?? null;
  const colorError = fieldErrors.color ?? null;
  const capacityError = fieldErrors.capacity ?? null;
  const modeError = fieldErrors.bookingMode ?? null;
  const typesError = firstErrorUnder(fieldErrors, "ticketTypeIds");
  const questionsError = firstErrorUnder(fieldErrors, "questions");
  const overridesError = firstErrorUnder(fieldErrors, "overrides");

  const typeRows = [
    ...typeOptions.map((t) => ({ id: t.id, name: t.name, color: t.color, archived: false })),
    ...linkedArchivedTypes.map((t) => ({ id: t.id, name: t.name, color: ARCHIVED_DOT_COLOR, archived: true })),
  ];

  function toggleType(id: string) {
    set({
      ticketTypeIds: value.ticketTypeIds.includes(id)
        ? value.ticketTypeIds.filter((t) => t !== id)
        : [...value.ticketTypeIds, id],
    });
  }

  return (
    <div className="space-y-5">
      <FormField label="Titre" htmlFor={titleId} error={titleError}>
        <Input
          id={titleId}
          value={value.title}
          maxLength={BOUNDS.title}
          disabled={disabled}
          onChange={(e) => set({ title: e.target.value })}
        />
      </FormField>

      <FormField label="Description" htmlFor={descriptionId} optional error={descriptionError}>
        <Textarea
          id={descriptionId}
          rows={3}
          value={value.description}
          maxLength={BOUNDS.description}
          disabled={disabled}
          onChange={(e) => set({ description: e.target.value })}
        />
      </FormField>

      <FormField
        label="Lieu"
        htmlFor={locationId}
        optional
        help="Le lieu peut aussi changer séance par séance, depuis le planning."
        error={locationError}
      >
        <Input
          id={locationId}
          value={value.location}
          maxLength={BOUNDS.location}
          disabled={disabled}
          onChange={(e) => set({ location: e.target.value })}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Couleur" htmlFor={colorId} error={colorError}>
          <input
            id={colorId}
            type="color"
            value={value.color}
            disabled={disabled}
            onChange={(e) => set({ color: e.target.value })}
            className="h-10 w-16 cursor-pointer rounded-xl border border-input bg-card p-1 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </FormField>
        <FormField label="Places" htmlFor={capacityId} help="Par séance." error={capacityError}>
          <Input
            id={capacityId}
            type="number"
            inputMode="numeric"
            min={BOUNDS.capacity.min}
            max={BOUNDS.capacity.max}
            step={1}
            value={value.capacity > 0 ? value.capacity : ""}
            disabled={disabled}
            className="w-28"
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              set({ capacity: Number.isFinite(n) ? Math.trunc(n) : 0 });
            }}
          />
        </FormField>
      </div>

      <fieldset disabled={disabled} className="min-w-0 space-y-2">
        <legend className={LEGEND_CLASS}>Mode de réservation</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {BOOKING_MODES.map((mode) => {
            const id = `${modeName}-${mode}`;
            return (
              <label key={mode} htmlFor={id} className="relative block cursor-pointer">
                <input
                  id={id}
                  type="radio"
                  name={modeName}
                  checked={value.bookingMode === mode}
                  onChange={() => set({ bookingMode: mode })}
                  className="peer sr-only"
                />
                <span className="block h-full rounded-xl border border-input bg-card p-3 transition-colors hover:bg-muted peer-checked:border-primary peer-checked:bg-primary-muted peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
                  <span className="block text-sm font-medium">{BOOKING_MODE_LABELS[mode]}</span>
                  <span className="mt-1 block text-xs text-foreground/70">{MODE_HELP[mode]}</span>
                </span>
              </label>
            );
          })}
        </div>
        <GroupError id={`${modeName}-error`} message={modeError} />
      </fieldset>

      {value.bookingMode === "tickets" && (
        <fieldset
          disabled={disabled}
          className="min-w-0 space-y-2"
          aria-describedby={describedBy(typesId, true, typesError)}
        >
          <legend className={LEGEND_CLASS}>Tickets acceptés</legend>
          {typeRows.length === 0 ? (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Aucun type de ticket actif.</p>
              <Link
                href="/dashboard/tickets"
                className={`text-sm ${INLINE_LINK_CLASS}`}
              >
                Créer un type de ticket
              </Link>
            </div>
          ) : (
            <div className="flex flex-col">
              {typeRows.map((row) => (
                // Type names are typed by the pro: a long unbroken one wraps inside the row instead of widening the page.
                <label key={row.id} className="flex min-h-10 min-w-0 cursor-pointer items-center gap-2 wrap-anywhere">
                  <input
                    type="checkbox"
                    checked={value.ticketTypeIds.includes(row.id)}
                    onChange={() => toggleType(row.id)}
                    className="size-4 shrink-0 cursor-pointer accent-primary"
                  />
                  <span className="min-w-0">
                    <TypeChip name={row.name} color={row.color} archived={row.archived} />
                  </span>
                </label>
              ))}
            </div>
          )}
          {/* With no type to tick the list is just as empty: the warning applies in both cases. */}
          <p id={`${typesId}-help`} className="text-xs text-muted-foreground">
            {"Une liste vide n'accepte personne : l'événement sera signalé."}
          </p>
          <GroupError id={`${typesId}-error`} message={typesError} />
        </fieldset>
      )}

      <Switch
        id={privateId}
        checked={value.isPrivate}
        onCheckedChange={(isPrivate) => set({ isPrivate })}
        label="Privé"
        description="Masqué de votre page publique : vous y inscrivez vos clients vous-même."
        disabled={disabled}
      />

      <div className="space-y-2">
        <p id={questionsId} className="text-sm font-medium leading-none">
          {"Questions d'inscription"}
        </p>
        <QuestionsEditor
          idPrefix={`${idPrefix}-q`}
          value={value.questions}
          onChange={(questions) => set({ questions })}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          {"Posées au client quand il s'inscrit. Vous n'êtes jamais obligé d'y répondre."}
        </p>
        <GroupError id={`${questionsId}-error`} message={questionsError} />
      </div>

      <details
        open={overridesOpen || overridesError !== null}
        onToggle={(e) => setOverridesOpen(e.currentTarget.open)}
        className="rounded-xl border border-border px-4 py-3"
      >
        <summary className="cursor-pointer text-sm font-medium">Règles de réservation</summary>
        <div className="mt-4 space-y-2">
          <WindowOverrideFields
            idPrefix={overridesId}
            value={value.overrides}
            onChange={(overrides) => set({ overrides })}
            proWindow={proWindow}
            disabled={disabled}
          />
          <GroupError id={`${overridesId}-error`} message={overridesError} />
        </div>
      </details>
    </div>
  );
}

type SubmittableRule = NonNullable<ReturnType<typeof submittableRule>>;

/**
 * The server's answer to the live preview, kept with the submittable rule it was computed for (compared by
 * identity). A refusal (`ok: false`, a French message: start in the past, beyond the horizon) is kept too, so the
 * form can say why instead of going quiet.
 */
type NewEventPreview =
  | { forRule: SubmittableRule; ok: true; rdvConflicts: number; occurrenceCount: number }
  | { forRule: SubmittableRule; ok: false; error: string };

export function EventCreateForm({
  tz,
  nowIso,
  todayKey,
  initialStart,
  typeOptions,
  proWindow,
}: {
  tz: string;
  nowIso: string;
  todayKey: DateKey;
  initialStart: { startDate: DateKey; startMinute: number };
  typeOptions: TypeOption[];
  proWindow: BookingWindow;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const submitting = useRef(false);
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState(false);
  const [info, setInfo] = useState<EventInfoValue>(newEventInfo);
  const [recurrence, setRecurrence] = useState<RecurrenceFormValue>(() =>
    defaultRecurrenceForm(initialStart, EVENT_DEFAULTS.durationMin),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  /** Bumped with each failure of the create call itself: the effect below puts the focus on the error box once it is rendered. */
  const [errorFocus, setErrorFocus] = useState(0);
  const [preview, setPreview] = useState<NewEventPreview | null>(null);

  const locked = pending || created;
  const built = useMemo(() => submittableRule(recurrence), [recurrence]);

  // The submit button is disabled while the call runs, which drops the focus on the page: a keyboard or screen-reader user lands on the message.
  useEffect(() => {
    if (errorFocus > 0) errorBox.current?.focus();
  }, [errorFocus]);

  /**
   * An edit drops the messages of the fields it changed (their aria-invalid goes with them) and the summary
   * box above the button: the box describes the last submit, and the per-field messages that remain still
   * say what is wrong. The next submit validates everything again.
   */
  function editInfo(next: EventInfoValue) {
    // The ticket list only exists in « Sur tickets »: leaving or entering that mode settles its messages too.
    const keys = changedKeys(info, next).flatMap((key) => (key === "bookingMode" ? [key, "ticketTypeIds"] : [key]));
    setFieldErrors((errors) => withoutErrorsUnder(errors, keys));
    setFormError(null);
    setInfo(next);
  }

  function editRecurrence(next: RecurrenceFormValue) {
    const keys = changedKeys(recurrence, next).flatMap((key) => RECURRENCE_ERROR_KEYS[key]);
    setFieldErrors((errors) => withoutErrorsUnder(errors, keys));
    setFormError(null);
    setRecurrence(next);
  }

  useEffect(() => {
    if (!built) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      previewNewEventAction({ rule: built.rule, durationMin: built.durationMin })
        .then((res) => {
          if (cancelled) return;
          setPreview(
            res.ok
              ? { forRule: built, ok: true, rdvConflicts: res.rdvConflicts, occurrenceCount: res.occurrenceCount }
              : { forRule: built, ok: false, error: res.error },
          );
        })
        .catch(() => {
          // A call that fails outright (network) says nothing: the submit still reports what the server decides.
          if (!cancelled) setPreview(null);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [built]);

  // An answer for an older rule is never shown: neither its conflict count nor its refusal.
  const livePreview = preview !== null && preview.forRule === built ? preview : null;
  const previewRefusal = livePreview !== null && !livePreview.ok ? livePreview.error : null;
  const rdvConflicts = livePreview !== null && livePreview.ok ? livePreview.rdvConflicts : null;
  const occurrenceCount = livePreview !== null && livePreview.ok ? livePreview.occurrenceCount : 0;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;

    const rule = ruleFromForm(recurrence);
    if (!rule) {
      // ruleFromForm is null only for a cleared or malformed start date or start time: no schema can name the field.
      const dateWrong = startProblem(recurrence) === "date";
      setFieldErrors(
        dateWrong ? { "rule.startDate": START_DATE_FIELD_ERROR } : { "rule.startMinute": START_TIME_FIELD_ERROR },
      );
      setFormError(dateWrong ? START_DATE_ERROR : START_TIME_ERROR);
      focusFirstInvalid(formRef.current);
      return;
    }
    const input: EventInput = { ...eventInfoInput(info), durationMin: rule.durationMin, rule: rule.rule };
    const parsed = parseFr(eventInputSchema, input);
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      setFormError(parsed.error);
      focusFirstInvalid(formRef.current);
      return;
    }

    setFieldErrors({});
    setFormError(null);
    submitting.current = true;
    startTransition(async () => {
      try {
        const res = await createEventAction(input);
        if (!res.ok) {
          submitting.current = false;
          setFormError(res.error);
          setErrorFocus((n) => n + 1);
          return;
        }
        setCreated(true);
        router.push(`/dashboard/events/${res.eventId}`);
      } catch {
        submitting.current = false;
        setFormError(REQUEST_FAILED);
        setErrorFocus((n) => n + 1);
      }
    });
  }

  return (
    <form ref={formRef} noValidate onSubmit={submit} className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Informations</CardTitle>
        </CardHeader>
        <CardContent>
          <EventInfoFields
            idPrefix="new-event"
            value={info}
            onChange={editInfo}
            typeOptions={typeOptions}
            linkedArchivedTypes={NO_LINKED_ARCHIVED}
            proWindow={proWindow}
            fieldErrors={fieldErrors}
            disabled={locked}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Horaire</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <RecurrenceEditor
            idPrefix="new-event-rec"
            value={recurrence}
            onChange={editRecurrence}
            minDate={todayKey}
            fieldErrors={fieldErrors}
            disabled={locked}
          />
          <div>
            <RecurrencePreview value={recurrence} tz={tz} nowIso={nowIso} rdvConflicts={rdvConflicts} />
            {/* Always mounted, so a screen reader announces the line when it appears: the server's refusal or the séance count. */}
            <div aria-live="polite">
              {previewRefusal !== null ? (
                <p className="mt-2 text-xs text-rose-700">{previewRefusal}</p>
              ) : (
                occurrenceCount > 0 && (
                  <p className="mt-2 text-xs text-zinc-600">
                    {`${plural(occurrenceCount, "séance sera créée", "séances seront créées")}.`}
                  </p>
                )
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <FormError message={formError} ref={errorBox} tabIndex={-1} />
        <Button type="submit" disabled={locked}>
          {locked && <Loader2 className="size-4 animate-spin" />}
          {"Créer l'événement"}
        </Button>
      </div>
    </form>
  );
}

/** The information card of an existing event, edited in place (the page owns the Card chrome). */
export function EventInfoForm({
  eventId,
  seenVersion,
  initial,
  typeOptions,
  linkedArchivedTypes,
  proWindow,
  futureRegistrants,
  laterSegments,
  readOnly,
}: {
  eventId: string;
  seenVersion: number;
  initial: EventInfoValue;
  typeOptions: TypeOption[];
  linkedArchivedTypes: { id: string; name: string }[];
  proWindow: BookingWindow;
  futureRegistrants: number;
  /** The later segments of the series: the information reaches them too, each guarded by the version the page saw. */
  laterSegments: LaterSegment[];
  readOnly: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const submitting = useRef(false);
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<EventInfoValue>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  /** Bumped with each failure of the save call itself: the effect below puts the focus on the error box once it is rendered. */
  const [errorFocus, setErrorFocus] = useState(0);
  const [saved, setSaved] = useState(false);

  // The submit button is disabled while the call runs, which drops the focus on the page: a keyboard or screen-reader user lands on the message.
  useEffect(() => {
    if (errorFocus > 0) errorBox.current?.focus();
  }, [errorFocus]);

  /** An edit drops the messages of the fields it changed and the summary box above the button, like the create form. */
  function edit(next: EventInfoValue) {
    // The ticket list only exists in « Sur tickets »: leaving or entering that mode settles its messages too.
    const keys = changedKeys(value, next).flatMap((key) => (key === "bookingMode" ? [key, "ticketTypeIds"] : [key]));
    setFieldErrors((errors) => withoutErrorsUnder(errors, keys));
    setFormError(null);
    setSaved(false);
    setValue(next);
  }

  /** The saved location is the prop (it follows the page after every save), never the value the form started with. */
  const locationChanged = value.location.trim() !== initial.location.trim();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (readOnly || submitting.current) return;
    const info = eventInfoInput(value);
    const parsed = parseFr(eventInfoSchema, info);
    setSaved(false);
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      setFormError(parsed.error);
      focusFirstInvalid(formRef.current);
      return;
    }
    setFieldErrors({});
    setFormError(null);
    submitting.current = true;
    startTransition(async () => {
      try {
        // seenVersion is this render's prop: after a save the page re-renders with the new version.
        const res = await editEventInfoAction({ eventId, seenVersion, info, later: laterSegments });
        if (!res.ok) {
          setFormError(res.error);
          setErrorFocus((n) => n + 1);
          return;
        }
        // Saved here but not on the whole series: say so instead of the success line.
        if (res.incomplete !== null) {
          setFormError(res.incomplete);
          setErrorFocus((n) => n + 1);
          return;
        }
        setSaved(true);
      } catch {
        setFormError(REQUEST_FAILED);
        setErrorFocus((n) => n + 1);
      } finally {
        submitting.current = false;
      }
    });
  }

  return (
    <form ref={formRef} noValidate onSubmit={submit} className="space-y-5">
      <EventInfoFields
        idPrefix={`event-${eventId}`}
        value={value}
        onChange={edit}
        typeOptions={typeOptions}
        linkedArchivedTypes={linkedArchivedTypes}
        proWindow={proWindow}
        fieldErrors={fieldErrors}
        disabled={readOnly || pending}
      />
      {locationChanged && futureRegistrants > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-zinc-600" aria-hidden="true" />
          <span>
            {`${plural(futureRegistrants, "inscrit des séances à venir sera prévenu", "inscrits des séances à venir seront prévenus")} du changement de lieu.`}
          </span>
        </p>
      )}
      {laterSegments.length > 0 && !readOnly && (
        <p className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-zinc-600" aria-hidden="true" />
          <span>
            {`Ces informations s'appliquent aussi à ${plural(laterSegments.length, "segment suivant", "segments suivants")} de la série.`}
          </span>
        </p>
      )}
      <FormError message={formError} ref={errorBox} tabIndex={-1} />
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Enregistrer les informations
          </Button>
          {/* Always mounted, so a screen reader announces the confirmation when it appears. */}
          <p role="status" className="flex items-center gap-1.5 text-sm">
            {saved && (
              <>
                <Check className="size-4 text-green-700" aria-hidden="true" />
                Informations enregistrées.
              </>
            )}
          </p>
        </div>
      )}
    </form>
  );
}
