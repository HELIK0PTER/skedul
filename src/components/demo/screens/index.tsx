"use client";

import type { DemoState } from "../demo-script";

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
      return <Stub label="client-profile" targets={["service-decouverte", "service-decouverte-cta", "pack-card", "pack-buy"]} />;
    case "client-booking":
      return <Stub label="client-booking" targets={["calendar", "slot-18:00", "slot-10:30", "field-name", "field-email", "pay-button", "credit-button"]} />;
    case "client-pack":
      return <Stub label="client-pack" targets={["field-name", "field-email", "pack-pay"]} />;
    case "client-confirmation":
      return <Stub label={`client-confirmation (${state.confirmation})`} targets={["book-with-credit"]} />;
    case "pro-planning":
      return <Stub label="pro-planning" targets={["session-lea"]} />;
    case "pro-event-types":
      return <Stub label="pro-event-types" targets={["edit-service"]} />;
    case "pro-packs":
      return <Stub label="pro-packs" targets={["edit-pack"]} />;
    case "pro-availability":
      return <Stub label="pro-availability" targets={["availability", "saturday-toggle"]} />;
    case "pro-branding":
      return <Stub label="pro-branding" targets={["swatch-turquoise", "layout-vitrine"]} />;
    case "outro":
      return null; // rendu hors cadre par DemoTour
  }
}
