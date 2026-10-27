"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { authClient, signIn } from "@/lib/auth-client";
import { authFormErrorMessage, GENERIC_ERROR } from "@/lib/auth-messages";
import { oauthErrorMessage } from "@/lib/oauth-errors";
import { GoogleLogo } from "@/components/auth/google-logo";
import { useGoogleRedirect } from "@/components/auth/use-google-redirect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const LINK_FAILED = oauthErrorMessage("unable_to_link_account") ?? GENERIC_ERROR;
/** The failure line. Its region is always mounted (empty and sr-only until a failure), so the text is announced when it arrives. */
const ERROR_CLASS = "rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive";

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
  const [error, setError] = useState<string | null>(initialError);
  const { loading, setLoading, redirect } = useGoogleRedirect(setError, LINK_FAILED);

  /** Sends the signed-in user to Google; on return /sign-in routes them. */
  function linkGoogle() {
    return redirect(() =>
      authClient.linkSocial({
        provider: "google",
        callbackURL: "/sign-in",
        errorCallbackURL: "/link-google",
      }),
    );
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
      // By status and code only (same mapping as the sign-in form): the `message` of Better Auth is English.
      setError(authFormErrorMessage(result.error));
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
        <p role="alert" className={error ? ERROR_CLASS : "sr-only"}>
          {error}
        </p>
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
          <Link href="/sign-in" className="font-medium text-accent-foreground hover:underline">
            Continuer sans Google
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4">
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
            className="text-xs font-medium text-accent-foreground hover:underline"
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

      <p role="alert" className={error ? ERROR_CLASS : "sr-only"}>
        {error}
      </p>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="size-4 animate-spin" />}
        Confirmer et relier Google
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Google vous demandera de confirmer une dernière fois.
      </p>
      <p className="text-center text-sm">
        <Link href="/sign-in" className="font-medium text-accent-foreground hover:underline">
          Annuler
        </Link>
      </p>
    </form>
  );
}
