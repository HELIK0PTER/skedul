"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import {
  finalizeGoogleConnection,
  disconnectGoogleCalendar,
} from "@/server/pro";

export function GoogleCalendarCard(props: {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // After the OAuth redirect, finalize (create the Skedul calendar) once.
  useEffect(() => {
    if (params.get("google") === "connected") {
      finalizeGoogleConnection().then((r) => {
        if (!r.ok) setError(r.error ?? "La connexion à Google Agenda a échoué.");
        router.replace("/dashboard/settings");
      });
    }
  }, [params, router]);

  const connect = async () => {
    setBusy(true);
    try {
      await authClient.linkSocial({
        provider: "google",
        scopes: ["https://www.googleapis.com/auth/calendar"],
        callbackURL: "/dashboard/settings?google=connected",
      });
    } catch {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectGoogleCalendar();
    } finally {
      setBusy(false);
      router.refresh();
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarCheck className="size-5 text-primary" />
          Google Agenda
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Vos séances Skedul apparaissent dans un agenda « Skedul » dédié.
        </p>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive mb-3">{error}</p>}
        {!props.configured ? (
          <div className="space-y-2">
            <Button disabled>Connecter Google Agenda</Button>
            <p className="text-xs text-muted-foreground">
              La synchronisation n&apos;est pas encore configurée sur ce
              déploiement.
            </p>
          </div>
        ) : props.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              Connecté
              {props.accountEmail ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {props.accountEmail}
                </span>
              ) : null}
            </p>
            <Button variant="outline" onClick={disconnect} disabled={busy}>
              Déconnecter
            </Button>
          </div>
        ) : (
          <Button onClick={connect} disabled={busy}>
            Connecter Google Agenda
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
