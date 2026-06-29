import Link from "next/link";

import { Logo } from "@/components/ui/logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-10 text-sm text-muted-foreground md:flex-row">
        <Logo />
        <p>© {new Date().getFullYear()} Skedul. Démo — données fictives.</p>
        <div className="flex gap-6">
          <Link href="/altinha-paris" className="hover:text-foreground">
            Page de démo
          </Link>
          <Link href="/sign-up" className="hover:text-foreground">
            Créer un compte
          </Link>
        </div>
      </div>
    </footer>
  );
}
