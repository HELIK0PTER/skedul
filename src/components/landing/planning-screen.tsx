"use client";

import { useSyncExternalStore } from "react";

import type { DemoState } from "@/components/demo/demo-script";
import { ProPlanning } from "@/components/demo/screens/pro-planning";

const noop = () => () => {};

/**
 * The pro planning preview lays out the current week, so the server (UTC)
 * and the browser (the visitor's zone) can disagree on dates near midnight.
 * It is decorative and below the fold: render it on the client only, and
 * let the frame around it hold the space meanwhile.
 */
export function PlanningScreen({ state }: { state: DemoState }) {
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  return mounted ? <ProPlanning state={state} /> : null;
}
