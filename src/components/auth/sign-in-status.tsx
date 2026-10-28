"use client";

import { useEffect, useSyncExternalStore } from "react";

import { createLineStore } from "@/lib/public/release-line";

/** The one sign-in line of the page: written by the inline `EmailCodeForm`, read by `SignInStatus`. */
const store = createLineStore();

/**
 * Says `text` in the page's sign-in status region (an empty text clears it). The inline code form calls it once a code
 * is accepted, right before the refresh that replaces the form with the client's space: the module state outlives the
 * form, so the line is still there after the swap.
 */
export function announceSignIn(text: string): void {
  store.set(text);
}

/**
 * The always-mounted status region of an inline code sign-in (AUTH-1, WCAG 4.1.3), on the `ReleaseStatus` pattern.
 * /mon-espace and /{slug}/espace render it once, outside every state branch, so it survives the refresh that unmounts
 * the form. It is read by screen readers only: the sighted visitor sees the space appear and the focus on the page
 * heading. It starts and ends empty, so a line from an earlier page never shows on the next.
 */
export function SignInStatus() {
  const text = useSyncExternalStore(store.subscribe, store.get, () => "");
  useEffect(() => {
    store.set("");
    return () => store.set("");
  }, []);
  return <p role="status" className="sr-only">{text}</p>;
}
