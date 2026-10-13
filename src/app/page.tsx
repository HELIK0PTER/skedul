import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { DEMO_BRAND } from "@/components/demo/demo-data";
import { INITIAL_STATE, type DemoState } from "@/components/demo/demo-script";
import { ClientProfile } from "@/components/demo/screens/client-profile";
import { ProPacks } from "@/components/demo/screens/pro-packs";
import { HeroDeck } from "@/components/landing/hero-deck";
import { ctaPrimary, ctaSecondary } from "@/components/landing/cta";
import { DemoLink } from "@/components/landing/demo-link";
import styles from "@/components/landing/landing.module.css";
import { PlanningScreen } from "@/components/landing/planning-screen";
import { ProductShot } from "@/components/landing/product-shot";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { toDayKey } from "@/lib/calendar-grid";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "Skedul · Réservations et carnets prépayés" },
};

/* French typography:   before « : »,   before « ; ? ». */

const CONTAINER = "mx-auto w-full max-w-[75rem] px-5 sm:px-8";
/* Display text may break inside a long word rather than overflow. */
const WRAP = "min-w-0 [overflow-wrap:anywhere]";
const H2 = cn(
  WRAP,
  "font-display text-[clamp(2rem,1.6vw+1.4rem,3rem)] font-bold leading-[1.04] tracking-[-0.028em] text-balance",
);
const H3 = cn(
  WRAP,
  "font-display text-[1.75rem] font-bold leading-tight tracking-[-0.02em]",
);

interface Point {
  title: string;
  body: ReactNode;
}

const CLIENT_POINTS: Point[] = [
  {
    title: "Une page à votre nom",
    body: (
      <>
        <span className="font-mono text-[0.875rem] text-(--lp-ink)">
          skedul.app/votre-nom
        </span>
        {" : vos prestations, vos carnets et la réservation en quelques clics."}
      </>
    ),
  },
  {
    title: "Un solde toujours visible",
    body: "Chaque réservation décompte un crédit, sous les yeux de vos clients.",
  },
  {
    title: "Réserver sans repayer",
    body: "Une fois le carnet payé, ils posent leurs heures jusqu’à la dernière.",
  },
];

const PRO_POINTS: Point[] = [
  {
    title: "Des créneaux qui se calculent seuls",
    body: "Vos disponibilités et vos prestations suffisent : chaque créneau libre s’en déduit.",
  },
  {
    title: "Individuel ou en groupe",
    body: "Fixez un nombre de places par séance, du coaching privé au cours collectif.",
  },
  {
    title: "Une page à vos couleurs",
    body: "Bannière, avatar, couleur et mise en page, réglés avec un aperçu en direct.",
  },
];

const PACK_POINTS: Point[] = [
  {
    title: "Toutes vos prestations, ou une seule",
    body: "Le carnet couvre tout votre catalogue, ou seulement la prestation que vous choisissez.",
  },
  {
    title: "Un solde qui ne passe jamais sous zéro",
    body: "Le crédit est retiré au moment de la réservation, une seule fois.",
  },
  {
    title: "Réglé en ligne par Stripe",
    body: "Vos clients paient le carnet par carte avant de réserver leur première séance.",
  },
];

const STEPS = [
  {
    verb: "Vous configurez",
    body: "Prestations, disponibilités et carnets, depuis votre back-office.",
  },
  {
    verb: "Ils achètent",
    body: "Un créneau à l’unité, ou un carnet d’heures payé une fois en ligne.",
  },
  {
    verb: "Ils réservent",
    body: "Chaque séance posée décompte un crédit. Rien à repayer, rien à relancer.",
  },
];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Mes clients doivent-ils créer un compte ?",
    a: "Non. Un nom et une adresse e-mail suffisent pour réserver une séance ou acheter un carnet.",
  },
  {
    q: "Puis-je bloquer mes vacances ?",
    a: "Oui. Ajoutez une indisponibilité et les créneaux concernés disparaissent de votre page.",
  },
  {
    q: "Un client m’appelle pour réserver, je fais comment ?",
    a: "Vous ajoutez la réservation vous-même, depuis votre planning.",
  },
  {
    q: "Combien ça coûte ?",
    a: "Créer votre page est gratuit et sans engagement.",
  },
  {
    q: "Puis-je voir l’outil avant de créer ma page ?",
    a: (
      <>
        Oui. La démo guidée déroule une réservation côté client, puis le
        back-office côté pro, sans inscription.
        <DemoLink className="mt-3">Voir la démo</DemoLink>
      </>
    ),
  },
];

/* The product shots reuse the guided tour's screens and data, frozen on
   the state that tells each story best. */
const PLANNING_STATE: DemoState = {
  ...INITIAL_STATE,
  screen: "pro-planning",
  planningHasLea: true,
};
const PACKS_STATE: DemoState = {
  ...INITIAL_STATE,
  screen: "pro-packs",
  packFormOpen: true,
};

function Points({ items, className }: { items: Point[]; className?: string }) {
  return (
    <dl className={cn("space-y-5", className)}>
      {items.map((point) => (
        <div key={point.title} className="max-w-[46ch]">
          <dt className="font-semibold text-balance">{point.title}</dt>
          <dd className="mt-1 leading-relaxed text-pretty text-(--lp-ink-2)">
            {point.body}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function Home() {
  return (
    <div className={cn(styles.root, "flex min-h-full flex-1 flex-col")}>
      <SiteHeader />

      <main className="flex-1">
        {/* Hero: the promise on the left, the carnet itself on the right. */}
        <section
          className={cn(
            CONTAINER,
            "grid grid-cols-1 items-center gap-x-8 gap-y-14 pb-24 pt-12 sm:pt-16 lg:grid-cols-12 lg:pb-28 lg:pt-20",
          )}
        >
          <div className="lg:col-span-7">
            <h1
              className={cn(
                WRAP,
                "font-display text-[clamp(2.5rem,2.6vw+1.5rem,4rem)] font-bold leading-[1.02] tracking-[-0.032em] text-balance",
              )}
            >
              {"La carte de 10 séances passe en ligne."}
            </h1>
            <p
              className={cn(
                styles.rise,
                "mt-6 max-w-[34rem] text-lg leading-relaxed text-(--lp-ink-2)",
              )}
              style={{ "--i": 1 } as CSSProperties}
            >
              Vos clients réservent un créneau à l’unité, ou achètent un carnet
              d’heures et posent leurs séances quand ils veulent.
            </p>
            <div
              className={cn(styles.rise, "mt-9 flex flex-wrap items-center gap-3")}
              style={{ "--i": 2 } as CSSProperties}
            >
              <Button asChild size="lg" className={ctaPrimary}>
                <Link href="/sign-up">
                  Créer ma page
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className={ctaSecondary}>
                <Link href="/demo">Voir la démo</Link>
              </Button>
            </div>
          </div>

          <div className="lg:col-span-5">
            {/* Server-side "today", so the deck's dates hydrate identically. */}
            <HeroDeck todayKey={toDayKey(new Date())} />
          </div>
        </section>

        {/* Fonctionnalités: the two sides of the same agenda, shown live. */}
        <section id="features" className="scroll-mt-24 pb-24 pt-12 lg:pb-32 lg:pt-16">
          <div className={CONTAINER}>
            <h2 className={cn(H2, "max-w-[18ch]")}>
              Un seul agenda, deux façons de le remplir.
            </h2>
            <p className="mt-5 max-w-[34rem] text-lg leading-relaxed text-(--lp-ink-2)">
              {"Vous préparez tout d’un côté ; vos clients achètent et réservent de l’autre."}
            </p>

            <div className="mt-16 grid grid-cols-1 gap-x-10 gap-y-20 lg:grid-cols-12">
              <article className="lg:col-span-7">
                <ProductShot
                  label="Aperçu du planning de la semaine, dans le back-office du pro."
                  crop={660}
                  cropLeft={208}
                  className={styles.reveal}
                >
                  <PlanningScreen state={PLANNING_STATE} />
                </ProductShot>
                <h3 className={cn(H3, "mt-10")}>
                  Un back-office qui vend pour vous
                </h3>
                <Points items={PRO_POINTS} className="mt-6" />
                <DemoLink step="planning" className="mt-7">
                  Voir le planning en démo
                </DemoLink>
              </article>

              <article className="lg:col-span-5 lg:mt-36">
                <ProductShot
                  label={`Aperçu de la page publique d’${DEMO_BRAND.businessName} : ses prestations et son carnet de séances.`}
                  width={800}
                  crop={660}
                  className={styles.reveal}
                >
                  <ClientProfile state={INITIAL_STATE} />
                </ProductShot>
                <h3 className={cn(H3, "mt-10")}>
                  Une boutique où réserver est simple
                </h3>
                <Points items={CLIENT_POINTS} className="mt-6" />
                <DemoLink step="profile" className="mt-7">
                  Voir la réservation en démo
                </DemoLink>
              </article>
            </div>
          </div>
        </section>

        {/* Packs prépayés: the screen where a pro builds a carnet, annotated. */}
        <section
          id="packs"
          className="scroll-mt-24 border-y border-(--lp-rule) bg-(--lp-paper-2) py-24 lg:py-32"
        >
          <div className={CONTAINER}>
            <h2 className={cn(H2, "max-w-[20ch]")}>
              Payé une fois, décompté à chaque séance.
            </h2>
            <p className="mt-5 max-w-[38rem] text-lg leading-relaxed text-(--lp-ink-2)">
              {"Vous fixez le contenu et le prix de chaque carnet : 4 séances, 10 cours, 5 heures de coaching. Chaque réservation retire un crédit."}
            </p>
          </div>

          <div className={cn(styles.packsGrid, "mt-14 lg:mt-16")}>
            <div className={styles.packsFigure}>
              <ProductShot
                label="Aperçu de la création d’un carnet dans le back-office : nom, nombre de crédits, prix et prestation associée."
                crop={590}
                overscan={1.08}
                bleed
                className={styles.reveal}
              >
                <ProPacks state={PACKS_STATE} />
              </ProductShot>
            </div>
            <div className={styles.packsText}>
              <Points items={PACK_POINTS} className="space-y-7" />
              {/* The client buys a carnet, then books with a credit: 10 → 9. */}
              <DemoLink step="buy-pack" className="mt-8">
                Voir un carnet en démo
              </DemoLink>
            </div>
          </div>
        </section>

        {/* Comment ça marche: three verbs, stepping down like a sequence. */}
        <section id="how" className="scroll-mt-24 py-24 lg:py-28">
          <div className={CONTAINER}>
            <h2 className={H2}>Comment ça marche</h2>
            <ol className="mt-14 grid gap-x-8 gap-y-12 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <li
                  key={step.verb}
                  className={cn(
                    "border-t-[1.5px] border-dashed border-(--lp-rule-2) pt-7",
                    i === 1 && "md:mt-12",
                    i === 2 && "md:mt-24",
                  )}
                >
                  <h3 className={H3}>{step.verb}</h3>
                  <p className="mt-3 leading-relaxed text-pretty text-(--lp-ink-2)">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
            {/* Under the last step, so the CTA ends the staircase. */}
            <div className="mt-12 grid gap-x-8 md:grid-cols-3">
              <div className="md:col-start-3">
                <Button asChild size="lg" variant="outline" className={ctaSecondary}>
                  <Link href="/demo">Voir la démo</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Questions fréquentes: short, checkable answers. */}
        <section
          id="faq"
          className="scroll-mt-24 border-t border-(--lp-rule) py-20 lg:py-24"
        >
          <div className={cn(CONTAINER, "grid gap-x-8 gap-y-10 lg:grid-cols-12")}>
            <h2 className={cn(H2, "lg:col-span-4")}>Questions fréquentes</h2>
            <dl className="divide-y divide-(--lp-rule) lg:col-span-7 lg:col-start-6">
              {FAQ.map((item) => (
                <div key={item.q} className="py-6 first:pt-0 last:pb-0">
                  <dt className="text-lg font-semibold leading-snug">{item.q}</dt>
                  <dd className="mt-2 max-w-[60ch] leading-relaxed text-(--lp-ink-2)">
                    {item.a}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Closing CTA: the cinema ticket, one action on the stub. */}
        <section aria-labelledby="cta-title" className="pb-24 pt-4 lg:pb-32">
          <div className={CONTAINER}>
            <div className={cn(styles.ticket, "mx-auto max-w-[62rem]")}>
              <div className={styles.ticketMain}>
                <h2
                  id="cta-title"
                  className="max-w-[21ch] font-display text-[clamp(1.875rem,1.4vw+1.4rem,2.75rem)] font-bold leading-[1.05] tracking-[-0.025em] text-balance"
                >
                  Votre page de réservation, prête ce soir.
                </h2>
                <p className="mt-4 max-w-[45ch] leading-relaxed text-(--lp-ticket-ink-2)">
                  Créez votre page, ajoutez un carnet, partagez le lien. Vos
                  règles, vos prix.
                </p>
              </div>
              <div
                className={cn(
                  styles.ticketStub,
                  "flex flex-col items-center justify-center gap-4 text-center",
                )}
              >
                <p className="text-sm font-medium text-(--lp-ticket-ink-2)">
                  Gratuit pour démarrer
                </p>
                <Button
                  asChild
                  size="lg"
                  className={cn(
                    ctaPrimary,
                    "focus-visible:ring-offset-(--lp-ticket)",
                  )}
                >
                  <Link href="/sign-up">
                    Créer ma page
                    <ArrowRight />
                  </Link>
                </Button>
                <DemoLink tone="ticket" className="text-sm">
                  Voir la démo
                </DemoLink>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
