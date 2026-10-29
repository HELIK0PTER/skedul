import Link from "next/link";

import { StatusMark } from "@/components/dashboard/status-mark";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardAlert } from "@/lib/back-office/dashboard-view";

/** What needs the pro's attention (red before orange), each line linking to where it is fixed. */
export function AlertsCard({ alerts }: { alerts: DashboardAlert[] }) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Alertes</CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <p className="text-sm text-zinc-600">Aucune alerte : tout est en ordre.</p>
        ) : (
          <ul className="-mx-2 space-y-1">
            {alerts.map((alert) => (
              <li key={alert.key}>
                <Link
                  href={alert.href}
                  className="flex items-start gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <StatusMark tone={alert.tone} decorative className="mt-1.5" />
                  <span className="min-w-0 wrap-anywhere">{alert.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
