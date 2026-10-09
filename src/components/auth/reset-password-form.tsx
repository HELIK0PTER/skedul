"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MIN_LENGTH = 8; // keep in sync with emailAndPassword.minPasswordLength

export function ResetPasswordForm({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirm"))) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    const result = await authClient.resetPassword({ newPassword, token });
    setLoading(false);
    if (result.error) {
      if (result.error.code === "INVALID_TOKEN") setExpired(true);
      else if (result.error.code === "PASSWORD_TOO_SHORT")
        setError(`Le mot de passe doit faire au moins ${MIN_LENGTH} caractères.`);
      else setError("La modification a échoué. Réessayez.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          Votre mot de passe a été modifié. Connectez-vous avec ce nouveau mot de passe.
        </p>
        <Button asChild className="w-full">
          <Link href="/sign-in">Se connecter</Link>
        </Button>
      </div>
    );
  }

  if (expired) return <ExpiredLink />;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {`Au moins ${MIN_LENGTH} caractères. Vous serez déconnecté de tous vos appareils.`}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="password">Nouveau mot de passe</Label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="••••••••"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirmez le mot de passe</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          placeholder="••••••••"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
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
        Enregistrer le mot de passe
      </Button>
    </form>
  );
}

/** Shown for a missing, used or expired token. */
export function ExpiredLink() {
  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
        Ce lien n&apos;est plus valable. Il expire au bout d&apos;une heure et ne sert qu&apos;une fois.
      </p>
      <Button asChild className="w-full">
        <Link href="/forgot-password">Demander un nouveau lien</Link>
      </Button>
    </div>
  );
}
