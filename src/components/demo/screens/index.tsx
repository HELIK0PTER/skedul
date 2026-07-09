"use client";

import type { DemoState } from "../demo-script";
import { ClientBooking } from "./client-booking";
import { ClientConfirmation } from "./client-confirmation";
import { ClientPack } from "./client-pack";
import { ClientProfile } from "./client-profile";
import { ProEventTypes } from "./pro-event-types";
import { ProPacks } from "./pro-packs";
import { ProPlanning } from "./pro-planning";

export interface ScreenProps {
  state: DemoState;
}

/* Les stubs ci-dessous sont remplacés écran par écran (Tâches 7 à 12).
   Chaque stub expose les cibles data-demo de son étape pour que le
   squelette du tour soit déjà navigable de bout en bout. */
function Stub({ label, targets }: { label: string; targets: string[] }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 font-mono text-sm text-muted-foreground">
      <p>{label}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {targets.map((t) => (
          <span key={t} data-demo={t} className="rounded-lg border border-dashed border-border px-3 py-2 text-xs">
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DemoScreen({ state }: ScreenProps) {
  switch (state.screen) {
    case "client-profile":
      return <ClientProfile state={state} />;
    case "client-booking":
      return <ClientBooking state={state} />;
    case "client-pack":
      return <ClientPack state={state} />;
    case "client-confirmation":
      return <ClientConfirmation state={state} />;
    case "pro-planning":
      return <ProPlanning state={state} />;
    case "pro-event-types":
      return <ProEventTypes state={state} />;
    case "pro-packs":
      return <ProPacks state={state} />;
    case "pro-availability":
      return <Stub label="pro-availability" targets={["availability", "saturday-toggle"]} />;
    case "pro-branding":
      return <Stub label="pro-branding" targets={["swatch-turquoise", "layout-vitrine"]} />;
    case "outro":
      return null; // rendu hors cadre par DemoTour
  }
}
