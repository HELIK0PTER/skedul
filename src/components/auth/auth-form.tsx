"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { signIn, signUp } from "@/lib/auth-client";
import { resolvePostSignIn, type PostSignIn } from "@/server/entry";
import { EntryChooser } from "@/components/auth/entry-chooser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthForm({
  mode,
  initialChooser = false,
}: {
  mode: "sign-in" | "sign-up";
  /** Open the admin entry chooser right away (an admin is already signed in). */
  initialChooser?: boolean;
}) {
  const router = useRouter();
  const isSignUp = mode === "sign-up";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(initialChooser);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const name = String(form.get("name") ?? "");

    const result = isSignUp
      ? await signUp.email({ email, password, name })
      : await signIn.email({ email, password });

    if (result.error) {
      setError(result.error.message ?? "Une erreur est survenue.");
      setLoading(false);
      return;
    }

    if (isSignUp) {
      router.push("/onboarding");
      router.refresh();
      return;
    }

    // Admins pick Admin vs Client (unless remembered); everyone else → /dashboard.
    let next: PostSignIn;
    try {
      next = await resolvePostSignIn();
    } catch {
      // Sign-in worked; only the routing lookup failed (network, DB, stale action).
      setLoading(false);
      setError("Connexion réussie, mais la redirection a échoué. Réessayez.");
      return;
    }
    if (next.kind === "choose") {
      setLoading(false);
      setChoosing(true);
      return;
    }
    // Push only: a router.refresh() queued right after a server action leaves the
    // navigation pending forever (Next 16 router queue). The target is fetched fresh.
    router.push(next.to);
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-4">
        {isSignUp && (
          <div className="space-y-1.5">
            <Label htmlFor="name">Nom complet</Label>
            <Input id="name" name="name" placeholder="Camille Laurent" required />
          </div>
        )}
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
        <div className="space-y-1.5">
          <Label htmlFor="password">Mot de passe</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            minLength={8}
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
          {isSignUp ? "Créer mon compte" : "Se connecter"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          {isSignUp ? (
            <>
              Déjà un compte ?{" "}
              <Link href="/sign-in" className="font-medium text-primary hover:underline">
                Se connecter
              </Link>
            </>
          ) : (
            <>
              Pas encore de compte ?{" "}
              <Link href="/sign-up" className="font-medium text-primary hover:underline">
                Créer un compte
              </Link>
            </>
          )}
        </p>
      </form>
      <EntryChooser open={choosing} />
    </>
  );
}
