"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { authClient, signIn } from "@/lib/auth-client";
import { oauthErrorMessage } from "@/lib/oauth-errors";
import { GoogleLogo } from "@/components/auth/google-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const LINK_FAILED = "Impossible de relier ce compte Google. Réessayez.";

/**
 * Links Google to an existing email/password account. Better Auth refuses to
 * link it implicitly (the local email was never verified), so the user proves
 * they own the Skedul account with its password, then confirms on Google.
 */
export function LinkGoogleForm({
  signedInEmail,
  initialError = null,
}: {
  /** Set when a session already exists (e.g. back here after a failed link). */
  signedInEmail: string | null;
  initialError?: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  // Back from Google via the browser's Back button: the page comes back from
  // the back/forward cache with the spinner still on.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLoading(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  /** Sends the signed-in user to Google; on return /sign-in routes them. */
  async function linkGoogle() {
    try {
      const result = await authClient.linkSocial({
        provider: "google",
        callbackURL: "/sign-in",
        errorCallbackURL: "/link-google",
      });
      if (result.error) {
        setError(LINK_FAILED);
        setLoading(false);
      }
    } catch {
      setError(LINK_FAILED);
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const result = await signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (result.error) {
      setError(
        result.error.code === "BANNED_USER"
          ? oauthErrorMessage("BANNED_USER")
          : result.error.code === "INVALID_EMAIL_OR_PASSWORD"
            ? "Email ou mot de passe incorrect."
            : (result.error.message ?? "Une erreur est survenue."),
      );
      setLoading(false);
      return;
    }
    await linkGoogle();
  }

  if (signedInEmail) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {`Vous êtes connecté avec ${signedInEmail}. Choisissez sur Google le compte qui utilise cette adresse.`}
        </p>
        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={loading}
          onClick={() => {
            setError(null);
            setLoading(true);
            void linkGoogle();
          }}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <GoogleLogo className="size-4" />
          )}
          Relier mon compte Google
        </Button>
        <p className="text-center text-sm">
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            Continuer sans Google
          </Link>
        </p>
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
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="password">Mot de passe</Label>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-primary hover:underline"
          >
            Mot de passe oublié ?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
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
        Confirmer et relier Google
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Google vous demandera de confirmer une dernière fois.
      </p>
      <p className="text-center text-sm">
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          Annuler
        </Link>
      </p>
    </form>
  );
}
