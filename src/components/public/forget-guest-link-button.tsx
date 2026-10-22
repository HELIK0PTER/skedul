"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { FormError } from "@/components/dashboard/form-error";
import { Button } from "@/components/ui/button";
import { callOrFail } from "@/lib/pro-messages";
import { COPY } from "@/lib/public/messages";
import { forgetGuestLinkAction } from "@/server/client";

/**
 * « Ce n'est pas moi » (Decision 63, SEC-I4): clears the personal-link cookie of this pro's path through the action,
 * then reloads the espace in full, where the anonymous visitor finds the code form. Not destructive (no data is lost,
 * the link in the e-mail still works), so there is no confirmation.
 */
export function ForgetGuestLinkButton({ slug }: { slug: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function forget() {
    setError(null);
    startTransition(async () => {
      const res = await callOrFail(() => forgetGuestLinkAction({ slug }));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      window.location.replace(`/${slug}/espace`);
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="ghost" size="sm" onClick={forget} disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {COPY.NOT_ME}
      </Button>
      <FormError message={error} />
    </div>
  );
}
