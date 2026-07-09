import { ArrowLeft, Pencil, Plus, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/utils";
import { DEMO_PACK } from "../demo-data";
import { ProShell } from "./pro-shell";
import type { ScreenProps } from "./index";

export function ProPacks({ state }: ScreenProps) {
  return (
    <ProShell active="event-types">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" /> Prestations
      </p>
      <h1 className="mt-2 text-xl font-bold tracking-tight">Packs prépayés</h1>
      <p className="text-sm text-muted-foreground">
        Vendez des lots de crédits que vos clients utilisent pour réserver.
      </p>

      <div className="mt-4 space-y-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
              <Ticket className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{DEMO_PACK.name}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {DEMO_PACK.credits} crédits · {formatMoney(DEMO_PACK.priceCents)} ·{" "}
                {DEMO_PACK.scope}
              </p>
            </div>
            <Badge variant="success">{DEMO_PACK.sold} vendus</Badge>
            <span
              data-demo="edit-pack"
              className="grid size-8 place-items-center rounded-lg text-muted-foreground"
            >
              <Pencil className="size-4" />
            </span>
          </CardContent>
        </Card>

        {state.packFormOpen && (
          <Card className="border-primary/40">
            <CardContent className="space-y-3 p-4">
              <div className="space-y-1.5">
                <Label>Nom du pack</Label>
                <Input readOnly value={DEMO_PACK.name} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Crédits (séances)</Label>
                  <Input readOnly value="10" />
                </div>
                <div className="space-y-1.5">
                  <Label>Prix total (€)</Label>
                  <Input readOnly value="200" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Prestation associée</Label>
                <Input readOnly value="Toutes les prestations" />
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm">Enregistrer</Button>
                <Button size="sm" variant="ghost">
                  Annuler
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        <Button variant="secondary" size="sm">
          <Plus /> Nouveau pack
        </Button>
      </div>
    </ProShell>
  );
}
