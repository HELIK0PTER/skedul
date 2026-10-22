"use client";

import { startTransition, useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Button } from "@/components/ui/button";
import type { ConfirmCopy } from "@/lib/back-office/confirm-copy";
import { COPY } from "@/lib/public/messages";
import { PUBLIC_UNEXPECTED, type PublicResult } from "@/lib/public/result";
import { revokeMyLinksAction } from "@/server/client";

const REVOKE_COPY: ConfirmCopy = {
  title: "Déconnecter vos liens personnels ?",
  body: "Les liens reçus par email cessent de fonctionner. Les prochains emails contiendront un nouveau lien.",
  confirm: "Déconnecter mes liens",
};

/**
 * « Déconnecter mes liens » (spec L1371, L1384): every personal link of her rows stops working, and the next e-mails
 * carry a new one. A destructive gesture: the dialog states what happens first (its own focus trap and focus
 * restore keep the keyboard inside, then bring it back to this button, which stays on the page). The success line
 * sits in a status region that is always mounted.
 */
export function RevokeMyLinksButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startRevoke] = useTransition();

  function openDialog() {
    setError(null);
    setDone(false);
    setOpen(true);
  }

  function confirm() {
    startRevoke(async () => {
      let res: PublicResult<{ customers: number }>;
      try {
        res = await revokeMyLinksAction();
      } catch {
        res = { ok: false, error: PUBLIC_UNEXPECTED };
      }
      startTransition(() => {
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setOpen(false);
        setDone(true);
      });
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" size="sm" className="w-full sm:w-auto" onClick={openDialog}>
        {COPY.REVOKE_MY_LINKS}
      </Button>
      <div role="status" className="text-sm text-green-700">
        {done && <p>{COPY.LINKS_REVOKED}</p>}
      </div>
      <ConfirmDialog
        open={open}
        copy={REVOKE_COPY}
        pending={pending}
        error={error}
        onConfirm={confirm}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
