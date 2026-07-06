import { ArrowRight, Clock, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import { DEMO_PACK, DEMO_SERVICES } from "../demo-data";
import { ClientShell } from "./client-shell";
import type { ScreenProps } from "./index";

export function ClientProfile(_: ScreenProps) {
  return (
    <ClientShell>
      <h2 className="mb-3 text-base font-semibold">Réserver une prestation</h2>
      <div className="space-y-2.5">
        {DEMO_SERVICES.map((svc) => {
          const isTarget = svc.id === "decouverte";
          return (
            <Card key={svc.id} data-demo={isTarget ? "service-decouverte" : undefined}>
              <CardContent className="flex items-center gap-4 p-4">
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: svc.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{svc.title}</p>
                  <p className="mt-0.5 flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5" /> {svc.durationMinutes} min
                    </span>
                    <span className="font-medium text-foreground">
                      {formatMoney(svc.priceCents)}
                    </span>
                    {svc.capacity > 1 && <span>{svc.capacity} places</span>}
                  </p>
                </div>
                <Button size="sm" data-demo={isTarget ? "service-decouverte-cta" : undefined}>
                  Réserver <ArrowRight />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <h2 className="mb-1 mt-6 text-base font-semibold">Packs prépayés</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Payez une fois, réservez plusieurs créneaux quand vous voulez.
      </p>
      <Card data-demo="pack-card" className="max-w-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">
              <Ticket className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{DEMO_PACK.name}</p>
              <span className="mt-0.5 inline-flex gap-1.5">
                <Badge>{DEMO_PACK.credits} crédits</Badge>
                <Badge variant="neutral">{DEMO_PACK.scope}</Badge>
              </span>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xl font-bold">{formatMoney(DEMO_PACK.priceCents)}</p>
            <Button size="sm" data-demo="pack-buy">
              Acheter
            </Button>
          </div>
        </CardContent>
      </Card>
    </ClientShell>
  );
}
