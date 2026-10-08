"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, LogIn, LogOut, ShieldCheck, ShieldOff, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  BAN_DURATION_LABELS,
  type BanDuration,
  type UserRole,
} from "@/lib/admin-params";
import {
  reactivateUser,
  setAdminRole,
  signOutEverywhere,
  startImpersonation,
  suspendUser,
  type AdminActionResult,
} from "@/server/admin";

type ActionId = "suspend" | "reactivate" | "signout" | "impersonate" | "grant" | "revoke";

export function UserActions({
  userId,
  isSelf,
  role,
  isPro,
  suspended,
}: {
  userId: string;
  isSelf: boolean;
  role: UserRole;
  isPro: boolean;
  suspended: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<ActionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<BanDuration>("7d");

  function run(action: () => Promise<AdminActionResult>, success: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await action();
      setConfirming(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(success);
      router.refresh();
    });
  }

  /** First click asks for confirmation; "Confirmer" runs the action. */
  function confirmable(
    id: ActionId,
    label: string,
    icon: React.ReactNode,
    variant: "secondary" | "outline" | "destructive",
    onConfirm: () => void,
  ) {
    if (confirming === id) {
      return (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={variant === "destructive" ? "destructive" : "primary"}
            className="flex-1"
            disabled={pending}
            onClick={onConfirm}
          >
            Confirmer
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setConfirming(null)}
          >
            Annuler
          </Button>
        </div>
      );
    }
    return (
      <Button
        type="button"
        size="sm"
        variant={variant}
        className="w-full justify-start"
        disabled={pending}
        onClick={() => setConfirming(id)}
      >
        {icon}
        {label}
      </Button>
    );
  }

  if (isSelf) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            C&apos;est votre compte : aucune action disponible ici.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {role === "admin" ? (
          confirmable("revoke", "Retirer le rôle admin", <ShieldOff />, "outline", () =>
            run(() => setAdminRole({ userId, admin: false }), "Rôle admin retiré."),
          )
        ) : (
          <>
            {suspended ? (
              confirmable("reactivate", "Réactiver le compte", <Undo2 />, "secondary", () =>
                run(() => reactivateUser(userId), "Compte réactivé."),
              )
            ) : (
              <div className="space-y-2 rounded-xl border border-border p-3">
                <p className="text-sm font-medium">Suspendre le compte</p>
                <div className="space-y-1.5">
                  <Label htmlFor="ban-reason">Motif (optionnel)</Label>
                  <Textarea
                    id="ban-reason"
                    value={reason}
                    maxLength={500}
                    onChange={(e) => setReason(e.target.value)}
                    className="min-h-16"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ban-duration">Durée</Label>
                  <Select
                    id="ban-duration"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value as BanDuration)}
                  >
                    {(Object.keys(BAN_DURATION_LABELS) as BanDuration[]).map((d) => (
                      <option key={d} value={d}>
                        {BAN_DURATION_LABELS[d]}
                      </option>
                    ))}
                  </Select>
                </div>
                {confirmable("suspend", "Suspendre", <Ban />, "destructive", () =>
                  run(() => suspendUser({ userId, reason, duration }), "Compte suspendu."),
                )}
                <p className="text-xs text-muted-foreground">
                  Connexion bloquée et sessions coupées
                  {isPro ? ", page publique hors ligne" : ""}.
                </p>
              </div>
            )}
            {confirmable("signout", "Déconnecter partout", <LogOut />, "secondary", () =>
              run(() => signOutEverywhere(userId), "Toutes ses sessions sont fermées."),
            )}
            {isPro &&
              !suspended &&
              confirmable("impersonate", "Se connecter en tant que", <LogIn />, "secondary", () =>
                run(() => startImpersonation(userId), "Ouverture du compte…"),
              )}
            {!suspended &&
              confirmable("grant", "Nommer admin", <ShieldCheck />, "outline", () =>
                run(() => setAdminRole({ userId, admin: true }), "Rôle admin attribué."),
              )}
          </>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg bg-success-muted px-3 py-2 text-sm text-success">
            {notice}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
