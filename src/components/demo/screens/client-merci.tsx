import { CheckCircle2, Ticket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { merciCopy } from "@/lib/public/merci-view";
import { walletLine } from "@/lib/public/messages";
import { SEE_MY_SPACE } from "@/lib/public/seance-copy";
import { DEMO_CARNET, LEA_SEANCE_IDS, carnetExpiryLine, demoWeek, seanceById, ticketType, whenLong } from "../demo-data";
import { leaTicketsLeft } from "../demo-script";
import { ClientShell } from "./client-shell";
import type { ScreenProps } from "./index";

/** The thank-you page after the payment: the séance is booked, the rest of the carnet waits in the wallet. */
export function ClientMerci({ state }: ScreenProps) {
  const week = demoWeek();
  const seance = seanceById(LEA_SEANCE_IDS.monday, week);
  const copy = merciCopy({
    kind: "booked",
    title: seance.title,
    whenLabel: whenLong(week[seance.dayIndex], seance.startMinute, seance.durationMin),
    isRdv: false,
  });
  const left = leaTicketsLeft(state);
  const collectif = ticketType("collectif");

  return (
    <ClientShell>
      <Card className="mx-auto max-w-xl">
        <CardContent className="flex flex-col items-center gap-3 px-8 py-10 text-center">
          <CheckCircle2 className="size-12 text-success" aria-hidden />
          <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
          <p className="max-w-md text-sm text-zinc-600">{copy.body}</p>
          <div data-demo="merci-tickets" className="mt-2 w-full max-w-sm rounded-xl bg-muted px-5 py-4 text-left">
            <p className="flex items-center gap-2 font-semibold">
              <Ticket className="size-4 text-primary" aria-hidden />
              {`${DEMO_CARNET.label} · ${collectif.name}`}
            </p>
            <p className="mt-1 text-sm">{walletLine(left)}</p>
            <p className="text-sm text-zinc-600">{carnetExpiryLine(left)}</p>
          </div>
          <div className="mt-3 flex gap-2">
            <Button>{SEE_MY_SPACE}</Button>
            <Button variant="ghost">Retour à la page</Button>
          </div>
        </CardContent>
      </Card>
    </ClientShell>
  );
}
