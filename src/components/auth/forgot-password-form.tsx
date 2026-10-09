"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const email = String(new FormData(e.currentTarget).get("email")).trim();
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    setLoading(false);
    if (result.error) {
      setError(
        result.error.status === 429
          ? "Trop de demandes. Réessayez dans quelques minutes."
          : "L'envoi a échoué. Réessayez dans un instant.",
      );
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    // Same answer whether or not the address has an account (no enumeration).
    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          {`Si un compte Skedul existe pour ${sentTo}, un email vient de partir avec un lien pour choisir un nouveau mot de passe. Pensez à regarder dans vos spams.`}
        </p>
        <p className="text-sm text-muted-foreground">Le lien est valable 1 heure.</p>
        <Button asChild variant="secondary" className="w-full">
          <Link href="/sign-in">Retour à la connexion</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="vous@exemple.com"
          autoComplete="email"
          required
        />
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="size-4 animate-spin" />}
        Envoyer le lien
      </Button>
      <p className="text-center text-sm">
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </form>
  );
}
