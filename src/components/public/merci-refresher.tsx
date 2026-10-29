"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** The cadence of the periodic read while a payment waits for its confirmation (Decision 14, spec L1460-1461). */
const REFRESH_EVERY_MS = 3000;
const REFRESH_MAX = 20;
const GIVE_UP_TEXT = "La confirmation vous sera envoyée par email.";

/**
 * Re-reads the page every 3 seconds while `active` (a purchase pending its confirmation: the webhook or the mock
 * checkout is about to mark it paid), 20 times at most, then says that the confirmation comes by e-mail. A periodic read
 * after no Server Action, so refreshing the router is safe here (the hang of the pinned Next version is a refresh queued
 * right after an action). The page renders it with `key={state.kind}`: a state change starts a fresh counter. The status
 * line is always mounted, so a screen reader announces the sentence when it appears.
 */
export function MerciRefresher({ active }: { active: boolean }) {
  const router = useRouter();
  const [spent, setSpent] = useState(false);

  useEffect(() => {
    if (!active) return;
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      router.refresh();
      if (count >= REFRESH_MAX) {
        clearInterval(timer);
        setSpent(true);
      }
    }, REFRESH_EVERY_MS);
    return () => clearInterval(timer);
  }, [active, router]);

  return (
    <p role="status" className={active && spent ? "text-sm text-zinc-600" : "sr-only"}>
      {active && spent ? GIVE_UP_TEXT : ""}
    </p>
  );
}
