"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deletionConfirmed, type UserRole } from "@/lib/admin-params";
import { deleteUser } from "@/server/admin";

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("fr-FR")} ${n > 1 ? many : one}`;

export function DeleteUserCard({
  userId,
  email,
  role,
  pro,
  stats,
  deletion,
}: {
  userId: string;
  email: string;
  role: UserRole;
  pro: { slug: string } | null;
  stats: {
    eventTypes: number;
    bookings: number;
    upcoming: number;
    customers: number;
    packsSold: number;
  } | null;
  deletion: { creditsOutstanding: number; clientRecordsElsewhere: number };
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirmed = deletionConfirmed(typed, email);

  function onDelete() {
    setError(null);
    startTransition(async () => {
      // On success the action redirects to /admin/users and never resolves here.
      const res = await deleteUser({ userId, confirmEmail: typed });
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <Card className="mt-6 border-destructive/30">
      <CardHeader>
        <CardTitle>Supprimer le compte</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {role === "admin" ? (
          <p className="text-sm text-muted-foreground">
            Retirez d&apos;abord le rôle admin pour pouvoir supprimer ce compte.
          </p>
        ) : !open ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full justify-start border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={() => setOpen(true)}
          >
            <Trash2 />
            Supprimer le compte…
          </Button>
        ) : (
          <>
            <p className="text-sm">Suppression définitive, sans retour possible. Seront supprimés :</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Le compte, ses connexions et ses sessions.</li>
              {pro && stats && (
                <li>
                  {`La page /${pro.slug} et tout son contenu : ${plural(stats.eventTypes, "prestation", "prestations")}, ${plural(stats.bookings, "réservation confirmée", "réservations confirmées")}, ${plural(stats.customers, "client", "clients")}, ${plural(stats.packsSold, "pack vendu", "packs vendus")}.`}
                </li>
              )}
            </ul>

            {stats && stats.upcoming > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-warning">
                {`${plural(stats.upcoming, "réservation à venir disparaîtra", "réservations à venir disparaîtront")} sans que les clients soient prévenus.`}
              </p>
            )}
            {deletion.creditsOutstanding > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-warning">
                {`${plural(deletion.creditsOutstanding, "crédit prépayé non utilisé sera perdu", "crédits prépayés non utilisés seront perdus")} pour ses clients, sans remboursement automatique.`}
              </p>
            )}
            {deletion.clientRecordsElsewhere > 0 && (
              <p className="text-sm text-muted-foreground">
                {`Ses ${plural(deletion.clientRecordsElsewhere, "fiche client chez un autre pro est conservée", "fiches client chez d'autres pros sont conservées")}, mais détachées du compte.`}
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="confirm-delete">{`Pour confirmer, tapez ${email}`}</Label>
              <Input
                id="confirm-delete"
                value={typed}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="flex-1"
                disabled={!confirmed || pending}
                onClick={onDelete}
              >
                Supprimer définitivement
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setTyped("");
                  setError(null);
                }}
              >
                Annuler
              </Button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
