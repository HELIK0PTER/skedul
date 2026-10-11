"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ban, Check, Hammer, Lock, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  RESOLUTION_LABELS,
  STAGE_LABELS,
  TRACK_STEPS,
  canAcceptForDevelopment,
  canSetStage,
  formatEta,
  type SupportResolution,
  type SupportStage,
  type SupportTrack,
} from "@/lib/support";
import { cn } from "@/lib/utils";
import {
  acceptForDevelopment,
  reopenSupportRequest,
  resolveSupportRequest,
  setSupportEta,
  setSupportStage,
  type AdminSupportResult,
} from "@/server/support-admin";

type PanelRequest = {
  id: string;
  track: SupportTrack;
  stage: SupportStage;
  resolution: SupportResolution | null;
  eta: string | null;
};

/** Right column of /admin/support/[id]: step, development switch, ETA, decline / close / reopen. */
export function SupportAdminPanel({ request }: { request: PanelRequest }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"accept" | SupportResolution | null>(null);
  const [eta, setEta] = useState(request.eta ?? "");
  const [reason, setReason] = useState("");
  const ended = request.resolution !== null;

  function run(action: () => Promise<AdminSupportResult>) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setDialog(null);
        setReason("");
        router.refresh();
      } catch {
        setError("Connexion perdue. Réessayez.");
      }
    });
  }

  // each dialog starts clean: no error or reason left over from another one
  const openDialog = (next: "accept" | SupportResolution) => {
    setError(null);
    setReason("");
    setDialog(next);
  };

  const closeDialog = () => {
    if (pending) return;
    setDialog(null);
    setError(null);
    setReason("");
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Étape</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {TRACK_STEPS[request.track].map((s) => {
            const current = s === request.stage;
            return (
              <button
                key={s}
                type="button"
                disabled={ended || pending || current || !canSetStage(request.track, s)}
                onClick={() => run(() => setSupportStage({ id: request.id, stage: s }))}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default",
                  current
                    ? "border-primary bg-accent font-semibold text-accent-foreground"
                    : "border-border hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent",
                )}
              >
                {STAGE_LABELS[s]}
                {current && <Check className="size-4" aria-hidden />}
              </button>
            );
          })}
          {request.resolution && (
            <div className="mt-3 rounded-xl bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              Demande {RESOLUTION_LABELS[request.resolution].toLowerCase()}. Rouvrez-la pour changer d’étape.
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2 w-full"
                disabled={pending}
                onClick={() => run(() => reopenSupportRequest({ id: request.id }))}
              >
                <RotateCcw />
                Rouvrir
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {request.track === "development" && !ended && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Livraison estimée</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() => setSupportEta({ id: request.id, eta: eta || null }));
              }}
              className="flex gap-2"
            >
              <Input
                type="date"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                aria-label="Date de livraison estimée"
              />
              <Button type="submit" variant="secondary" disabled={pending || eta === (request.eta ?? "")}>
                Enregistrer
              </Button>
            </form>
            {request.eta && (
              <p className="mt-2 text-xs text-muted-foreground">
                Affichée à l’utilisateur : {formatEta(request.eta)}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!ended && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {canAcceptForDevelopment(request) && (
              <Button type="button" className="w-full" disabled={pending} onClick={() => openDialog("accept")}>
                <Hammer />
                Accepter en développement
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={pending}
              onClick={() => openDialog("declined")}
            >
              <Ban />
              Ne pas retenir
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={pending}
              onClick={() => openDialog("closed")}
            >
              <Lock />
              Fermer la demande
            </Button>
          </CardContent>
        </Card>
      )}

      {error && !dialog && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Dialog open={dialog === "accept"} onClose={closeDialog} title="Accepter en développement">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => acceptForDevelopment({ id: request.id, eta: eta || null }));
          }}
          className="space-y-4"
        >
          <p className="text-sm text-muted-foreground">
            La demande passe sur le suivi en 6 étapes, à l’étape « Acceptée ». L’utilisateur est prévenu par e-mail.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="accept-eta">Livraison estimée (facultatif)</Label>
            <Input id="accept-eta" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeDialog}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending}>
              Accepter
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={dialog === "declined" || dialog === "closed"}
        onClose={closeDialog}
        title={dialog === "declined" ? "Ne pas retenir la demande" : "Fermer la demande"}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (dialog !== "declined" && dialog !== "closed") return;
            const resolution = dialog;
            run(() => resolveSupportRequest({ id: request.id, resolution, reason }));
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="resolution-reason">
              {dialog === "declined"
                ? "Raison (visible par l’utilisateur)"
                : "Message (facultatif, visible par l’utilisateur)"}
            </Label>
            <Textarea
              id="resolution-reason"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required={dialog === "declined"}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {dialog === "closed"
              ? "Une demande fermée ne peut plus recevoir de réponse de l’utilisateur."
              : "L’utilisateur pourra encore répondre dans le fil."}
          </p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeDialog}>
              Annuler
            </Button>
            <Button type="submit" variant={dialog === "declined" ? "destructive" : "primary"} disabled={pending}>
              {dialog === "declined" ? "Ne pas retenir" : "Fermer"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
