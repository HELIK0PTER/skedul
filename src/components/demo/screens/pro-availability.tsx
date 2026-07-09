import { useMemo } from "react";

import {
  WeeklyHoursEditor,
  emptyByDay,
  type ByDay,
} from "@/components/dashboard/weekly-hours-editor";
import { ProShell } from "./pro-shell";
import type { ScreenProps } from "./index";

export function ProAvailability({ state }: ScreenProps) {
  const byDay = useMemo<ByDay>(() => {
    const value = emptyByDay();
    for (const d of [1, 2, 3, 4, 5]) value[d] = [{ start: "09:00", end: "17:00" }];
    if (state.saturdayEnabled) value[6] = [{ start: "09:00", end: "12:00" }];
    return value;
  }, [state.saturdayEnabled]);

  return (
    <ProShell active="availability">
      <h1 className="text-xl font-bold tracking-tight">Disponibilités</h1>
      <p className="text-sm text-muted-foreground">Vos horaires récurrents (fuseau Europe/Paris).</p>
      <div data-demo="availability" className="mt-2">
        <WeeklyHoursEditor value={byDay} onChange={() => {}} />
      </div>
    </ProShell>
  );
}
