"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";
import { GENERIC_ERROR } from "@/lib/auth-messages";
import { returnPathOf } from "@/lib/public/sign-in-flow";

/**
 * « Se déconnecter » on /mon-espace and on the espace of a pro. After the sign-out the page is reloaded with a full
 * navigation that REPLACES the history entry (SEC-M12): never a router refresh, which would keep the router cache of
 * the signed-in space, and Back never shows it again. `returnTo` is the page the caller built from its own route
 * params (the espace of the pro; /mon-espace by default) and still goes through returnPathOf. A failed sign-out says
 * so and stays on the page, still signed in.
 */
export function ClientSignOutButton({ returnTo = "/mon-espace" }: { returnTo?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function out() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await signOut();
      if (res.error) {
        setError(GENERIC_ERROR);
        setPending(false);
        return;
      }
    } catch {
      setError(GENERIC_ERROR);
      setPending(false);
      return;
    }
    window.location.replace(returnPathOf(returnTo));
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="ghost" size="sm" className="w-full sm:w-auto" onClick={out} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
        Se déconnecter
      </Button>
      <div role="alert">{error && <p className="text-sm text-rose-700">{error}</p>}</div>
    </div>
  );
}
