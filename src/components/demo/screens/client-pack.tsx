import { Loader2, ShoppingCart, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/utils";
import { DEMO_PACK } from "../demo-data";
import { ClientShell } from "./client-shell";
import type { ScreenProps } from "./index";

export function ClientPack({ state }: ScreenProps) {
  return (
    <ClientShell>
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <span className="grid size-12 place-items-center rounded-xl bg-accent text-accent-foreground">
              <Ticket className="size-6" />
            </span>
            <h1 className="mt-3 text-xl font-bold tracking-tight">{DEMO_PACK.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{DEMO_PACK.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge>{DEMO_PACK.credits} crédits</Badge>
              <Badge variant="neutral">{DEMO_PACK.scope}</Badge>
              <Badge variant="success">
                {formatMoney(DEMO_PACK.priceCents / DEMO_PACK.credits)} / séance
              </Badge>
            </div>
            <p className="mt-5 flex items-baseline gap-2">
              <span className="text-3xl font-bold">{formatMoney(DEMO_PACK.priceCents)}</span>
              <span className="text-sm text-muted-foreground">payé une seule fois</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-5">
            <h2 className="font-semibold">Finaliser l'achat</h2>
            <div className="space-y-1.5">
              <Label>Nom complet</Label>
              <Input data-demo="field-name" readOnly value={state.formName} placeholder="Jean Dupont" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input data-demo="field-email" readOnly value={state.formEmail} placeholder="jean@exemple.com" />
            </div>
            <Button data-demo="pack-pay" className="w-full">
              {state.paying ? <Loader2 className="animate-spin" /> : <ShoppingCart />}
              Payer {formatMoney(DEMO_PACK.priceCents)}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Paiement sécurisé via Stripe. Vos crédits sont activés immédiatement.
            </p>
          </CardContent>
        </Card>
      </div>
    </ClientShell>
  );
}
