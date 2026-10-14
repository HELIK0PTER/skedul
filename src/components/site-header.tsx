import Link from "next/link";

import { navPrimary, navQuiet } from "@/components/landing/cta";
import styles from "@/components/landing/landing.module.css";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { getCurrentProfessional, getCurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/#features", label: "Fonctionnalités" },
  { href: "/#packs", label: "Packs prépayés" },
  { href: "/#how", label: "Comment ça marche" },
  { href: "/demo", label: "Démo" },
];

/**
 * Floating pill nav (Hallmark N5): content-sized, detached from the edges,
 * sticky. The full-width header box lets clicks through; only the pill
 * itself catches the pointer.
 */
export async function SiteHeader() {
  const [user, pro] = await Promise.all([
    getCurrentUser(),
    getCurrentProfessional(),
  ]);

  return (
    <header className="pointer-events-none sticky top-3 z-40 px-3 sm:top-4">
      <div
        className={cn(
          styles.navPill,
          "pointer-events-auto mx-auto flex w-fit max-w-full items-center gap-1 rounded-full border border-(--lp-rule) p-1.5 pl-2 max-[400px]:gap-0.5",
        )}
      >
        <Link
          href="/"
          aria-label="Skedul, accueil"
          className="mr-1 flex items-center gap-2 rounded-full pr-1 max-[400px]:mr-0 transition-opacity duration-150 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--lp-focus)"
        >
          <Logo withWordmark={false} />
          <span className="hidden text-[1.0625rem] font-bold tracking-tight min-[420px]:inline">
            Skedul
          </span>
        </Link>

        <nav aria-label="Navigation principale" className="hidden lg:block">
          <ul className="flex items-center">
            {SECTIONS.map((section) => (
              <li key={section.href}>
                <Link
                  href={section.href}
                  className="block whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium text-(--lp-ink-2) transition-[background-color,color] duration-150 hover:bg-(--lp-paper-2) hover:text-(--lp-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--lp-focus) active:bg-(--lp-rule)"
                >
                  {section.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <span
          aria-hidden
          className="mx-1.5 hidden h-5 w-px bg-(--lp-rule) lg:block"
        />

        {user ? (
          <Button asChild size="sm" className={navPrimary}>
            <Link href={pro ? "/dashboard" : "/onboarding"}>
              {pro ? "Mon espace" : "Devenir pro"}
            </Link>
          </Button>
        ) : (
          <>
            <Button asChild variant="ghost" size="sm" className={navQuiet}>
              <Link href="/sign-in">Se connecter</Link>
            </Button>
            <Button asChild size="sm" className={navPrimary}>
              <Link href="/sign-up">Créer ma page</Link>
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
