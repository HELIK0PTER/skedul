"use client";

import type { DemoState } from "../demo-script";
import { ClientBooking } from "./client-booking";
import { ClientConfirmation } from "./client-confirmation";
import { ClientPack } from "./client-pack";
import { ClientProfile } from "./client-profile";
import { ProAvailability } from "./pro-availability";
import { ProBranding } from "./pro-branding";
import { ProEventTypes } from "./pro-event-types";
import { ProPacks } from "./pro-packs";
import { ProPlanning } from "./pro-planning";

export interface ScreenProps {
  state: DemoState;
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
      return <ProAvailability state={state} />;
    case "pro-branding":
      return <ProBranding state={state} />;
    case "outro":
      return null; // rendu hors cadre par DemoTour
  }
}
