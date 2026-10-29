"use client";

import type { DemoState } from "../demo-script";
import { ClientEspace } from "./client-espace";
import { ClientMerci } from "./client-merci";
import { ClientPage } from "./client-page";
import { ClientRdv } from "./client-rdv";
import { ClientSeance } from "./client-seance";
import { ProAvailability } from "./pro-availability";
import { ProBranding } from "./pro-branding";
import { ProClient } from "./pro-client";
import { ProEvents } from "./pro-events";
import { ProPlanning } from "./pro-planning";
import { ProTickets } from "./pro-tickets";

export interface ScreenProps {
  state: DemoState;
}

export function DemoScreen({ state }: ScreenProps) {
  switch (state.screen) {
    case "client-page":
      return <ClientPage state={state} />;
    case "client-seance":
      return <ClientSeance state={state} />;
    case "client-merci":
      return <ClientMerci state={state} />;
    case "client-rdv":
      return <ClientRdv state={state} />;
    case "client-espace":
      return <ClientEspace state={state} />;
    case "pro-planning":
      return <ProPlanning state={state} />;
    case "pro-events":
      return <ProEvents state={state} />;
    case "pro-tickets":
      return <ProTickets state={state} />;
    case "pro-availability":
      return <ProAvailability state={state} />;
    case "pro-client":
      return <ProClient state={state} />;
    case "pro-branding":
      return <ProBranding state={state} />;
    case "outro":
      return null; // drawn outside the frame by DemoTour
  }
}
