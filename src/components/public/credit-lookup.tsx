"use client";

import { useState, useTransition } from "react";
import { Loader2, Search, Ticket } from "lucide-react";

import { lookupCredits } from "@/server/public";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Purchase = {
  id: string;
  creditsRemaining: number;
  packName: string;
  eventTypeId: string | null;
};

export function CreditLookup({ professionalId }: { professionalId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { found: boolean; purchases: Purchase[] } | null
  >(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    startTransition(async () => {
      const r = await lookupCredits({ professionalId, email });
      setResult({ found: r.found, purchases: r.purchases });
    });
  }

  return (
    <Card className="bg-muted/40">
      <CardContent className="p-5">
        <h3 className="font-semibold">Vous avez déjà un pack ?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Entrez votre email pour voir vos crédits restants.
        </p>
        <form onSubmit={onSubmit} className="mt-3 flex gap-2">
          <Input
            name="email"
            type="email"
            placeholder="vous@exemple.com"
            required
          />
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Vérifier
          </Button>
        </form>

        {result && (
          <div className="mt-4">
            {result.purchases.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun crédit actif pour cet email.
              </p>
            ) : (
              <ul className="space-y-2">
                {result.purchases.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 text-sm"
                  >
                    <Ticket className="size-4 text-primary" />
                    <span className="flex-1">{p.packName}</span>
                    <span className="font-semibold">
                      {p.creditsRemaining} crédit(s)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
