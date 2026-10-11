"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { signIn, signUp } from "@/lib/auth-client";
import { resolvePostSignIn, type PostSignIn } from "@/server/entry";
import { EntryChooser } from "@/components/auth/entry-chooser";
import { GoogleLogo } from "@/components/auth/google-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthForm({
  mode,
  next = null,
  initialChooser = false,
  googleEnabled = false,
  initialError = null,
}: {
  mode: "sign-in" | "sign-up";
  /** Validated path to open after signing in (from `?next=`), else the usual routing. */
  next?: string | null;
  /** Open the admin entry chooser right away (an admin is already signed in). */
  initialChooser?: boolean;
  /** Show "Continuer avec Google" (a Google OAuth client is configured). */
  googleEnabled?: boolean;
  /** Error brought back in the URL by a failed Google sign-in. */
  initialError?: string | null;
}) {
  const router = useRouter();
  const isSignUp = mode === "sign-up";
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [choosing, setChoosing] = useState(initialChooser);
  const busy = loading || googleLoading;
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";

  // Coming back from Google with the browser's Back button restores this page
  // from the back/forward cache with the spinner still on; reset it.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setGoogleLoading(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function onGoogle() {
    setError(null);
    setGoogleLoading(true);
    try {
      // Better Auth redirects the browser to Google. On return, /sign-in sends
      // the user to `next` or routes them (admins get the entry chooser);
      // brand-new users go to `next` or onboarding.
      const result = await signIn.social({
        provider: "google",
        callbackURL: `/sign-in${nextQuery}`,
        newUserCallbackURL: next ?? "/onboarding",
        errorCallbackURL: isSignUp ? `/sign-up${nextQuery}` : `/sign-in${nextQuery}`,
      });
      if (result.error) {
        setError("La connexion avec Google a échoué. Réessayez.");
        setGoogleLoading(false);
      }
    } catch {
      setError("La connexion avec Google a échoué. Réessayez.");
      setGoogleLoading(false);
    }
  }

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
      router.push(next ?? "/onboarding");
      router.refresh();
      return;
    }

    if (next) {
      // Push only (see below): the target page reads the fresh session.
      router.push(next);
      return;
    }

    // Admins pick Admin vs Client (unless remembered); everyone else → /dashboard.
    let target: PostSignIn;
    try {
      target = await resolvePostSignIn();
    } catch {
      // Sign-in worked; only the routing lookup failed (network, DB, stale action).
      setLoading(false);
      setError("Connexion réussie, mais la redirection a échoué. Réessayez.");
      return;
    }
    if (target.kind === "choose") {
      setLoading(false);
      setChoosing(true);
      return;
    }
    // Push only: a router.refresh() queued right after a server action leaves the
    // navigation pending forever (Next 16 router queue). The target is fetched fresh.
    router.push(target.to);
  }

  return (
    <>
      {googleEnabled && (
        <div className="mb-4 space-y-4">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={onGoogle}
            disabled={busy}
          >
            {googleLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <GoogleLogo className="size-4" />
            )}
            Continuer avec Google
          </Button>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            ou
            <span className="h-px flex-1 bg-border" />
          </div>
        </div>
      )}
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
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="password">Mot de passe</Label>
            {!isSignUp && (
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-primary hover:underline"
              >
                Mot de passe oublié ?
              </Link>
            )}
          </div>
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

        <Button type="submit" className="w-full" disabled={busy}>
          {loading && <Loader2 className="size-4 animate-spin" />}
          {isSignUp ? "Créer mon compte" : "Se connecter"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          {isSignUp ? (
            <>
              Déjà un compte ?{" "}
              <Link href={`/sign-in${nextQuery}`} className="font-medium text-primary hover:underline">
                Se connecter
              </Link>
            </>
          ) : (
            <>
              Pas encore de compte ?{" "}
              <Link href={`/sign-up${nextQuery}`} className="font-medium text-primary hover:underline">
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
