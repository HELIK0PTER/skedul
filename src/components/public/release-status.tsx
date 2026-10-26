"use client";

import { useEffect, useSyncExternalStore } from "react";

import { createLineStore } from "@/lib/public/release-line";

/** The one line of the page: written by the blocks that can release a seat, read by `ReleaseStatus`. */
const store = createLineStore();

/**
 * Says `text` in the page's release status region (an empty text clears it). The payment block calls it with an empty text
 * when a release starts and with the outcome's sentence when the answer comes back, so two releases in a row are both
 * announced. It works whether or not the block that calls it is still on the page: the module state outlives it.
 */
export function announceRelease(text: string): void {
  store.set(text);
}

/**
 * The always-mounted status region for what a release did (WCAG 4.1.3). The séance page renders it once, outside every
 * condition, so that it survives the revalidation that removes the payment block of the Owner's own pending purchase once
 * she releases it. It is read by screen readers only: the sighted visitor sees the notice above the booking form that the
 * revalidated page shows. It starts and ends empty, so a sentence from an earlier page never shows on the next.
 */
export function ReleaseStatus() {
  const text = useSyncExternalStore(store.subscribe, store.get, () => "");
  useEffect(() => {
    store.set("");
    return () => store.set("");
  }, []);
  return <p role="status" className="sr-only">{text}</p>;
}
