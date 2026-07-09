import { Clock, Pencil, Plus, Ticket, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatMoney } from "@/lib/utils";
import { DEMO_SERVICES, type DemoService } from "../demo-data";
import { ProShell } from "./pro-shell";
import type { ScreenProps } from "./index";

const COLOR_CHOICES = ["#6d5cf6", "#0ea5e9", "#16a34a", "#f59e0b", "#ec4899", "#ef4444"];

function ServiceRow({ svc, demoTarget }: { svc: DemoService; demoTarget?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: svc.color }} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{svc.title}</p>
          <p className="mt-0.5 flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" /> {svc.durationMinutes} min
            </span>
            <span>{formatMoney(svc.priceCents)}</span>
            {svc.capacity > 1 && <span>{svc.capacity} places</span>}
          </p>
        </div>
        <span
          data-demo={demoTarget}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground"
        >
          <Pencil className="size-4" />
        </span>
        <span className="grid size-8 place-items-center rounded-lg text-destructive">
          <Trash2 className="size-4" />
        </span>
      </CardContent>
    </Card>
  );
}

export function ProEventTypes({ state }: ScreenProps) {
  return (
    <ProShell active="event-types">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Prestations</h1>
          <p className="text-sm text-muted-foreground">
            Les types de rendez-vous que vos clients peuvent réserver.
          </p>
        </div>
        <Button variant="outline" size="sm">
          <Ticket /> Packs prépayés
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        {state.eventTypeFormOpen ? (
          <Card className="border-primary/40">
            <CardContent className="space-y-3 p-4">
              <div className="space-y-1.5">
                <Label>Titre</Label>
                <Input readOnly value="Séance découverte" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Durée (min)</Label>
                  <Input readOnly value="60" />
                </div>
                <div className="space-y-1.5">
                  <Label>Prix (€)</Label>
                  <Input readOnly value="25" />
                </div>
                <div className="space-y-1.5">
                  <Label>Capacité</Label>
                  <Input readOnly value="1" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Couleur</Label>
                <div className="flex gap-2">
                  {COLOR_CHOICES.map((c, i) => (
                    <span
                      key={c}
                      className={cn(
                        "size-7 rounded-full",
                        i === 0 && "ring-2 ring-foreground ring-offset-2",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm">Enregistrer</Button>
                <Button size="sm" variant="ghost">
                  Annuler
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <ServiceRow svc={DEMO_SERVICES[0]} demoTarget="edit-service" />
        )}
        <ServiceRow svc={DEMO_SERVICES[1]} />
        <ServiceRow svc={DEMO_SERVICES[2]} />
        <Button variant="secondary" size="sm">
          <Plus /> Nouvelle prestation
        </Button>
      </div>
    </ProShell>
  );
}
