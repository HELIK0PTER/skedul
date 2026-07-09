import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { CheckCircle2, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { parseDayKey } from "@/lib/calendar-grid";
import { formatMoney } from "@/lib/utils";
import {
  BOOKED_RANGE,
  CREDIT_RANGE,
  DEMO_PACK,
  DEMO_SERVICES,
  bookedDayKey,
  creditDayKey,
} from "../demo-data";
import { ClientShell } from "./client-shell";
import type { ScreenProps } from "./index";

export function ClientConfirmation({ state }: ScreenProps) {
  const isPack = state.confirmation === "pack";
  const isCredit = state.confirmation === "booking-credit";
  const dayKey = isCredit ? creditDayKey() : bookedDayKey();
  const range = isCredit ? CREDIT_RANGE : BOOKED_RANGE;
  const dayLabel = format(parseDayKey(dayKey), "EEEE d MMMM", { locale: fr });

  return (
    <ClientShell>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="size-12 text-success" />
          <h1 className="text-2xl font-bold tracking-tight">
            {isPack ? "Pack activé !" : "Réservation confirmée !"}
          </h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Un email de confirmation vient de vous être envoyé.
          </p>
          <div className="mt-1 rounded-xl bg-muted px-6 py-4">
            {isPack ? (
              <>
                <p className="flex items-center justify-center gap-2 font-semibold">
                  <Ticket className="size-4 text-primary" /> {DEMO_PACK.name}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {DEMO_PACK.credits} crédits · {formatMoney(DEMO_PACK.priceCents)}
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold">{DEMO_SERVICES[0].title}</p>
                <p className="text-sm capitalize text-muted-foreground">
                  {dayLabel} · {range}
                </p>
                {isCredit && (
                  <Badge variant="success" className="mt-2">
                    1 crédit utilisé · solde : {state.creditsRemaining} crédits
                  </Badge>
                )}
              </>
            )}
          </div>
          {isPack && (
            <Button data-demo="book-with-credit" className="mt-2">
              Réserver un créneau
            </Button>
          )}
        </CardContent>
      </Card>
    </ClientShell>
  );
}
