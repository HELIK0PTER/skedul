"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { UPCOMING_HEADING_ID } from "@/lib/public/space-view";

type SpaceStatus = { message: string | null; announce: (message: string | null) => void };

const NO_STATUS: SpaceStatus = { message: null, announce: () => {} };
const SpaceStatusContext = createContext<SpaceStatus>(NO_STATUS);

/**
 * Owns the success line of the espace. A success removes the control that was clicked (the booking or the séance
 * leaves its list when the action revalidates the page), so a line written inside that row would vanish with it:
 * the leaves announce here instead, above the cards, in a region that is never unmounted.
 */
export function SpaceStatusProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const value = useMemo<SpaceStatus>(() => ({ message, announce: setMessage }), [message]);
  return <SpaceStatusContext.Provider value={value}>{children}</SpaceStatusContext.Provider>;
}

/** The status line: always mounted (a live region inserted together with its text is not reliably announced), visible only with a message. */
export function SpaceStatusLine() {
  const { message } = useContext(SpaceStatusContext);
  return (
    <p
      role="status"
      className={
        message
          ? "flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-700"
          : "sr-only"
      }
    >
      {message && <CheckCircle2 className="size-5 shrink-0" aria-hidden />}
      {message}
    </p>
  );
}

/** `announce(message)` shows a success line; `announce(null)` clears it (called when the next action starts). */
export function useSpaceStatus(): (message: string | null) => void {
  return useContext(SpaceStatusContext).announce;
}

/** The « Vos prochaines inscriptions » heading, the focus target after a success; a stable function so Dialog may call it when it closes. */
export function upcomingHeading(): HTMLElement | null {
  return document.getElementById(UPCOMING_HEADING_ID);
}
