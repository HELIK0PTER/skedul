"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateSessionCapacity } from "@/server/pro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Edits a session's number of seats; it cannot go below the people already booked. */
export function SessionCapacityControl({
  sessionId,
  capacity,
  booked,
}: {
  sessionId: string;
  capacity: number;
  booked: number;
}) {
  const router = useRouter();
  const inputId = useId();
  const [value, setValue] = useState(String(capacity));
  const [pending, startTransition] = useTransition();
  const min = Math.max(1, booked);
  const next = parseInt(value, 10);
  const tooLow = !isNaN(next) && next < min;

  function handleSave() {
    if (isNaN(next) || next < min) return;
    startTransition(async () => {
      await updateSessionCapacity({ sessionId, capacity: next });
      router.refresh();
    });
  }

  return (
    <div className="grid gap-1">
      <label htmlFor={inputId} className="text-xs text-muted-foreground">
        Places
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          type="number"
          min={min}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          aria-invalid={tooLow || undefined}
          className="h-8 w-20 text-sm"
          disabled={pending}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={handleSave}
          disabled={pending || isNaN(next) || tooLow || next === capacity}
        >
          {pending ? "…" : "Enregistrer"}
        </Button>
      </div>
      {tooLow && (
        <p className="text-xs text-red-600">
          {booked === 0
            ? "Minimum 1 place."
            : `Minimum ${booked} : ${booked} ${booked > 1 ? "personnes sont déjà inscrites" : "personne est déjà inscrite"}.`}
        </p>
      )}
    </div>
  );
}
