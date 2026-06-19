"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { saveAvailability } from "@/server/pro";
import { Button } from "@/components/ui/button";
import {
  WeeklyHoursEditor,
  byDayFromRules,
  rulesFromByDay,
  type ByDay,
} from "./weekly-hours-editor";

export function AvailabilityEditor({
  initial,
}: {
  initial: { dayOfWeek: number; startMinute: number; endMinute: number }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [byDay, setByDay] = useState<ByDay>(() => byDayFromRules(initial));

  function save() {
    const rules = rulesFromByDay(byDay);
    startTransition(async () => {
      await saveAvailability(rules);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <WeeklyHoursEditor
        value={byDay}
        onChange={(next) => {
          setByDay(next);
          setSaved(false);
        }}
      />
      <div className="flex items-center gap-3 pt-2">
        <Button onClick={save} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Enregistrer les disponibilités
        </Button>
        {saved && <span className="text-sm text-success">Enregistré ✓</span>}
      </div>
    </div>
  );
}
