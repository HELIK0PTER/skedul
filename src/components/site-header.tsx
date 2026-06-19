import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { getCurrentProfessional, getCurrentUser } from "@/lib/session";

export async function SiteHeader() {
  const [user, pro] = await Promise.all([
    getCurrentUser(),
    getCurrentProfessional(),
  ]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="transition-opacity hover:opacity-80">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
          <Link href="/#features" className="hover:text-foreground">
            Fonctionnalités
          </Link>
          <Link href="/#packs" className="hover:text-foreground">
            Packs prépayés
          </Link>
          <Link href="/#how" className="hover:text-foreground">
            Comment ça marche
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          {user ? (
            <Button asChild size="sm">
              <Link href={pro ? "/dashboard" : "/onboarding"}>
                {pro ? "Mon espace" : "Devenir pro"}
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/sign-in">Se connecter</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/sign-up">Commencer</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
