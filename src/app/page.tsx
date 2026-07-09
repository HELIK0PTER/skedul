import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  CreditCard,
  Store,
  Ticket,
  Wallet,
} from "lucide-react";

import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HeroCards } from "@/components/hero-cards";
import { TicketCta } from "@/components/ticket-cta";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";

const SIDES = [
  {
    eyebrow: "Côté pro",
    title: "Un back-office qui vend pour vous",
    features: [
      {
        icon: CalendarCheck,
        title: "Des créneaux qui se calculent seuls",
        body: "Définissez vos disponibilités hebdomadaires et vos prestations : chaque créneau libre se déduit automatiquement.",
      },
      {
        icon: Ticket,
        title: "Des carnets à votre image",
        body: "4 séances, 10 cours, 5 heures de coaching… vous fixez le contenu et le prix de chaque pack.",
      },
      {
        icon: CreditCard,
        title: "Encaissé par Stripe",
        body: "Réservations à l'unité et carnets réglés en ligne, l'argent arrive sur votre compte.",
      },
    ],
  },
  {
    eyebrow: "Côté client",
    title: "Une boutique où réserver est simple",
    features: [
      {
        icon: Store,
        title: "Une page à votre nom",
        body: "skedul.app/votre-nom : vos prestations, vos packs, et la réservation en quelques clics.",
      },
      {
        icon: Wallet,
        title: "Un solde toujours visible",
        body: "Chaque carnet acheté crédite un solde ; chaque réservation décompte un crédit, sous leurs yeux.",
      },
      {
        icon: CalendarCheck,
        title: "Réserver sans repayer",
        body: "Une fois le carnet payé, vos clients posent leurs heures quand ils veulent, jusqu'à la dernière.",
      },
    ],
  },
];

/* Avis fictifs pour le mur défilant — deux rangées, vitesses différentes. */
const REVIEWS_ROW_1 = [
  {
    quote:
      "Mes élèves achètent leur carte de 10 cours en ligne et posent leurs séances toutes seules. Je n'ai plus un seul virement à courir.",
    name: "Claire M.",
    role: "Prof de yoga · Lyon",
  },
  {
    quote:
      "J'ai vendu trois packs la première semaine. Le solde se décompte tout seul, mes clients adorent voir où ils en sont.",
    name: "Karim B.",
    role: "Coach sportif · Paris",
  },
  {
    quote:
      "Avant je notais les séances restantes dans un carnet papier. Maintenant c'est le carnet qui me suit.",
    name: "Sofia R.",
    role: "Kiné à domicile · Bordeaux",
  },
  {
    quote:
      "La page de réservation est plus jolie que mon ancien site. Et elle encaisse à ma place.",
    name: "Théo L.",
    role: "Prof de guitare · Nantes",
  },
  {
    quote: "Fini les no-shows : quand c'est prépayé, les gens viennent.",
    name: "Awa D.",
    role: "Coach vocal · Lille",
  },
  {
    quote:
      "Mes clients réservent le dimanche soir pour toute la semaine. Moi, je ne fais plus rien.",
    name: "Marc P.",
    role: "Ostéopathe · Toulouse",
  },
];

const REVIEWS_ROW_2 = [
  {
    quote:
      "Le pack 5 heures est devenu mon produit le plus vendu. Je ne vends presque plus à l'unité.",
    name: "Inès G.",
    role: "Prof d'anglais · Marseille",
  },
  {
    quote: "Configuré un mardi soir, premier carnet vendu le mercredi matin.",
    name: "Julien V.",
    role: "Photographe · Rennes",
  },
  {
    quote:
      "Le lien skedul dans ma bio Instagram fait le travail d'une assistante.",
    name: "Léa T.",
    role: "Tatoueuse · Montpellier",
  },
  {
    quote:
      "Mes habitués rechargent leur carnet sans que je leur demande quoi que ce soit.",
    name: "Nicolas F.",
    role: "Coach d'échecs · en ligne",
  },
  {
    quote: "Je voulais Calendly + une carte de fidélité. C'est exactement ça.",
    name: "Emma S.",
    role: "Naturopathe · Annecy",
  },
  {
    quote:
      "Dix cours vendus d'un coup, un samedi. Sur la plage, on ne parle que de ça.",
    name: "Rafael C.",
    role: "Altinha Paris",
  },
];

type Review = (typeof REVIEWS_ROW_1)[number];

function ReviewCard({ review }: { review: Review }) {
  return (
    <figure className="mr-4 w-80 shrink-0 rounded-2xl border border-border bg-card p-5 shadow-(--shadow-card)">
      <blockquote className="text-sm text-foreground">
      &laquo;&nbsp;{review.quote}&nbsp;&raquo;
      </blockquote>
      <figcaption className="mt-4 border-t border-dashed border-border pt-3 font-mono text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{review.name}</span>{" "}
        — {review.role}
      </figcaption>
    </figure>
  );
}

function ReviewMarquee({
  reviews,
  duration,
}: {
  reviews: Review[];
  duration: string;
}) {
  return (
    <div className="marquee">
      <div
        className="marquee-track"
        style={{ "--marquee-duration": duration } as React.CSSProperties}
      >
        <div className="flex">
          {reviews.map((r) => (
            <ReviewCard key={r.name} review={r} />
          ))}
        </div>
        <div className="flex" aria-hidden>
          {reviews.map((r) => (
            <ReviewCard key={r.name} review={r} />
          ))}
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  {
    step: "01",
    title: "Vous configurez",
    body: "Prestations, disponibilités et carnets, depuis votre back-office.",
  },
  {
    step: "02",
    title: "Ils achètent",
    body: "Un créneau à l'unité, ou un carnet d'heures payé une fois via Stripe.",
  },
  {
    step: "03",
    title: "Ils réservent",
    body: "Chaque séance posée décompte un crédit. Rien à repayer, rien à relancer.",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-aurora">
          <div className="mx-auto grid max-w-6xl items-center gap-16 px-5 pb-28 pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10 lg:pt-24">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-primary">
                Agenda + carnets prépayés
              </p>
              <h1 className="mt-4 text-balance font-display text-5xl font-bold tracking-tight sm:text-6xl">
                La carte de 10 séances passe en ligne.
              </h1>
              <p className="mt-6 max-w-xl text-balance text-lg text-muted-foreground">
                Skedul donne à chaque indépendant son agenda et sa boutique :
                vos clients réservent un créneau, ou achètent un carnet
                d&apos;heures qu&apos;ils posent quand ils veulent —{" "}
                <span className="font-semibold text-foreground">
                  déjà payé
                </span>
                .
              </p>
              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link href="/sign-up">
                    Créer ma page gratuitement
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <Link href="/demo">Voir la démo</Link>
                </Button>
              </div>
              {env.APP_ENV !== "production" && (
                <p className="mt-5 font-mono text-xs text-muted-foreground">
                  Démo :{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5">
                    pro@skedul.app
                  </code>{" "}
                  /{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5">
                    password123
                  </code>
                </p>
              )}
            </div>

            <HeroCards />
          </div>
        </section>

        {/* Deux côtés */}
        <section id="features" className="border-t border-dashed border-border">
          <div className="mx-auto max-w-6xl px-5 py-24">
            <h2 className="max-w-2xl text-balance font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Un seul agenda, deux façons de le remplir.
            </h2>
            <p className="mt-3 max-w-xl text-muted-foreground">
              Vous préparez tout d&apos;un côté ; vos clients achètent et
              réservent de l&apos;autre.
            </p>

            <div className="mt-14 grid gap-12 md:grid-cols-2 md:gap-8">
              {SIDES.map((side) => (
                <div key={side.eyebrow}>
                  <p className="font-mono text-xs uppercase tracking-widest text-primary">
                    {side.eyebrow}
                  </p>
                  <h3 className="mt-2 font-display text-xl font-semibold">
                    {side.title}
                  </h3>
                  <ul className="mt-8 space-y-8">
                    {side.features.map((f) => (
                      <li key={f.title} className="flex gap-4">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-muted text-primary">
                          <f.icon className="size-5" />
                        </span>
                        <div>
                          <h4 className="font-semibold">{f.title}</h4>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {f.body}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Comment ça marche : trois talons de ticket */}
        <section id="how" className="border-y border-dashed border-border bg-card">
          <div className="mx-auto max-w-6xl px-5 py-24">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Comment ça marche
            </h2>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {STEPS.map((s) => (
                <div
                  key={s.step}
                  className="rounded-2xl border border-border bg-background p-6"
                >
                  <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                    Étape
                  </span>
                  <p className="mt-1 font-display text-5xl font-bold text-primary">
                    {s.step}
                  </p>
                  <div className="mt-5 border-t border-dashed border-border pt-5">
                    <h3 className="font-semibold">{s.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {s.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Avis : le mur défilant */}
        <section className="overflow-hidden py-24">
          <div className="mx-auto max-w-6xl px-5">
            <p className="font-mono text-xs uppercase tracking-widest text-primary">
              Avis des pros
            </p>
            <h2 className="mt-2 max-w-2xl text-balance font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Le bouche-à-oreille fait le reste.
            </h2>
          </div>
          <div className="mt-12 space-y-4">
            <ReviewMarquee reviews={REVIEWS_ROW_1} duration="52s" />
            <ReviewMarquee reviews={REVIEWS_ROW_2} duration="68s" />
          </div>
        </section>

        {/* CTA : le ticket de cinéma à découper */}
        <section id="packs" className="mx-auto max-w-6xl px-5 py-24">
          <div className="mx-auto max-w-2xl">
            <TicketCta />
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
