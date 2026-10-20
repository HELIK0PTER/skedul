import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GettingStartedStep } from "@/lib/back-office/dashboard-view";

/** The three first steps (type, offer, event); the page does not render it once all are done. */
export function GettingStarted({ steps }: { steps: GettingStartedStep[] }) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Premiers pas</CardTitle>
        <CardDescription>Trois étapes pour ouvrir les réservations.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2">
          {steps.map((step) => (
            <li key={step.key} className="flex items-center gap-2.5 text-sm">
              {step.done ? (
                <CheckCircle2 className="size-5 shrink-0 text-green-700" aria-hidden />
              ) : (
                <Circle className="size-5 shrink-0 text-zinc-600" aria-hidden />
              )}
              {step.done ? (
                <span className="text-zinc-600">{step.label}</span>
              ) : (
                <Link
                  href={step.href}
                  className="rounded font-medium text-accent-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {step.label}
                </Link>
              )}
              <span className="sr-only">{step.done ? "fait" : "à faire"}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
