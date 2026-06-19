import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  CreditCard,
  Layers,
  Sparkles,
  Store,
  Ticket,
  Wallet,
} from "lucide-react";

import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export default function Home() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-aurora">
          <div className="mx-auto max-w-4xl px-5 pb-24 pt-20 text-center">
            <Badge className="mx-auto mb-6 inline-flex">
              <Sparkles className="size-3.5" />
              Réservations + packs prépayés
            </Badge>
            <h1 className="text-balance text-5xl font-bold tracking-tight sm:text-6xl">
              La réservation en ligne,{" "}
              <span className="text-primary">payée d&apos;avance.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
              Skedul donne à chaque indépendant son agenda et une
              boutique : vos clients réservent un créneau ou achètent un pack
              d&apos;heures qu&apos;ils posent quand ils veulent.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/sign-up">
                  Créer ma page gratuitement
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/studio-camille">Voir une page de démo</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Démo :{" "}
              <code className="rounded bg-muted px-1.5 py-0.5">
                pro@skedul.app
              </code>{" "}
              /{" "}
              <code className="rounded bg-muted px-1.5 py-0.5">
                password123
              </code>
            </p>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight">
            Tout pour vendre votre temps.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Un back-office complet pour vous, une expérience fluide pour vos
            clients.
          </p>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              {
                icon: CalendarCheck,
                title: "Créneaux à la Calendly",
                body: "Définissez vos disponibilités hebdomadaires et vos prestations. Les créneaux se calculent automatiquement.",
              },
              {
                icon: Ticket,
                title: "Packs d'heures prépayés",
                body: "Vendez des packs (4 séances, 10 cours…). Vos clients paient une fois, puis réservent sans repayer.",
              },
              {
                icon: Wallet,
                title: "Crédits & solde",
                body: "Chaque pack crédite un solde. À chaque réservation, un crédit est déduit automatiquement.",
              },
              {
                icon: Store,
                title: "Votre page boutique",
                body: "Une landing page publique façon e-commerce : prestations, packs et réservation en quelques clics.",
              },
              {
                icon: CreditCard,
                title: "Paiement Stripe",
                body: "Encaissez les réservations à l'unité et les packs en toute sécurité via Stripe Checkout.",
              },
              {
                icon: Layers,
                title: "Multi-environnements",
                body: "Dev, preview et production séparés (Neon + Vercel), prêts à déployer.",
              },
            ].map((f) => (
              <Card key={f.title} className="p-6">
                <span className="grid size-11 place-items-center rounded-xl bg-accent text-accent-foreground">
                  <f.icon className="size-5" />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-y border-border bg-card">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <h2 className="text-center text-3xl font-bold tracking-tight">
              Comment ça marche
            </h2>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {[
                {
                  step: "01",
                  title: "Le pro configure",
                  body: "Prestations, disponibilités et packs depuis le back-office.",
                },
                {
                  step: "02",
                  title: "Le client achète",
                  body: "Un créneau à l'unité, ou un pack d'heures prépayé via Stripe.",
                },
                {
                  step: "03",
                  title: "Le client réserve",
                  body: "Il pose ses créneaux quand il veut, ses crédits se décomptent.",
                },
              ].map((s) => (
                <div key={s.step} className="relative">
                  <span className="text-5xl font-bold text-primary-muted">
                    {s.step}
                  </span>
                  <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section id="packs" className="mx-auto max-w-6xl px-5 py-20">
          <Card className="overflow-hidden border-0 bg-primary p-10 text-center text-primary-foreground shadow-(--shadow-pop) md:p-16">
            <h2 className="text-balance text-3xl font-bold md:text-4xl">
              Lancez votre page de réservation aujourd&apos;hui.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-balance text-primary-foreground/80">
              Gratuit pour démarrer. Vos packs, vos créneaux, vos règles.
            </p>
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="mt-8 text-primary"
            >
              <Link href="/sign-up">
                Commencer maintenant
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </Card>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
