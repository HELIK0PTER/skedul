"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { FormError } from "@/components/dashboard/form-error";
import { FormField } from "@/components/dashboard/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteEventCopy, deleteEventDoneNotice, type ConfirmCopy } from "@/lib/back-office/confirm-copy";
import type { DeletePreview } from "@/lib/back-office/event-reads";
import { formatDayMonth, formatDayMonthYear, maxKey, type DateKey } from "@/lib/civil-date";
import { REQUEST_FAILED } from "@/lib/pro-messages";
import { deleteEventFromAction, deleteEventPreviewAction } from "@/server/pro-catalog";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLOSED_COPY: ConfirmCopy = { title: "", body: "", confirm: "" };
const NO_FUTURE = "Plus aucune séance à venir.";

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
  const wholeButton = useRef<HTMLButtonElement>(null);
  const customButton = useRef<HTMLButtonElement>(null);
  /** The trigger the dialog gives the focus back to: the button that opened it (it was disabled while the answer loaded, so it never held the focus). */
  const returnTo = useRef<HTMLElement | null>(null);
  const returnFocus = useCallback(() => returnTo.current, []);
  /** Set when a delete went through and the dialog closed while the buttons were still disabled: the focus is put on « Supprimer l'événement » when they come back. */
  const refocusAfterDelete = useRef(false);
  const [loadingWhole, startWhole] = useTransition();
  const [loadingCustom, startCustom] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped when reading the consequences fails (the dialog is not open then): the effect below puts the focus on the error box. */
  const [errorFocus, setErrorFocus] = useState(0);
  /** The line of a delete that went through (null: none yet), worded after the date it started from. */
  const [done, setDone] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const minCustom = fromDate === null ? todayKey : maxKey(todayKey, fromDate);
  const [customDate, setCustomDate] = useState<string>(minCustom);
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    if (errorFocus > 0) errorBox.current?.focus();
  }, [errorFocus]);

  const busy = loadingWhole || loadingCustom || deleting || leaving;
  useEffect(() => {
    if (!refocusAfterDelete.current || busy) return;
    refocusAfterDelete.current = false;
    wholeButton.current?.focus();
  }, [busy]);

  if (fromDate === null) {
    return <p className="text-sm text-zinc-600">{NO_FUTURE}</p>;
  }
  const from: DateKey = fromDate;


  const dialogPending = loadingWhole || deleting || leaving;
  const copy: ConfirmCopy = target
    ? deleteEventCopy({
        title,
        fromLabel: target.preview.deleteWhole ? null : formatDayMonth(target.fromDate),
        ...target.preview,
        laterSegments: target.preview.laterSegments.length,
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
    returnTo.current = wholeButton.current;
    setError(null);
    setDone(null);
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
    setDone(null);
    returnTo.current = customButton.current;
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
    const later = target.preview.laterSegments;
    startDeleting(async () => {
      try {
        // seenVersion is this render's prop, read at submit time.
        const res = await deleteEventFromAction({ eventId, seenVersion, fromDate: date, later });
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
        // The buttons are still disabled while this action ends and the custom panel is gone: the focus comes back when they are enabled.
        refocusAfterDelete.current = true;
        // Part of the series went and part did not: the line says so instead of "done".
        if (res.incomplete !== null) {
          setError(res.incomplete);
          setErrorFocus((n) => n + 1);
          return;
        }
        setDone(deleteEventDoneNotice({ fromLabel: date === from ? null : formatDayMonth(date) }));
      } catch {
        setError(REQUEST_FAILED);
      }
    });
  }

  const dateId = `delete-${eventId}-from`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button ref={wholeButton} type="button" variant="destructive" onClick={openWhole} disabled={busy}>
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
          <Button ref={customButton} type="button" variant="secondary" size="sm" onClick={openCustom} disabled={busy}>
            {loadingCustom && <Loader2 className="size-4 animate-spin" />}
            Voir les conséquences
          </Button>
        </div>
      )}

      <FormError message={target === null ? error : null} ref={errorBox} tabIndex={-1} />
      {/* Always mounted, so a screen reader announces the confirmation when it appears. */}
      <p role="status" className={done ? "text-sm" : "sr-only"}>
        {done}
      </p>

      {/* One dialog instance for the whole flow: « Retour » is disabled while the fresh answer (or the delete) is awaited and takes the focus when the wait ends (ConfirmDialog); the focus goes back to the button that opened it. */}
      <ConfirmDialog
        open={target !== null}
        copy={copy}
        pending={dialogPending}
        error={target !== null ? error : null}
        onConfirm={confirm}
        onClose={close}
        returnFocusTo={returnFocus}
      />
    </div>
  );
}
