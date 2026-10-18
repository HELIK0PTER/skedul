"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { REQUEST_FAILED } from "@/components/dashboard/event-editor";
import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteEventCopy, type ConfirmCopy } from "@/lib/back-office/confirm-copy";
import type { DeletePreview } from "@/lib/back-office/event-reads";
import { formatDayMonth, formatDayMonthYear, maxKey, type DateKey } from "@/lib/civil-date";
import { deleteEventFromAction, deleteEventPreviewAction } from "@/server/pro-catalog";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLOSED_COPY: ConfirmCopy = { title: "", body: "", confirm: "" };
const NO_FUTURE = "Plus aucune séance à venir.";
const DONE = "Les séances à venir sont supprimées.";

type Target = { fromDate: DateKey; preview: DeletePreview };

export function EventDeleteCard({
  eventId,
  seenVersion,
  title,
  todayKey,
  fromDate,
  initialPreview,
}: {
  eventId: string;
  seenVersion: number;
  title: string;
  todayKey: DateKey;
  fromDate: DateKey | null;
  initialPreview: DeletePreview | null;
}) {
  const router = useRouter();
  const errorBox = useRef<HTMLParagraphElement>(null);
  const [loadingWhole, startWhole] = useTransition();
  const [loadingCustom, startCustom] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped when reading the consequences fails (the dialog is not open then): the effect below puts the focus on the error box. */
  const [errorFocus, setErrorFocus] = useState(0);
  const [done, setDone] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const minCustom = fromDate === null ? todayKey : maxKey(todayKey, fromDate);
  const [customDate, setCustomDate] = useState<string>(minCustom);
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    if (errorFocus > 0) errorBox.current?.focus();
  }, [errorFocus]);

  if (fromDate === null) {
    return <p className="text-sm text-zinc-600">{NO_FUTURE}</p>;
  }
  const from: DateKey = fromDate;

  const busy = loadingWhole || loadingCustom || deleting || leaving;
  const dialogPending = loadingWhole || deleting || leaving;
  const copy: ConfirmCopy = target
    ? deleteEventCopy({
        title,
        fromLabel: target.preview.deleteWhole ? null : formatDayMonth(target.fromDate),
        ...target.preview,
      })
    : CLOSED_COPY;

  /** The consequences of deleting from `date`, read now; a refusal or a failure is shown (below the buttons) and returns null. */
  async function load(date: DateKey): Promise<DeletePreview | null> {
    try {
      const res = await deleteEventPreviewAction({ eventId, fromDate: date });
      if (res.ok) return res.preview;
      setError(res.error);
    } catch {
      setError(REQUEST_FAILED);
    }
    setErrorFocus((n) => n + 1);
    return null;
  }

  function openWhole() {
    if (busy) return;
    setError(null);
    setDone(false);
    // The page data can be minutes old: the dialog opens at once on it, with both buttons disabled until the fresh answer replaces it.
    if (initialPreview !== null) setTarget({ fromDate: from, preview: initialPreview });
    startWhole(async () => {
      const preview = await load(from);
      // A refusal closes the dialog: its counts would otherwise sit next to the refusal.
      setTarget(preview === null ? null : { fromDate: from, preview });
    });
  }

  function openCustom() {
    if (busy) return;
    if (!DATE_KEY_PATTERN.test(customDate) || customDate < minCustom) {
      setCustomError(`Choisissez une date à partir du ${formatDayMonthYear(minCustom)}.`);
      return;
    }
    setCustomError(null);
    setError(null);
    setDone(false);
    const date: DateKey = customDate;
    startCustom(async () => {
      const preview = await load(date);
      if (preview !== null) setTarget({ fromDate: date, preview });
    });
  }

  function close() {
    if (dialogPending) return;
    setTarget(null);
    setError(null);
  }

  function confirm() {
    if (target === null || dialogPending) return;
    const date = target.fromDate;
    startDeleting(async () => {
      try {
        // seenVersion is this render's prop, read at submit time.
        const res = await deleteEventFromAction({ eventId, seenVersion, fromDate: date });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (res.deletedEvent) {
          setLeaving(true);
          router.push("/dashboard/events");
          return;
        }
        setTarget(null);
        setCustomOpen(false);
        setDone(true);
      } catch {
        setError(REQUEST_FAILED);
      }
    });
  }

  const dateId = `delete-${eventId}-from`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive" onClick={openWhole} disabled={busy}>
          {loadingWhole && target === null ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          {"Supprimer l'événement"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          aria-expanded={customOpen}
          onClick={() => setCustomOpen((open) => !open)}
          disabled={busy}
        >
          Supprimer à partir du…
        </Button>
      </div>

      {customOpen && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <FormField label="À partir du" htmlFor={dateId} error={customError}>
            <Input
              id={dateId}
              type="date"
              min={minCustom}
              value={customDate}
              disabled={busy}
              className="w-44"
              onChange={(e) => {
                setCustomDate(e.target.value);
                setCustomError(null);
              }}
            />
          </FormField>
          <Button type="button" variant="secondary" size="sm" onClick={openCustom} disabled={busy}>
            {loadingCustom && <Loader2 className="size-4 animate-spin" />}
            Voir les conséquences
          </Button>
        </div>
      )}

      <FormError message={target === null ? error : null} ref={errorBox} tabIndex={-1} />
      {/* Always mounted, so a screen reader announces the confirmation when it appears. */}
      <p role="status" className={done ? "text-sm" : "sr-only"}>
        {done && DONE}
      </p>

      {/* Keyed on the waiting state: « Retour » is disabled while the fresh answer (or the delete) is awaited, so its autoFocus is ignored at mount; the dialog remounts when the wait ends and « Retour » takes the focus (also after a failed delete). */}
      <ConfirmDialog
        key={dialogPending ? "wait" : "ready"}
        open={target !== null}
        copy={copy}
        pending={dialogPending}
        error={target !== null ? error : null}
        onConfirm={confirm}
        onClose={close}
      />
    </div>
  );
}
