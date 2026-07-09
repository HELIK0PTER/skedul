import { Check, Clock, Loader2, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DayCalendar } from "@/components/public/day-calendar";
import { cn, formatMoney } from "@/lib/utils";
import { DEMO_SERVICES, DEMO_SLOT_TIMES, demoAvailableKeys } from "../demo-data";
import { ClientShell } from "./client-shell";
import type { ScreenProps } from "./index";

export function ClientBooking({ state }: ScreenProps) {
  const svc = DEMO_SERVICES[0]; // Séance découverte
  const slotPicked = state.bookingSelectedTime !== null;

  return (
    <ClientShell>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">{svc.title}</h1>
        <Badge variant="neutral">
          <Clock className="size-3.5" /> {svc.durationMinutes} min
        </Badge>
        <Badge>{formatMoney(svc.priceCents)}</Badge>
      </div>

      <div className="grid grid-cols-[1.05fr_1fr] gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Clock className="size-4 text-primary" /> 1. Choisissez un créneau
            </p>
            <div data-demo="calendar">
              <DayCalendar
                availableKeys={demoAvailableKeys()}
                selectedKey={state.bookingSelectedDay}
                onSelect={() => {}}
              />
            </div>
            {state.bookingSelectedDay && (
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {DEMO_SLOT_TIMES.map((t) => (
                  <span
                    key={t}
                    data-demo={`slot-${t}`}
                    className={cn(
                      "rounded-xl border px-2 py-1.5 text-center text-sm font-medium transition-colors",
                      state.bookingSelectedTime === t
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border",
                    )}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={cn("transition-opacity", !slotPicked && "opacity-50")}>
          <CardContent className="space-y-3 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Check className="size-4 text-primary" /> 2. Vos informations
            </p>
            <div className="space-y-1.5">
              <Label>Nom complet</Label>
              <Input data-demo="field-name" readOnly value={state.formName} placeholder="Jean Dupont" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input data-demo="field-email" readOnly value={state.formEmail} placeholder="jean@exemple.com" />
            </div>
            {state.hasCredits && (
              <p className="flex items-center gap-2 rounded-xl bg-success-muted px-3 py-2 text-sm text-success">
                <Ticket className="size-4" /> Vous avez {state.creditsRemaining} crédits
                applicables à cette prestation.
              </p>
            )}
            <div className="flex flex-col gap-2 pt-1">
              {state.hasCredits ? (
                <>
                  <Button data-demo="credit-button" className="w-full">
                    {state.paying ? <Loader2 className="animate-spin" /> : <Ticket />}
                    Réserver avec 1 crédit
                  </Button>
                  <Button variant="secondary" className="w-full">
                    Payer {formatMoney(svc.priceCents)}
                  </Button>
                </>
              ) : (
                <Button data-demo="pay-button" className="w-full">
                  {state.paying && <Loader2 className="animate-spin" />}
                  Payer {formatMoney(svc.priceCents)}
                </Button>
              )}
              <p className="text-center text-xs text-muted-foreground">
                Paiement sécurisé via Stripe.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </ClientShell>
  );
}
