"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Briefcase, Loader2, User } from "lucide-react";

import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

/**
 * One-click demo logins, rendered only on non-production deploys
 * (gated by `env.APP_ENV !== "production"` at the call site). Credentials match the seed.
 */
const DEMO_ACCOUNTS = [
  {
    key: "pro",
    label: "Pro · back-office",
    hint: "pro@skedul.app",
    email: "pro@skedul.app",
    password: "password123",
    redirectTo: "/dashboard",
    icon: Briefcase,
  },
  {
    key: "client",
    label: "Cliente · packs & réservations",
    hint: "beatriz@example.com",
    email: "beatriz@example.com",
    password: "password123",
    redirectTo: "/altinha-paris",
    icon: User,
  },
] as const;

export function DemoQuickLogin() {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function quickLogin(account: (typeof DEMO_ACCOUNTS)[number]) {
    setError(null);
    setPending(account.key);

    const result = await signIn.email({
      email: account.email,
      password: account.password,
    });

    if (result.error) {
      setError(result.error.message ?? "Connexion de démo impossible.");
      setPending(null);
      return;
    }

    router.push(account.redirectTo);
    router.refresh();
  }

  return (
    <div className="mt-6 border-t border-border pt-5">
      <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Connexion rapide (démo)
      </p>
      <div className="space-y-2">
        {DEMO_ACCOUNTS.map((account) => {
          const Icon = account.icon;
          return (
            <Button
              key={account.key}
              type="button"
              variant="secondary"
              className="w-full justify-start"
              disabled={pending !== null}
              onClick={() => quickLogin(account)}
            >
              {pending === account.key ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Icon className="size-4 text-muted-foreground" />
              )}
              <span className="font-medium">{account.label}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {account.hint}
              </span>
            </Button>
          );
        })}
      </div>
      {error && (
        <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
