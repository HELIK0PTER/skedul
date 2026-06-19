# Skedul

**La réservation en ligne, payée d'avance.** Un SaaS façon Calendly pour les
indépendants, **avec en plus des packs d'heures prépayés** : un client achète un
pack (ex. 4 séances), paie une fois, puis pose ses créneaux quand il veut — ses
crédits se décomptent automatiquement.

Chaque pro dispose :

- d'un **back-office** (prestations, disponibilités, packs, réservations, profil) ;
- d'une **page publique e-commerce** (`/[slug]`) où ses clients réservent un
  créneau (paiement à l'unité) ou achètent un pack, et utilisent leurs crédits.

## Stack

| Domaine | Choix |
|---|---|
| Framework | Next.js 16 (App Router, RSC, Server Actions, Turbopack) |
| Langage | TypeScript |
| Styling | Tailwind CSS v4 + composants maison |
| Base de données | Neon (Postgres serverless) |
| ORM | Drizzle ORM + drizzle-kit |
| Auth | Better Auth (email/mot de passe) |
| Paiement | Stripe Checkout (+ webhook) |
| Email | Resend |
| Déploiement | Vercel |

> Stripe et Resend tournent en **mode mock** tant que les vraies clés ne sont pas
> fournies (placeholder `…xxx`) : le paiement est simulé localement
> (`/api/mock-checkout`) et les emails sont loggués en console. L'app est donc
> 100 % fonctionnelle sans aucune clé tierce.

## Démarrage

```bash
pnpm install
cp .env.example .env.local   # puis remplir DATABASE_URL + BETTER_AUTH_SECRET
pnpm db:migrate              # applique le schéma
pnpm db:seed                 # données de démo
pnpm dev                     # http://localhost:3000
```

### Comptes de démo (après `db:seed`)

| Rôle | Identifiants |
|---|---|
| Professionnel | `pro@skedul.app` / `password123` |
| Client | `sophie@example.com` / `password123` |

- Page publique de démo : **`/studio-camille`**
- Back-office : **`/dashboard`**

## Environnements

Le projet est câblé pour **3 environnements**, chacun sur sa propre branche Neon :

| Env | Branche Neon | Base |
|---|---|---|
| `development` | `development` | locale (`.env.local`) |
| `preview` | `preview` | déploiements de preview Vercel |
| `production` | `main` | production |

Les valeurs réelles par environnement sont dans **`.env.vercel-reference`**
(git-ignoré). Pour les pousser sur Vercel (après `vercel link`) :

```bash
node scripts/setup-vercel-env.mjs        # toutes les variables, tous les envs
```

Variables attendues : voir **`.env.example`**.
`getAppUrl()` ([src/lib/env.ts](src/lib/env.ts)) résout l'URL automatiquement
(`NEXT_PUBLIC_APP_URL` → `BETTER_AUTH_URL` → `VERCEL_URL` → `localhost`).

## Scripts

| Script | Rôle |
|---|---|
| `pnpm dev` | serveur de dev |
| `pnpm build` / `pnpm start` | build & run production |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | génère une migration depuis le schéma |
| `pnpm db:migrate` | applique les migrations |
| `pnpm db:push` | push direct du schéma (dev rapide) |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm db:seed` | (re)remplit les données de démo |

> `db:migrate` / `db:seed` ciblent `DATABASE_URL`. Pour viser preview/prod :
> `DATABASE_URL='…' pnpm db:migrate` (sur Windows PowerShell : `$env:DATABASE_URL='…'; pnpm db:migrate`).

## Modèle métier (packs prépayés)

```
professional ─┬─ event_type (prestation : durée, prix, couleur)
              ├─ availability_rule (créneaux récurrents par jour)
              ├─ pack (N crédits, prix, prestation associée ou « toutes »)
              ├─ customer (client, identifié par email)
              │     └─ pack_purchase (crédits restants après paiement)
              └─ booking (RDV : paiement direct | crédit | gratuit)
```

- **Achat de pack** → `pack_purchase` (statut `pending`) → Stripe → webhook
  (`/api/stripe/webhook`) ou mock → statut `paid` + crédits crédités + email reçu.
- **Réservation par crédit** → décrément atomique de `credits_remaining`
  (`… - 1 WHERE credits_remaining > 0`) puis `booking` confirmé.
- **Réservation payante** → `booking` `pending` → Stripe → confirmé.
- **Réservation gratuite** (prix 0) → confirmée immédiatement.

Le calcul des créneaux ([src/lib/availability.ts](src/lib/availability.ts)) gère
fuseau horaire, durée, marges (buffers) et collisions avec les réservations.

## Stripe & Resend en production

1. Renseigner les vraies clés (`sk_live_…`, `pk_live_…`, `re_…`) dans Vercel.
2. Configurer le webhook Stripe vers `https://<domaine>/api/stripe/webhook`
   (événement `checkout.session.completed`) et coller le `whsec_…` dans
   `STRIPE_WEBHOOK_SECRET`.

## Déploiement Vercel — manuel, depuis le CLI uniquement

⚠️ **Aucun déploiement automatique sur `git push`.** [vercel.ts](vercel.ts) fixe
`git.deploymentEnabled: false` : Vercel ne déploiera jamais tout seul sur push/PR.
C'est **toi** qui déclenches chaque déploiement, depuis le CLI.

**Mise en place (une fois) :**

```bash
vercel link                          # relie le dossier au projet Vercel
node scripts/setup-vercel-env.mjs    # pousse les variables des 2 environnements
```

**Déployer ensuite :**

```bash
pnpm deploy:preview   # → environnement PREVIEW  (Neon "preview", clés test)
pnpm deploy:prod      # → environnement PRODUCTION (Neon "main", clés live)
```

Les deux environnements sont **distincts** : `vercel deploy` cible *Preview* et
utilise les variables Preview ; `vercel deploy --prod` cible *Production* et
utilise les variables Production. Le découpage est garanti par les variables
poussées par `setup-vercel-env.mjs` (sections `[preview]` / `[production]` de
`.env.vercel-reference`).

## Structure

```
src/
  app/
    page.tsx                  # landing marketing
    (auth)/                   # sign-in, sign-up
    onboarding/               # création du profil pro
    dashboard/                # back-office (protégé)
    [slug]/                   # page publique du pro
      book/[eventTypeId]/     # réservation d'un créneau
      pack/[packId]/          # achat d'un pack
      merci/                  # confirmation
    api/
      auth/[...all]/          # Better Auth
      stripe/webhook/         # webhook Stripe
      mock-checkout/          # paiement simulé (sans clé Stripe)
  lib/                        # db, auth, env, stripe, email, payments, slots…
  server/                     # server actions (pro.ts, public.ts) + queries.ts
  components/                 # ui/ (primitives), dashboard/, public/
drizzle/                      # migrations SQL
scripts/                      # seed.ts, setup-vercel-env.mjs
```
