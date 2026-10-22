"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { GoogleLogo } from "@/components/auth/google-logo";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth-client";
import { COPY } from "@/lib/public/messages";
import { googleCallbacks, passwordSignInHref, returnPathOf } from "@/lib/public/sign-in-flow";

const GOOGLE_FAILED = "La connexion avec Google a échoué. Réessayez.";

/**
 * The two other ways in, under the code form: « Continuer avec Google » (only when a Google OAuth client is configured)
 * and « J'ai un mot de passe » (the sign-in page, which brings the visitor back here). Mount it only for an anonymous
 * visitor (canOfferCodeSignIn, risk 7). `returnTo` is the page's own path; it goes through returnPathOf so a query
 * (a purchase reference, a payment flag) never reaches Google or the sign-in page (SEC-M7).
 */
export function ClientSignInChoices({ returnTo, googleEnabled }: { returnTo: string; googleEnabled: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = returnPathOf(returnTo);

  // Back from Google with the browser's Back button restores this page from the back/forward cache with the spinner still on.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLoading(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function onGoogle() {
    setError(null);
    setLoading(true);
    try {
      // Better Auth redirects the browser to Google; the callbacks bring a client back to this page, never to the pro onboarding.
      const result = await signIn.social({ provider: "google", ...googleCallbacks(back) });
      if (result.error) {
        setError(GOOGLE_FAILED);
        setLoading(false);
      }
    } catch {
      setError(GOOGLE_FAILED);
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-zinc-600">
        <span aria-hidden className="h-px flex-1 bg-border" />
        ou
        <span aria-hidden className="h-px flex-1 bg-border" />
      </div>
      <div role="alert">
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </div>
      {googleEnabled && (
        <Button type="button" variant="secondary" className="w-full" onClick={onGoogle} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" aria-hidden /> : <GoogleLogo className="size-4" />}
          {COPY.GOOGLE}
        </Button>
      )}
      <Button asChild variant="ghost" className="w-full">
        <Link href={passwordSignInHref(back)}>{COPY.PASSWORD_LINK}</Link>
      </Button>
    </div>
  );
}
