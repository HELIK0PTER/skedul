"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { Button } from "@/components/ui/button";
import { firstRangeProblem } from "@/lib/back-office/week-hours";
import { REQUEST_FAILED } from "@/lib/pro-messages";
import { saveAvailabilityAction } from "@/server/pro";
import {
  WeeklyHoursEditor,
  byDayFromRules,
  rulesFromByDay,
  type ByDay,
  type InvalidTime,
} from "./weekly-hours-editor";

export function AvailabilityEditor({
  initial,
}: {
  initial: { dayOfWeek: number; startMinute: number; endMinute: number }[];
}) {
  const [pending, startTransition] = useTransition();
  const errorBox = useRef<HTMLParagraphElement>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped with each failed save: the effect below puts the focus on the error box once it is rendered. */
  const [errorFocus, setErrorFocus] = useState(0);
  const [byDay, setByDay] = useState<ByDay>(() => byDayFromRules(initial));
  /** The time input the last refused save was about (aria-invalid until the next edit). */
  const [invalid, setInvalid] = useState<InvalidTime | null>(null);

  // The button is disabled while the call runs, which drops the focus on the page: a keyboard or screen-reader user lands on the message.
  useEffect(() => {
    if (errorFocus > 0) errorBox.current?.focus();
  }, [errorFocus]);

  function fail(message: string) {
    setError(message);
    setErrorFocus((n) => n + 1);
  }

  function save() {
    if (pending) return;
    setError(null);
    setSaved(false);
    // The server only says « Plage horaire invalide. »: name the day and the range here, before any call.
    const problem = firstRangeProblem(byDay);
    if (problem) {
      setInvalid({ day: problem.day, index: problem.index, field: problem.field });
      fail(problem.message);
      return;
    }
    setInvalid(null);
    const rules = rulesFromByDay(byDay);
    startTransition(async () => {
      try {
        const res = await saveAvailabilityAction(rules);
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
    <div className="space-y-3">
      <WeeklyHoursEditor
        value={byDay}
        invalid={invalid}
        onChange={(next) => {
          setByDay(next);
          setSaved(false);
          setError(null);
          setInvalid(null);
        }}
      />
      <FormError message={error} ref={errorBox} tabIndex={-1} />
      <div className="flex items-center gap-3 pt-2">
        <Button type="button" onClick={save} disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Enregistrer les disponibilités
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
    </div>
  );
}
