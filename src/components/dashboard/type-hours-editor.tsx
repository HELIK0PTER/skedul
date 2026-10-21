"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { Switch } from "@/components/dashboard/switch";
import { WeeklyHoursEditor, byDayFromRules, rulesFromByDay, type ByDay } from "@/components/dashboard/weekly-hours-editor";
import { Button } from "@/components/ui/button";
import { mergeAvailabilityRules } from "@/lib/back-office/week-hours";
import type { AvailabilityRuleInput } from "@/lib/tickets";
import { setTypeHoursAction } from "@/server/pro-catalog";

/**
 * Weekly hours of an RDV type. Off: the type follows the general availability.
 * On: its own hours replace them, started from a copy of the general ones.
 */
export function TypeHoursEditor({
  ticketTypeId,
  ownHours,
  globalHours,
}: {
  ticketTypeId: string;
  ownHours: AvailabilityRuleInput[];
  globalHours: AvailabilityRuleInput[];
}) {
  const hadOwn = ownHours.length > 0;
  const [enabled, setEnabled] = useState(hadOwn);
  const [byDay, setByDay] = useState<ByDay>(() => byDayFromRules(hadOwn ? ownHours : globalHours));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState<"save" | "revert" | null>(null);
  const [pending, startTransition] = useTransition();

  function run(kind: "save" | "revert", rules: AvailabilityRuleInput[]) {
    setError(null);
    setSaved(false);
    setRunning(kind);
    startTransition(async () => {
      const res = await setTypeHoursAction({ ticketTypeId, rules });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (kind === "revert") {
        setByDay(byDayFromRules(globalHours));
        setEnabled(false);
      } else {
        setSaved(true);
      }
    });
  }

  function save() {
    const rules = rulesFromByDay(byDay);
    if (rules.length === 0) {
      setError("Ajoutez au moins une plage horaire, ou revenez aux disponibilités générales.");
      return;
    }
    if (rules.some((r) => !Number.isInteger(r.startMinute) || !Number.isInteger(r.endMinute))) {
      setError("Une plage horaire est incomplète.");
      return;
    }
    // Overlapping and touching ranges of a day are saved as one (the server does the same): show what is saved.
    // An inverted range goes to the server as it is, which refuses it in French (merging could swallow it).
    if (rules.every((r) => r.startMinute < r.endMinute)) {
      const merged = mergeAvailabilityRules(rules);
      setByDay(byDayFromRules(merged));
      run("save", merged);
      return;
    }
    run("save", rules);
  }

  return (
    <div className="space-y-4">
      <Switch
        id={`${ticketTypeId}-own-hours`}
        checked={enabled}
        onCheckedChange={(value) => {
          setEnabled(value);
          setSaved(false);
          setError(null);
        }}
        label="Horaires propres à ce type"
        disabled={pending}
      />

      {enabled ? (
        <>
          <div className="-mx-1 overflow-x-auto px-1">
            <WeeklyHoursEditor
              value={byDay}
              onChange={(next) => {
                setByDay(next);
                setSaved(false);
              }}
            />
          </div>
          <FormError message={error} />
          <div className="flex items-center gap-3">
            <Button type="button" onClick={save} disabled={pending}>
              {pending && running === "save" && <Loader2 className="animate-spin" />}
              Enregistrer les horaires
            </Button>
            {saved && (
              <span role="status" className="flex items-center gap-1.5 text-sm text-green-700">
                <Check className="size-4" />
                Enregistré
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {hadOwn
              ? "Vos horaires propres restent actifs tant que vous ne revenez pas aux disponibilités générales."
              : "Ce type suit vos disponibilités générales."}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild variant="secondary" size="sm">
              <Link href="/dashboard/availability">Voir mes disponibilités</Link>
            </Button>
            {hadOwn && (
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => run("revert", [])}>
                {pending && running === "revert" && <Loader2 className="animate-spin" />}
                Revenir aux disponibilités générales
              </Button>
            )}
          </div>
          <FormError message={error} />
        </div>
      )}
    </div>
  );
}
