"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

import { navPrimary } from "@/components/landing/cta";
import { FaqAnswer } from "@/components/support/faq-answer";
import { HELP_ICON_COMPONENTS } from "@/components/support/help-icon";
import { Button } from "@/components/ui/button";
import { matchArticles } from "@/lib/support";
import { cn } from "@/lib/utils";
import type { FaqArticle, FaqCategory } from "@/server/support-queries";

type ListedArticle = FaqArticle & { categoryTitle?: string };

const NEW_REQUEST = "/aide/demandes/nouvelle";

/**
 * /aide body: the hero with the live search (`aside` fills its right column),
 * then the categories and the FAQ as native <details> accordions.
 */
export function FaqBrowser({
  categories,
  initialQuery,
  aside,
}: {
  categories: FaqCategory[];
  initialQuery: string;
  aside: React.ReactNode;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState<string | null>(null);

  const all = useMemo<ListedArticle[]>(
    () => categories.flatMap((c) => c.articles.map((a) => ({ ...a, categoryTitle: c.title }))),
    [categories],
  );
  const searching = query.trim().length > 1;
  const hits = useMemo(() => (searching ? matchArticles(all, query) : []), [all, query, searching]);
  const shown = active ? categories.filter((c) => c.slug === active) : categories;

  // Deep link /aide#a-<id>: open and reveal that article (DOM only, no state).
  useEffect(() => {
    const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (target instanceof HTMLDetailsElement) {
      target.open = true;
      target.scrollIntoView({ block: "center" });
    }
  }, []);

  return (
    <>
      <section className="mx-auto grid w-full max-w-[75rem] gap-10 px-5 pb-12 pt-14 sm:px-8 sm:pt-20 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(2.25rem,2.4vw+1.5rem,3.5rem)] font-bold leading-[1.04] tracking-[-0.03em] text-balance">
            Comment pouvons-nous vous aider ?
          </h1>
          <p className="mt-4 max-w-[52ch] text-lg leading-relaxed text-(--lp-ink-2)">
            Les réponses aux questions fréquentes sur Skedul, et l’équipe pour le reste.
          </p>
          <div role="search" className="relative mt-8 max-w-xl">
            <label htmlFor="faq-search" className="sr-only">
              Rechercher dans l’aide
            </label>
            <Search
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id="faq-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Packs, mot de passe, Google Agenda"
              autoComplete="off"
              className="h-14 w-full rounded-full border border-border bg-card pl-12 pr-12 text-base shadow-(--shadow-card) outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Effacer la recherche"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
        <div className="min-w-0">{aside}</div>
      </section>

      <section
        aria-label="Questions fréquentes"
        className="mx-auto grid w-full max-w-[75rem] gap-8 px-5 pb-24 sm:px-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12"
      >
        <nav aria-label="Rubriques" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <ul className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
            <li>
              <CategoryButton
                label="Toutes les rubriques"
                count={all.length}
                active={!active && !searching}
                onClick={() => {
                  setActive(null);
                  setQuery("");
                }}
              />
            </li>
            {categories.map((c) => {
              const Icon = HELP_ICON_COMPONENTS[c.icon];
              return (
                <li key={c.id}>
                  <CategoryButton
                    icon={<Icon className="size-4" aria-hidden />}
                    label={c.title}
                    count={c.articles.length}
                    active={active === c.slug && !searching}
                    onClick={() => {
                      setActive(c.slug);
                      setQuery("");
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          {searching ? (
            hits.length > 0 ? (
              <>
                <p aria-live="polite" className="text-sm text-muted-foreground">
                  {hits.length} résultat{hits.length > 1 ? "s" : ""} pour «&nbsp;{query.trim()}&nbsp;»
                </p>
                <ArticleList articles={hits} />
              </>
            ) : (
              <div aria-live="polite" className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
                <p className="font-medium">Aucun article ne correspond à «&nbsp;{query.trim()}&nbsp;».</p>
                <p className="mt-1 text-sm text-muted-foreground">Posez la question à l’équipe : elle vous répond par écrit.</p>
                <Button asChild size="sm" className={cn(navPrimary, "mt-5")}>
                  <Link href={`${NEW_REQUEST}?sujet=${encodeURIComponent(query.trim())}`}>Créer une demande</Link>
                </Button>
              </div>
            )
          ) : shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
              <p className="font-medium">La FAQ se remplit bientôt.</p>
              <p className="mt-1 text-sm text-muted-foreground">En attendant, l’équipe répond à toutes vos questions.</p>
              <Button asChild size="sm" className={cn(navPrimary, "mt-5")}>
                <Link href={NEW_REQUEST}>Créer une demande</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-12">
              {shown.map((c) => {
                const Icon = HELP_ICON_COMPONENTS[c.icon];
                return (
                  <section key={c.id} id={`rubrique-${c.slug}`} aria-labelledby={`rubrique-${c.slug}-titre`}>
                    <h2
                      id={`rubrique-${c.slug}-titre`}
                      className="flex items-center gap-3 font-display text-xl font-bold tracking-tight"
                    >
                      <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                        <Icon className="size-4" aria-hidden />
                      </span>
                      {c.title}
                    </h2>
                    <ArticleList articles={c.articles} />
                  </section>
                );
              })}
            </div>
          )}
          <p className="mt-12 text-sm text-(--lp-ink-2)">
            Vous n’avez pas trouvé votre réponse ?{" "}
            <Link href={NEW_REQUEST} className="font-medium text-primary underline-offset-4 hover:underline">
              Créer une demande
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}

function CategoryButton({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // pills on mobile (horizontal scroll), list items on desktop
        "flex w-full items-center gap-2.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium transition-colors lg:rounded-xl lg:border-transparent",
        active
          ? "border-primary bg-primary text-primary-foreground lg:bg-accent lg:text-accent-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground lg:bg-transparent lg:hover:bg-muted",
      )}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      <span className={cn("text-xs tabular-nums", active ? "opacity-80" : "text-muted-foreground")}>{count}</span>
    </button>
  );
}

function ArticleList({ articles }: { articles: ListedArticle[] }) {
  return (
    <div className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-(--shadow-card)">
      {articles.map((a) => (
        <details key={a.id} id={`a-${a.id}`} className="group">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span>
              {a.categoryTitle && (
                <span className="mb-1 block text-xs font-medium text-muted-foreground">{a.categoryTitle}</span>
              )}
              <span className="font-medium leading-snug">{a.question}</span>
            </span>
            <ChevronDown
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
            />
          </summary>
          <div className="px-5 pb-5">
            <FaqAnswer text={a.answer} />
          </div>
        </details>
      ))}
    </div>
  );
}
