"use client";

import { useId, useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { QuestionsEditor, draftsFromRows, inputsFromDrafts, type QuestionDraft } from "@/components/dashboard/questions-editor";
import { Switch } from "@/components/dashboard/switch";
import { WindowOverrideFields } from "@/components/dashboard/window-override-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  freeLockedHelp,
  isFreeSalesRefusal,
  rdvErrorField,
  rdvFormFromType,
  rdvPatchFromForm,
  type RdvField,
  type RdvFormValues,
} from "@/lib/back-office/rdv-form";
import type { QuestionRow } from "@/lib/booking/answers";
import type { BookingWindow } from "@/lib/booking-window";
import type { WindowOverrides } from "@/lib/tickets";
import { BOUNDS } from "@/lib/tickets-vocab";
import { setTypeQuestionsAction, updateTicketTypeAction } from "@/server/pro-catalog";

const INFO_FIELD_PREFIXES = ["Nom :", "Description :", "Couleur :"] as const;
const QUESTIONS_HELP = "Posées au client quand il réserve un rendez-vous de ce type. Vous n'êtes jamais obligé d'y répondre.";

/** « Informations »: name, description and colour of the type. A failed save keeps the form filled. */
export function TicketTypeInfoForm({
  ticketTypeId,
  initial,
}: {
  ticketTypeId: string;
  initial: { name: string; description: string; color: string };
}) {
  const uid = useId();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [color, setColor] = useState(initial.color);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const under = (prefix: string): string | null => (error !== null && error.startsWith(prefix) ? error : null);
  const general = error !== null && !INFO_FIELD_PREFIXES.some((p) => error.startsWith(p)) ? error : null;

  function edit<T>(set: (value: T) => void, value: T) {
    set(value);
    setSaved(false);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const trimmed = description.trim();
      const res = await updateTicketTypeAction({
        ticketTypeId,
        patch: { name, description: trimmed === "" ? null : trimmed, color },
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <FormField label="Nom" htmlFor={`${uid}-name`} error={under("Nom :")}>
        <Input
          id={`${uid}-name`}
          value={name}
          onChange={(e) => edit(setName, e.target.value)}
          maxLength={80}
          autoComplete="off"
        />
      </FormField>
      <FormField label="Description" htmlFor={`${uid}-description`} optional error={under("Description :")}>
        <Textarea
          id={`${uid}-description`}
          value={description}
          onChange={(e) => edit(setDescription, e.target.value)}
          maxLength={2000}
          rows={3}
        />
      </FormField>
      <FormField label="Couleur" htmlFor={`${uid}-color`} error={under("Couleur :")}>
        <input
          id={`${uid}-color`}
          type="color"
          value={color}
          onChange={(e) => edit(setColor, e.target.value)}
          className="block h-10 w-16 cursor-pointer rounded-xl border border-input bg-card p-1"
        />
      </FormField>
      <FormError message={general} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Enregistrer
        </Button>
        {saved && (
          <span role="status" className="flex items-center gap-1.5 text-sm text-green-700">
            <Check className="size-4" />
            Enregistré
          </span>
        )}
      </div>
    </form>
  );
}

/**
 * A whole number of minutes followed by « min ». FormField hands its aria props to this element, which forwards
 * them to the input itself (not to the wrapper), as a custom control must.
 */
function MinutesInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex items-center gap-2">
      <Input type="number" inputMode="numeric" step={5} className="w-28" {...props} />
      <span className="text-sm text-muted-foreground">min</span>
    </div>
  );
}

/** « RDV libre »: the option, duration, margins, « Gratuit » and the booking rules of the type. */
export function RdvSettingsForm({
  ticketTypeId,
  initial,
  proWindow,
  freeLockReasons,
}: {
  ticketTypeId: string;
  initial: {
    rdvEnabled: boolean;
    rdvFree: boolean;
    rdvDurationMin: number | null;
    rdvBufferBeforeMin: number;
    rdvBufferAfterMin: number;
    rdvOverrides: WindowOverrides;
  };
  proWindow: BookingWindow;
  /** What blocks « Gratuit » right now (freeLockReasons of the page): empty when the switch is open. */
  freeLockReasons: readonly string[];
}) {
  const uid = useId();
  const [values, setValues] = useState<RdvFormValues>(() => rdvFormFromType(initial));
  const [error, setError] = useState<{ field: RdvField | null; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  // The rules block starts open when the type already overrides something.
  const [rulesOpen] = useState(() => Object.values(initial.rdvOverrides).some((v) => v !== null));

  const set = <K extends keyof RdvFormValues>(key: K, value: RdvFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };
  const under = (field: RdvField): string | null => (error !== null && error.field === field ? error.message : null);
  const general = error !== null && error.field === null ? error.message : null;
  const freeLocked = freeLockReasons.length > 0 && !initial.rdvFree;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const built = rdvPatchFromForm(values);
    if (!built.ok) {
      setError({ field: built.field, message: built.error });
      return;
    }
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateTicketTypeAction({ ticketTypeId, patch: built.patch });
      if (!res.ok) {
        setError({ field: rdvErrorField(res.error), message: res.error });
        // A fact appeared since the page was read (a checkout started, a ticket booked): the saved state is still « not free ».
        if (isFreeSalesRefusal(res.error)) setValues((current) => ({ ...current, free: false }));
        return;
      }
      setSaved(true);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Switch
        id={`${uid}-enabled`}
        checked={values.enabled}
        onCheckedChange={(value) => set("enabled", value)}
        label="Réservable en RDV libre"
        description="Vos clients choisissent un créneau dans vos disponibilités."
      />

      {values.enabled && (
        <>
          <FormField label="Durée" htmlFor={`${uid}-duration`} error={under("duration")}>
            <MinutesInput
              id={`${uid}-duration`}
              min={BOUNDS.rdvDurationMin.min}
              max={BOUNDS.rdvDurationMin.max}
              value={values.duration}
              onChange={(e) => set("duration", e.target.value)}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Marge avant" htmlFor={`${uid}-before`} error={under("before")}>
              <MinutesInput
                id={`${uid}-before`}
                min={BOUNDS.rdvBufferMin.min}
                max={BOUNDS.rdvBufferMin.max}
                value={values.before}
                onChange={(e) => set("before", e.target.value)}
              />
            </FormField>
            <FormField label="Marge après" htmlFor={`${uid}-after`} error={under("after")}>
              <MinutesInput
                id={`${uid}-after`}
                min={BOUNDS.rdvBufferMin.min}
                max={BOUNDS.rdvBufferMin.max}
                value={values.after}
                onChange={(e) => set("after", e.target.value)}
              />
            </FormField>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">Temps libre réservé avant ou après chaque rendez-vous.</p>

          <div className="space-y-1.5">
            <Switch
              id={`${uid}-free`}
              checked={values.free}
              onCheckedChange={(value) => set("free", value)}
              label="Gratuit"
              description="Sans ticket ni paiement, par exemple un appel découverte."
              disabled={freeLocked}
            />
            {freeLocked && <p className="text-xs text-muted-foreground">{freeLockedHelp(freeLockReasons)}</p>}
          </div>

          <details open={rulesOpen} className="rounded-xl border border-border">
            <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Règles de réservation de ce type
            </summary>
            <div className="border-t border-border p-4">
              <WindowOverrideFields
                idPrefix={`${uid}-rules`}
                value={values.overrides}
                onChange={(next) => set("overrides", next)}
                proWindow={proWindow}
              />
            </div>
          </details>
        </>
      )}

      <FormError message={general} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Enregistrer le RDV libre
        </Button>
        {saved && (
          <span role="status" className="flex items-center gap-1.5 text-sm text-green-700">
            <Check className="size-4" />
            Enregistré
          </span>
        )}
      </div>
    </form>
  );
}

/** Questions asked when a client books an RDV of this type. */
export function TypeQuestionsForm({ ticketTypeId, questions }: { ticketTypeId: string; questions: QuestionRow[] }) {
  const uid = useId();
  const signature = JSON.stringify(questions);
  const [seenSignature, setSeenSignature] = useState(signature);
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() => draftsFromRows(questions));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // After a save the page re-reads the questions (new ids for the new ones): follow the server then, never on an unrelated refresh.
  if (signature !== seenSignature) {
    setSeenSignature(signature);
    setDrafts(draftsFromRows(questions));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await setTypeQuestionsAction({ ticketTypeId, questions: inputsFromDrafts(drafts) });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-sm text-muted-foreground">{QUESTIONS_HELP}</p>
      <QuestionsEditor
        idPrefix={`${uid}-questions`}
        value={drafts}
        onChange={(next) => {
          setDrafts(next);
          setSaved(false);
        }}
        disabled={pending}
      />
      <FormError message={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Enregistrer les questions
        </Button>
        {saved && (
          <span role="status" className="flex items-center gap-1.5 text-sm text-green-700">
            <Check className="size-4" />
            Enregistré
          </span>
        )}
      </div>
    </form>
  );
}
