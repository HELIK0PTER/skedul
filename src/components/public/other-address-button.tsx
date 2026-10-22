"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";
import { REQUEST_FAILED } from "@/lib/pro-messages";
import { COPY } from "@/lib/public/messages";
import { returnPathOf } from "@/lib/public/sign-in-flow";

/**
 * « Utiliser une autre adresse » (L1390): signs the current account out, then reloads `path` in full. The full
 * navigation drops the router cache, so Back never shows the previous account's space (SEC-M12); a soft refresh of
 * the page would keep it. `path` is built by the page from its own route params and still goes through returnPathOf.
 */
export function OtherAddressButton({ path }: { path: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await signOut();
      if (res.error) {
        setError(REQUEST_FAILED);
        setPending(false);
        return;
      }
    } catch {
      setError(REQUEST_FAILED);
      setPending(false);
      return;
    }
    window.location.replace(returnPathOf(path));
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" size="sm" onClick={leave} disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {COPY.OTHER_ADDRESS}
      </Button>
      <FormError message={error} />
    </div>
  );
}
