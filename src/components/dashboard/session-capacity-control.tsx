"use client";

import { useId, useState, useTransition } from "react";

import { FormError } from "@/components/dashboard/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { plural } from "@/lib/back-office/format";
import { BOUNDS } from "@/lib/tickets-vocab";
import { updateCapacityAction } from "@/server/pro-planning";

const REQUEST_FAILED = "La demande n'a pas abouti. Vérifiez votre connexion et réessayez.";

/**
 * Number of seats of a séance. It cannot go under the people already
 * registered. On a recurring event the pro chooses between this séance
 * (which then keeps its own capacity) and every coming séance whose capacity
 * was not changed by hand. `seenStartsAt` and `seenVersion` are props of the
 * current page data: after a save the page is refreshed by the server action
 * and the next save starts from the new values.
 */
export function SessionCapacityControl({
  occurrenceId,
  seenStartsAt,
  capacity,
  seatsTaken,
  seenVersion,
  recurring,
}: {
  occurrenceId: string;
  seenStartsAt: string;
  capacity: number;
  seatsTaken: number;
  seenVersion: number | null;
  recurring: boolean;
}) {
  const inputId = useId();
  const [value, setValue] = useState(String(capacity));
  const [seenCapacity, setSeenCapacity] = useState(capacity);
  const [scope, setScope] = useState<"occurrence" | "event">("occurrence");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // The capacity changed under us (a refresh after a save): the field follows it.
  if (capacity !== seenCapacity) {
    setSeenCapacity(capacity);
    setValue(String(capacity));
  }

  const max = BOUNDS.capacity.max;
  const min = Math.max(BOUNDS.capacity.min, seatsTaken);
  const next = value.trim() === "" ? Number.NaN : Number(value);
  const isInteger = Number.isInteger(next);
  const tooLow = isInteger && next < min;
  const tooHigh = isInteger && next > max;
  const valid = isInteger && !tooLow && !tooHigh;
  const choosesScope = recurring && seenVersion !== null;
  const unchanged = scope === "occurrence" && next === capacity;

  function save() {
    if (!valid || unchanged || pending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const res = await updateCapacityAction({
          occurrenceId,
          seenStartsAt,
          scope: choosesScope ? scope : "occurrence",
          capacity: next,
          seenVersion,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setSaved(true);
      } catch {
        setError(REQUEST_FAILED);
      }
    });
  }

  const helpId = `${inputId}-help`;
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={inputId}>Places</Label>
        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            aria-invalid={tooLow || tooHigh || undefined}
            aria-describedby={tooLow || tooHigh ? helpId : undefined}
            className="h-9 w-24"
            readOnly={pending}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={pending || !valid || unchanged}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
        {tooLow && (
          <p id={helpId} className="text-xs text-rose-700">
            {seatsTaken === 0
              ? "Minimum 1 place."
              : `Minimum ${seatsTaken} : ${plural(seatsTaken, "personne est déjà inscrite", "personnes sont déjà inscrites")}.`}
          </p>
        )}
        {tooHigh && (
          <p id={helpId} className="text-xs text-rose-700">
            {`Maximum ${max}.`}
          </p>
        )}
      </div>

      {choosesScope && (
        <fieldset className="grid gap-1.5" disabled={pending}>
          <legend className="sr-only">Portée de la modification</legend>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${inputId}-scope`}
              className="size-4 accent-primary"
              checked={scope === "occurrence"}
              onChange={() => {
                setScope("occurrence");
                setSaved(false);
              }}
            />
            Cette séance
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${inputId}-scope`}
              className="size-4 accent-primary"
              checked={scope === "event"}
              onChange={() => {
                setScope("event");
                setSaved(false);
              }}
            />
            Toutes les séances à venir
          </label>
          {scope === "event" && (
            <p className="text-xs text-muted-foreground">Sauf celles dont vous avez déjà changé la capacité.</p>
          )}
        </fieldset>
      )}

      {saved && (
        <p role="status" className="text-xs text-foreground">
          Places enregistrées.
        </p>
      )}
      <FormError message={error} />
    </form>
  );
}
