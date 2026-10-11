import Link from "next/link";

import { Logo } from "@/components/ui/logo";

const LINKS = [
  { href: "/demo", label: "Voir la démo" },
  { href: "/aide", label: "Centre d’aide" },
  { href: "/sign-in", label: "Se connecter" },
  { href: "/sign-up", label: "Créer ma page" },
];

/** Mast-headed footer (Hallmark Ft1): wordmark and tagline, three links. */
export function SiteFooter({ note = "Les exemples de cette page utilisent des données fictives." }: { note?: string | null } = {}) {
  return (
    <footer className="border-t border-(--lp-rule) bg-(--lp-paper-2)">
      <div className="mx-auto w-full max-w-[75rem] px-5 pb-10 pt-14 sm:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div>
            <Logo />
            <p className="mt-4 max-w-[45ch] text-pretty leading-relaxed text-(--lp-ink-2)">
              Réservations en ligne et carnets prépayés pour les indépendants.
            </p>
          </div>
          <nav aria-label="Pied de page">
            <ul className="flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="whitespace-nowrap rounded-sm text-(--lp-ink-2) underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--lp-focus) active:text-(--lp-ink)"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-(--lp-rule) pt-6 text-sm text-(--lp-ink-2) sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} Skedul</p>
          {note && <p>{note}</p>}
        </div>
      </div>
    </footer>
  );
}
