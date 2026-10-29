import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { DEMO_BRAND } from "@/components/demo/demo-data";
import { INITIAL_STATE, type DemoState } from "@/components/demo/demo-script";
import { ClientPage } from "@/components/demo/screens/client-page";
import { ProTickets } from "@/components/demo/screens/pro-tickets";
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
import { HOLD_MINUTES } from "@/lib/tickets-vocab";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "Skedul · Séances, carnets de tickets et rendez-vous" },
};

/*
 * French typography: a no-break space ( ) before « : » and between a number and its unit, a narrow no-break
 * space ( ) before « ; ? ». The copy speaks the redesign's words only (tickets, offres, carnets, séances,
 * événements, rendez-vous): src/lib/marketing-copy.test.ts scans this file for the old ones.
 */

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
          myskedul.com/votre-nom
        </span>
        {" : votre planning, votre boutique et vos rendez-vous, à vos couleurs."}
      </>
    ),
  },
  {
    title: "Acheter et réserver en une fois",
    body: `Le client choisit sa séance et son ticket, puis paie par carte. Sa place lui est gardée ${HOLD_MINUTES} minutes.`,
  },
  {
    title: "Ses tickets, avec un code par e-mail",
    body: "Pour utiliser un ticket déjà acheté, il reçoit un code par e-mail. Aucun compte à créer.",
  },
];

const PRO_POINTS: Point[] = [
  {
    title: "Des séances qui se répètent seules",
    body: "Un événement récurrent crée ses séances, avec leur lieu, leurs places et les tickets acceptés.",
  },
  {
    title: "Des rendez-vous dans vos horaires",
    body: "Vos disponibilités suffisent : chaque créneau libre se réserve en rendez-vous, payant ou gratuit.",
  },
  {
    title: "Vos clients et leurs tickets",
    body: "Chaque fiche montre les réservations et les tickets restants. Vous déplacez un inscrit ou pointez un ticket à tout moment.",
  },
];

const OFFER_POINTS: Point[] = [
  {
    title: "Un ticket pour plusieurs cours",
    body: "Vous choisissez les événements qui acceptent chaque type de ticket : un même carnet sert à plusieurs cours.",
  },
  {
    title: "Une validité si vous le voulez",
    body: "Chaque offre peut avoir sa durée de validité, comptée depuis l’achat. Sans durée, le ticket n’expire pas.",
  },
  {
    title: "Réglé en ligne par Stripe",
    body: "Vos clients paient par carte, depuis votre boutique ou en réservant leur première séance.",
  },
];

const STEPS = [
  {
    verb: "Vous configurez",
    body: "Vos tickets et leurs offres, vos événements et vos horaires de rendez-vous.",
  },
  {
    verb: "Ils achètent",
    body: "Un ticket à l’unité ou un carnet, payé par carte en ligne.",
  },
  {
    verb: "Ils réservent",
    body: "Chaque séance réservée utilise un ticket. S’ils annulent avant votre délai, leur ticket leur revient.",
  },
];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Mes clients doivent-ils créer un compte ?",
    a: "Non. Un nom et une adresse e-mail suffisent pour réserver une séance ou acheter un carnet. Pour utiliser un ticket déjà acheté, ils reçoivent un code par e-mail.",
  },
  {
    q: "Un client peut-il annuler ?",
    a: "Oui, depuis son espace, jusqu’au délai que vous fixez (24 heures avant la séance, par exemple). Son ticket lui est rendu.",
  },
  {
    q: "Puis-je bloquer mes vacances ?",
    a: "Oui. Ajoutez une indisponibilité : vos rendez-vous ne sont plus proposés sur ces dates, et Skedul vous montre les séances qui ont déjà des inscrits avant d’enregistrer.",
  },
  {
    q: "Un client m’appelle pour réserver, je fais comment ?",
    a: "Vous l’inscrivez vous-même depuis votre planning, avec un de ses tickets ou en invité.",
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
const TICKETS_STATE: DemoState = {
  ...INITIAL_STATE,
  screen: "pro-tickets",
  ticketTypeOpen: true,
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
              Vos clients achètent un ticket ou un carnet, réservent leurs
              séances en ligne et retrouvent leurs tickets dans leur espace.
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
                  label={"Aperçu du planning de la semaine dans le back-office : les séances de chaque événement et les rendez-vous."}
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
                  label={`Aperçu de la page publique d’${DEMO_BRAND.businessName} : le planning de la semaine et les places restantes de chaque séance.`}
                  width={800}
                  crop={660}
                  className={styles.reveal}
                >
                  <ClientPage />
                </ProductShot>
                <h3 className={cn(H3, "mt-10")}>
                  Une page où réserver est simple
                </h3>
                <Points items={CLIENT_POINTS} className="mt-6" />
                <DemoLink step="page-publique" className="mt-7">
                  Voir la réservation en démo
                </DemoLink>
              </article>
            </div>
          </div>
        </section>

        {/* Tickets et carnets: the screen where a pro sets a ticket type's offers, annotated. */}
        <section
          id="carnets"
          className="scroll-mt-24 border-y border-(--lp-rule) bg-(--lp-paper-2) py-24 lg:py-32"
        >
          <div className={CONTAINER}>
            <h2 className={cn(H2, "max-w-[20ch]")}>
              Payé une fois, décompté à chaque séance.
            </h2>
            <p className="mt-5 max-w-[38rem] text-lg leading-relaxed text-(--lp-ink-2)">
              {"Un type de ticket, puis ses offres : à l’unité, en carnet de 4 ou de 10, avec ou sans validité. Chaque séance réservée utilise un ticket."}
            </p>
          </div>

          <div className={cn(styles.offersGrid, "mt-14 lg:mt-16")}>
            <div className={styles.offersFigure}>
              <ProductShot
                label={"Aperçu d’un type de ticket dans le back-office : ses offres à l’unité et en carnets, leur prix, leur validité et les événements qui l’acceptent."}
                crop={590}
                overscan={1.08}
                bleed
                className={styles.reveal}
              >
                <ProTickets state={TICKETS_STATE} />
              </ProductShot>
            </div>
            <div className={styles.offersText}>
              <Points items={OFFER_POINTS} className="space-y-7" />
              {/* The tour's step where the client buys a carnet on her first séance. */}
              <DemoLink step="carnet" className="mt-8">
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
                  Créez votre page, ajoutez vos tickets et vos séances, partagez
                  le lien. Vos règles, vos prix.
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
