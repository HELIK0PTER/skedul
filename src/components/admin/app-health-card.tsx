import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { healthAlerts, nightlyCheck } from "@/lib/admin-health";
import type { IntegrationMode } from "@/lib/admin-metrics";
import { ADMIN_TZ } from "@/lib/analytics";
import type { AppHealth } from "@/server/admin-queries";

const MODE: Record<
  IntegrationMode,
  { label: string; variant: "success" | "warning" | "neutral" }
> = {
  live: { label: "Réel", variant: "success" },
  test: { label: "Test", variant: "warning" },
  mock: { label: "Simulé", variant: "neutral" },
};

function onOff(on: boolean, yes: string, no: string) {
  return <Badge variant={on ? "success" : "neutral"}>{on ? yes : no}</Badge>;
}

const ALERT_CLASS = "flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-warning";

export function AppHealthCard({ health }: { health: AppHealth }) {
  const check = nightlyCheck(health.invariantViolations, ADMIN_TZ);
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Environnement", value: <Badge variant="outline">{health.appEnv}</Badge> },
    {
      label: "Paiements (Stripe)",
      value: <Badge variant={MODE[health.stripe].variant}>{MODE[health.stripe].label}</Badge>,
    },
    ...(health.stripe === "mock"
      ? []
      : [
          {
            label: "Webhook Stripe",
            value: health.stripeWebhook ? (
              <Badge variant="success">Configuré</Badge>
            ) : (
              <Badge variant="warning">Manquant</Badge>
            ),
          },
        ]),
    { label: "E-mails (Resend)", value: onOff(health.resend, "Réel", "Simulé") },
    { label: "Images (Blob)", value: onOff(health.blob, "Réel", "Simulé") },
    { label: "Google Agenda", value: onOff(health.google, "Configuré", "Non configuré") },
    {
      label: "Base de données",
      value: <span className="text-sm tabular-nums">{health.dbLatencyMs} ms</span>,
    },
    { label: "Contrôle nocturne", value: <Badge variant={check.tone}>{check.label}</Badge> },
  ];

  const alerts = healthAlerts(health, ADMIN_TZ);

  return (
    <Card>
      <CardHeader>
        <CardTitle>État de l&apos;app</CardTitle>
        <p className="truncate text-xs text-muted-foreground">{health.appUrl}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
            >
              <dt className="text-sm text-muted-foreground">{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
        {alerts.map((a) => {
          const content = (
            <>
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{a.text}</span>
            </>
          );
          return a.href ? (
            <Link key={a.key} href={a.href} className={`${ALERT_CLASS} hover:bg-amber-100`}>
              {content}
            </Link>
          ) : (
            <div key={a.key} className={ALERT_CLASS}>
              {content}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
