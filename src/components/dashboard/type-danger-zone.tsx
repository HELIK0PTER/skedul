"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { FormError } from "@/components/dashboard/form-error";
import { Button } from "@/components/ui/button";
import { archiveTypeCopy, deleteTypeCopy } from "@/lib/back-office/confirm-copy";
import { callOrFail } from "@/lib/pro-messages";
import { deleteTicketTypeAction, setTicketTypeArchivedAction } from "@/server/pro-catalog";

const EXPLANATION = "Archiver retire le type de votre page sans rien perdre. Supprimer l'efface, ou l'archive s'il a déjà servi.";

/** « Archiver ou supprimer »: every destructive step is confirmed with its consequences (confirm-copy). */
export function TypeDangerZone({
  ticketTypeId,
  name,
  archived,
  used,
  acceptedBy,
}: {
  ticketTypeId: string;
  name: string;
  archived: boolean;
  used: boolean;
  acceptedBy: readonly string[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"archive" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setDialog(null);
    setError(null);
  }

  function setArchived(next: boolean) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await callOrFail(() => setTicketTypeArchivedAction({ ticketTypeId, archived: next }));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDialog(null);
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await callOrFail(() => deleteTicketTypeAction({ ticketTypeId }));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.outcome === "deleted") {
        router.push("/dashboard/tickets");
        return;
      }
      setDialog(null);
      setNotice("Ce type a déjà servi : il a été archivé.");
    });
  }

  return (
    <div className="space-y-4">
      {archived ? (
        <p className="text-sm text-muted-foreground">Archivé : ce type n&apos;est plus proposé. Ses tickets restent dans les portefeuilles.</p>
      ) : (
        <p className="text-sm text-muted-foreground">{EXPLANATION}</p>
      )}
      <div className="flex flex-wrap gap-3">
        {archived ? (
          <Button onClick={() => setArchived(false)} disabled={pending}>
            {pending && dialog === null && <Loader2 className="animate-spin" />}
            Désarchiver
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setDialog("archive")} disabled={pending}>
            Archiver
          </Button>
        )}
        <Button
          variant="destructive"
          aria-label={`Supprimer le type ${name}`}
          onClick={() => setDialog("delete")}
          disabled={pending}
        >
          Supprimer
        </Button>
      </div>
      <FormError message={dialog === null ? error : null} />
      {/* Always mounted, so a screen reader announces the notice when it appears. */}
      <p role="status" className={notice !== null ? "rounded-lg bg-muted px-3 py-2 text-sm" : "sr-only"}>
        {notice}
      </p>

      <ConfirmDialog
        open={dialog === "archive"}
        copy={archiveTypeCopy({ name })}
        tone="primary"
        pending={pending}
        error={error}
        onConfirm={() => setArchived(true)}
        onClose={close}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        copy={deleteTypeCopy({ name, used, acceptedBy })}
        tone={used ? "primary" : "destructive"}
        pending={pending}
        error={error}
        onConfirm={remove}
        onClose={close}
      />
    </div>
  );
}
