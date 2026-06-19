"use client";

import { useState, useTransition } from "react";
import { Loader2, ShoppingCart } from "lucide-react";

import { purchasePack } from "@/server/public";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/utils";

export function BuyPackForm({
  packId,
  priceCents,
}: {
  packId: string;
  priceCents: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const res = await purchasePack({
        packId,
        customer: {
          name: String(f.get("name")),
          email: String(f.get("email")),
          phone: String(f.get("phone") ?? "") || undefined,
        },
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.redirectUrl) window.location.href = res.redirectUrl;
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Nom complet</Label>
          <Input id="name" name="name" required placeholder="Jean Dupont" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            placeholder="jean@exemple.com"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone">Téléphone (optionnel)</Label>
        <Input id="phone" name="phone" placeholder="+33 6 …" />
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ShoppingCart className="size-4" />
        )}
        Payer {formatMoney(priceCents)}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Paiement sécurisé via Stripe. Vos crédits sont activés immédiatement.
      </p>
    </form>
  );
}
