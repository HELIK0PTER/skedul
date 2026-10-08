import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { IntegrationMode } from "@/lib/admin-metrics";
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

// A JS string on purpose: in JSX text, `&apos;` + a line break makes Next's SWC
// drop the whitespace in front of the text ("réservationen attente").
const PENDING_NOTE = "en attente de paiement depuis plus d'1 h (7 derniers jours)";

export function AppHealthCard({ health }: { health: AppHealth }) {
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
  ];

  const alerts = [
    {
      count: health.pendingBookings,
      noun: { one: "réservation", other: "réservations" },
      tab: "bookings",
    },
    {
      count: health.pendingPurchases,
      noun: { one: "achat de pack", other: "achats de pack" },
      tab: "purchases",
    },
  ].filter((a) => a.count > 0);

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
        {alerts.map((a) => (
          <Link
            key={a.tab}
            href={`/admin/activity?tab=${a.tab}&status=pending`}
            className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-warning hover:bg-amber-100"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {a.count} {a.count > 1 ? a.noun.other : a.noun.one} {PENDING_NOTE}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
