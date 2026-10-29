"use client";

import { useEffect, useState } from "react";

import { GOOGLE_FAILED } from "@/lib/oauth-errors";

/**
 * The redirect to Google that the three Google buttons share (AuthForm, ClientSignInChoices, LinkGoogleForm): the
 * spinner flag, its reset when the browser's Back button restores the page from the back/forward cache with the
 * spinner still on, and the failure line when the redirect could not start.
 *
 * `redirect(start)` raises the flag and runs `start`, a Better Auth call that sends the browser to Google (it returns
 * a result with an `error`, or throws, when it cannot); on a failure it clears the flag and hands `failure` to
 * `onFailure`. A caller whose form shares the flag (the password step of LinkGoogleForm) raises and clears it with
 * `setLoading`.
 */
export function useGoogleRedirect(onFailure: (message: string) => void, failure: string = GOOGLE_FAILED) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLoading(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function redirect(start: () => Promise<{ error?: unknown }>): Promise<void> {
    setLoading(true);
    try {
      const result = await start();
      if (result.error) {
        onFailure(failure);
        setLoading(false);
      }
    } catch {
      onFailure(failure);
      setLoading(false);
    }
  }

  return { loading, setLoading, redirect };
}
