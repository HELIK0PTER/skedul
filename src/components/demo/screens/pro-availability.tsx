import { useMemo } from "react";
import { Info } from "lucide-react";

import { WeeklyHoursEditor, emptyByDay, type ByDay } from "@/components/dashboard/weekly-hours-editor";
import { timeZoneLabel } from "@/lib/timezones";
import { DECOUVERTE_HOURS, DEMO_TZ, ticketType } from "../demo-data";
import type { DemoState } from "../demo-script";
import { ProPageHeader, ProShell } from "./pro-shell";

/** The scale of the reused WeeklyHoursEditor, so that its seven day cards (two ranges on weekdays) fit the frame. */
const EDITOR_SCALE = 0.62;

export function ProAvailability({ state }: { state: DemoState }) {
  const byDay = useMemo<ByDay>(() => {
    const value = emptyByDay();
    for (const d of [1, 2, 3, 4, 5]) {
      value[d] = [
        { start: "10:00", end: "13:00" },
        { start: "17:30", end: "20:30" },
      ];
    }
    if (state.saturdayEnabled) value[6] = [{ start: "10:00", end: "13:00" }];
    return value;
  }, [state.saturdayEnabled]);

  return (
    <ProShell active="availability">
      <ProPageHeader
        title="Disponibilités (RDV libre)"
        description={`Vos horaires pour les rendez-vous libres (fuseau : ${timeZoneLabel(DEMO_TZ)}). Un type de ticket peut avoir ses propres horaires.`}
      />
      <p className="mt-3 flex items-start gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-zinc-600">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        {`${ticketType("decouverte").name} : ses propres horaires. ${DECOUVERTE_HOURS}.`}
      </p>
      {/* Scaled down so that the seven day cards fit the frame's 840 px. The tour's cursor finds the Samedi switch through
          getBoundingClientRect, which honours the transform. */}
      <div
        data-demo="availability"
        className="mt-3 origin-top-left"
        style={{ transform: `scale(${EDITOR_SCALE})`, width: `${100 / EDITOR_SCALE}%` }}
      >
        <WeeklyHoursEditor value={byDay} onChange={() => {}} />
      </div>
    </ProShell>
  );
}
