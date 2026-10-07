# Espace admin — Design

> Projet **1/2** du chantier « admin » : un espace réservé aux administrateurs de Skedul pour
> monitorer l'app (activité, santé), les utilisateurs et le trafic, avec quelques actions de
> support. Le projet **2/2** — la **facturation SaaS des pros** (plans, Stripe Billing,
> limites) — aura sa propre spec ; il remplira l'onglet « Abonnements » créé ici.
>
> Date : 2026-10-07.

## Problème

Skedul n'a aucune vue « plateforme » : pour savoir combien de pros sont inscrits, qui est
actif, ce qui s'encaisse ou d'où viennent les visiteurs, il faut interroger la base à la main.
Aucun trafic n'est mesuré, et il n'existe aucun moyen de suspendre un compte abusif ni de voir
le back-office d'un pro pour l'aider.

## Décisions validées

1. **Approche** : plugin **`admin` de Better Auth** (déjà inclus dans `better-auth` 1.6) pour
   le rôle, la suspension, la révocation de sessions et l'impersonation. On ne code que l'UI
   et les lectures.
2. **Même page de connexion** (`/sign-in`). Un admin voit, après connexion, une modal
   **« Accéder au : Dashboard Admin / Dashboard Client »** avec une case **« Se souvenir de
   mon choix »**.
3. **Désignation des admins** : rôle stocké en base, attribué par un script
   (`pnpm admin:grant <email>`). Aucun admin dans le seed ni dans la connexion rapide de démo.
4. **Pages** : Vue d'ensemble · Utilisateurs (+ fiche) · Trafic · Activité · Abonnements
   (état vide).
5. **Actions** : suspendre/réactiver, déconnecter partout, « se connecter en tant que »
   (pros uniquement), nommer/retirer admin. **Pas de suppression de compte.**
6. **Trafic** : suivi **maison, sans cookie** (table `page_view` + beacon navigateur), pages
   publiques uniquement.
7. **Abonnements** : la facturation SaaS n'existe pas encore → onglet présent avec un état vide
   explicite, sans fausses données.

## Hors périmètre

- Facturation SaaS des pros (projet 2) et toute notion de plan/limite.
- Suppression de compte, édition des données d'un utilisateur, export CSV.
- Tableau de bord temps réel, alertes par e-mail (la purge des pages vues à 25 mois, elle, est
  en place : § 5).
- Journal d'audit des actions admin (à envisager si plusieurs admins).

## Contraintes structurantes

- **Next.js 16** : `params`/`searchParams` asynchrones ; `cookies()`/`headers()` asynchrones.
- **Neon HTTP** : pas de transaction interactive ; chaque écriture est une requête autonome.
- **Better Auth** : `session.cookieCache` de 5 min → un changement de rôle ou une suspension
  peut mettre jusqu'à 5 min à se refléter dans une session déjà ouverte. Pour l'autorisation
  admin, on **relit le rôle en base** (jamais le cache).
- **Migrations** : `db:migrate` est cassé sous Windows en local ; sur Vercel, le
  `buildCommand` (`pnpm db:migrate && pnpm build`) migre preview/prod au déploiement.
- **Fuseau de l'admin** : constante `ADMIN_TZ = "Europe/Paris"` pour découper les jours
  (graphes, empreinte visiteur).
- **Aucune nouvelle dépendance** : graphes en SVG maison, primitives UI existantes.

## Architecture — 5 unités

| Unité | Rôle | Dépend de |
|---|---|---|
| **1. Rôle & autorisation** | Plugin admin, migration, garde `/admin`, script `admin:grant` | — |
| **2. Modal d'entrée** | Choix Admin/Client après connexion, cookie mémorisé, liens de bascule | 1 |
| **3. Pages de monitoring** | Vue d'ensemble, Utilisateurs, Activité, Abonnements (lecture) | 1 |
| **4. Actions utilisateur** | Suspension, sessions, impersonation, rôle admin | 1, 3 |
| **5. Trafic** | Table `page_view`, beacon, `/api/track`, page Trafic | 1 (page), 3 (vue d'ensemble) |

## 1. Rôle & autorisation

- **Enum** `user_role` : `client | pro | admin`. Le statut « pro » reste déterminé par
  l'existence d'une ligne `professional` ; un admin peut donc avoir sa page pro.
- **Better Auth** ([auth.ts](../../../src/lib/auth.ts),
  [auth-admin.ts](../../../src/lib/auth-admin.ts)) : ajout du plugin
  `admin({ defaultRole: "client", adminRoles: ["admin"], bannedUserMessage })` avant
  `nextCookies()`. `defaultRole: "client"` est **obligatoire** : sans lui, le plugin insère
  `role = "user"`, valeur absente de l'enum. `bannedUserMessage` : « Votre compte a été
  suspendu. Contactez le support si vous pensez qu'il s'agit d'une erreur. »
  Les endpoints HTTP du plugin (`/api/auth/admin/*`) sont **tous fermés** (`disabledPaths`,
  liste dérivée du plugin lui-même et couverte par un test) : ils s'appuient sur le rôle du
  cookie de session (cache 5 min) et contourneraient les garde-fous de nos server actions, qui
  relisent le rôle en base.
- **Client** ([auth-client.ts](../../../src/lib/auth-client.ts)) : `adminClient()` n'est pas
  nécessaire (toutes les actions passent par des server actions).
- **Onboarding** : `createProfessionalProfile` ne repasse plus un admin en `pro` (il ne met
  `role = "pro"` que si le rôle courant est `client`).
- **Garde** (`src/lib/admin.ts`, `server-only`) :
  - `getAdminUser()` (mémoïsé par requête) : session courante + relecture en base de `role`,
    `banned`, `ban_expires` ; renvoie l'utilisateur seulement si `role = "admin"` et non
    suspendu.
  - `requireAdmin()` pour les pages : pas de session → `redirect("/sign-in")` ; session non
    admin → `notFound()` (on ne révèle pas l'existence de l'admin).
  - Les server actions appellent `getAdminUser()` et renvoient « Accès refusé » sans lui.
  - `isSuspended()` et ses équivalents SQL vivent dans `src/lib/suspension.ts`.
- **Layout** `src/app/admin/layout.tsx` : `requireAdmin()` puis barre latérale admin.
- **Script** `scripts/grant-admin.ts` → `pnpm admin:grant <email>` (et `--revoke`) : met à
  jour `user.role` sur la base de `DATABASE_URL` (via `scripts/load-env`), refuse un e-mail
  inconnu, rappelle de se reconnecter (cache de session). `--revoke` remet `pro` ou `client`
  selon l'existence d'une page pro.

## 2. Modal d'entrée

- **Logique pure** (`src/lib/entry.ts`) : `EntryChoice = "admin" | "client"`,
  cookie `skedul_entry`, `parseEntryChoice(value)`, `entryPath(choice)` (`/admin` |
  `/dashboard`) et `resolveEntry({ isAdmin, remembered })` → chemin ou `"choose"`.
- **Server actions** (`src/server/entry.ts`) :
  - `resolvePostSignIn()` : non-admin → `/dashboard` ; admin avec cookie valide → son choix ;
    sinon `"choose"`.
  - `chooseEntry(choice, remember)` : vérifie que l'appelant est admin, pose le cookie si
    `remember` (httpOnly, `sameSite: lax`, 1 an, `secure` en prod), renvoie le chemin.
  - `forgetEntryChoice()` : supprime le cookie.
- **Formulaire** ([auth-form.tsx](../../../src/components/auth/auth-form.tsx)) : en mode
  connexion, après `signIn.email` réussi → `resolvePostSignIn()` → redirection ou ouverture de
  la modal. L'inscription ne change pas (jamais admin).
- **Modal** (`src/components/auth/entry-chooser.tsx`) : titre « Accéder au : », deux grandes
  options **Dashboard Admin** / **Dashboard Client**, case **Se souvenir de mon choix**
  (décochée par défaut). Elle ne se ferme pas sans choix (pas de croix, pas de clic extérieur)
  ; focus sur la première option, `role="dialog"`, `aria-modal`.
- **Déjà connecté** : `/sign-in` applique la même logique côté serveur — redirection, ou
  rendu de la page avec la modal ouverte.
- **Le cookie survit à la déconnexion** (préférence d'appareil, pas de session).
- **Bascule** :
  - barre latérale admin : lien « Dashboard Client », indicateur « Choix mémorisé : … » +
    bouton « Oublier mon choix » (si cookie présent) ;
  - barre latérale pro ([sidebar.tsx](../../../src/components/dashboard/sidebar.tsx)) : lien
    « Dashboard Admin », visible uniquement des admins ;
  - onboarding : lien « Aller au Dashboard Admin » pour un admin sans page pro.

## 3. Pages de monitoring

Barre latérale calquée sur celle du back-office pro, avec un badge « Admin ». Toutes les pages
sont des Server Components dynamiques ; les requêtes vivent dans
`src/server/admin-queries.ts` (`server-only`), séparé de `queries.ts`.

### Définitions des indicateurs

| Indicateur | Définition |
|---|---|
| Utilisateurs | `count(user)` ; « nouveaux 7 j » = `created_at` ≥ maintenant − 7 j |
| Pros | `count(professional)` |
| Pros actifs | pros ayant ≥ 1 réservation `confirmed`/`completed` **créée** sur 30 j |
| Réservations 30 j | réservations `confirmed`/`completed` créées sur 30 j |
| Volume encaissé | réservations `payment_type = direct` et `confirmed`/`completed` (`amount_paid_cents`, devise du pro) + achats de packs `paid` (`amount_paid_cents`, devise de l'achat) ; affiché **par devise** |
| Visiteurs | somme, jour par jour, des `visitor_hash` distincts sur la période (§ 5) |
| Suspendu | `banned = true` et (`ban_expires` nul ou futur) — une suspension dont la date est passée compte comme levée |
| Paiement en attente | réservation ou achat `pending` créé il y a plus d'1 h (sur les 7 derniers jours) |

### Vue d'ensemble (`/admin`)

- 5 cartes : Utilisateurs (+ nouveaux 7 j), Pros (dont actifs), Réservations 30 j, Volume
  encaissé 30 j, Visiteurs 7 j.
- 2 graphes en barres sur 30 j : inscriptions/jour, visiteurs/jour (jours vides à 0).
- Activité récente : les 10 derniers événements parmi inscriptions, pages pro créées,
  réservations, achats de packs payés (fusion triée par date).
- **État de l'app** : environnement (`APP_ENV`, URL) ; Stripe **Réel / Test / Simulé**
  (préfixe de clé `sk_live_`/`rk_live_` vs `sk_test_`/`rk_test_`) + webhook configuré ou non ;
  Resend, Blob : Réel / Simulé ; Google Agenda : configuré ou non ; latence d'un `select 1` ;
  alerte « N réservations / achats en attente de paiement depuis plus d'1 h » avec lien vers
  l'Activité filtrée sur `pending`.

### Utilisateurs (`/admin/users`)

- Colonnes : nom + e-mail, rôle (badge Client/Pro/Admin), page pro (lien `/slug` ou —),
  inscription, dernière connexion (ou —), statut (Actif / Suspendu / Suspendu jusqu'au …).
- `searchParams` : `q` (ILIKE sur nom, e-mail, nom d'activité), `filter`
  (`all|client|pro|admin|suspended`), `page` (25 par page, tri par inscription décroissante).
  `client` = rôle client ; `pro` = possède une page pro (quel que soit le rôle) ; `admin` =
  rôle admin ; `suspended` = suspendu au sens du tableau ci-dessus.
- Fiche `/admin/users/[id]` (404 si inconnu) :
  - **Compte** : inscription, dernière connexion, e-mail vérifié, connexions liées
    (mot de passe, Google) ;
  - **Page pro** : nom, lien, fuseau, devise, Google Agenda connecté, date de création ;
  - **Chiffres** (si pro) : prestations, réservations (total / à venir), clients, volume
    encaissé (depuis toujours), packs vendus ;
  - **Sessions actives** (`expires_at` futur) : appareil, IP, ouverte le, expire le, badge
    « en tant que » si `impersonated_by` ;
  - **Actions** (§ 4).

### Activité (`/admin/activity`)

- `searchParams` : `tab` (`bookings|purchases`), `status`.
- Réservations : créée le, pro (lien vers sa fiche), client (nom + e-mail), prestation,
  créneau (fuseau du pro), mode (Payé / Crédit / Offert), montant, statut.
- Achats de packs : créé le, pro, client, pack, crédits restants/total, montant, statut.
- 50 dernières lignes, état vide si aucune.

### Abonnements (`/admin/subscriptions`)

État vide : « La facturation des pros n'est pas encore en place », avec ce que la page
affichera ensuite (plans, abonnés actifs, MRR, résiliations). Aucune requête.

## 4. Actions sur un utilisateur

Server actions dans `src/server/admin.ts` ; chacune vérifie l'admin via `getAdminUser()`,
refuse d'agir sur soi-même, puis appelle l'API Better Auth (`auth.api.* ({ headers, body })`,
qui revérifie la permission) — sauf le rôle, écrit directement en base. Retour
`{ ok: true } | { ok: false, error }`, erreurs affichées dans le panneau.

| Action | Effet | Garde-fous |
|---|---|---|
| **Suspendre** | `banUser` avec motif + durée (1 j / 7 j / 30 j / indéfinie) : sessions supprimées, connexion refusée avec le message FR | cible non admin |
| **Réactiver** | `unbanUser` | cible suspendue |
| **Déconnecter partout** | `revokeUserSessions` | cible non admin |
| **Se connecter en tant que** | `impersonateUser` (session 1 h) puis redirection `/dashboard` | cible pro (a une page), non admin, non suspendue |
| **Nommer admin** | `user.role = "admin"` (écrit en base : notre rôle est l'enum `user_role`) | cible non admin, non suspendue |
| **Retirer admin** | `user.role = "pro" \| "client"` selon la page pro | cible admin |

Sur un autre admin, seule « Retirer admin » est proposée ; sur son propre compte, aucune
action. Le serveur applique les mêmes règles que l'interface.

- **Page publique d'un pro suspendu** : hors ligne (404). `getPublicProfile`,
  `getPublicEventType`, `getPublicPack` excluent les pros suspendus, et les actions publiques
  (achat de pack, réservation) les refusent. Seule exception : la page de remerciement
  `/[slug]/merci` (`getPublicProfile(slug, { includeSuspended: true })`) reste accessible, pour
  qu'un client qui a payé juste avant la suspension voie sa confirmation.
- **Bandeau d'impersonation** : le layout du dashboard lit `session.impersonatedBy` et affiche
  « Vous êtes connecté en tant que {nom} ({e-mail}) — Revenir à l'admin ». Le bouton appelle
  `stopImpersonation()` (sans vérification admin : la session courante est celle du pro ;
  Better Auth contrôle le cookie signé `admin_session`) →
  `stopImpersonating` → redirection vers la fiche du pro.
- **Dernière connexion** : colonne `user.last_login_at`, mise à jour par un
  `databaseHooks.session.create.after` Better Auth, sauf si la session porte
  `impersonated_by`. Vide pour les comptes existants jusqu'à leur prochaine connexion.

## 5. Trafic

### Collecte

- **Composant** `src/components/analytics/page-view-tracker.tsx` (client), monté dans le
  layout racine : à chaque changement de `usePathname()`, si `isTrackedPath(path)`, envoie
  `navigator.sendBeacon("/api/track", JSON)` avec `path`, `first` (première vue depuis le
  chargement), et — seulement si `first` — `document.referrer` et `utm_source`.
- **Pages suivies** : tout sauf `/dashboard`, `/onboarding`, `/admin`, `/api`, `/_next`
  (accueil, démo, connexion, inscription, pages pro et parcours de réservation).
- **Route** `src/app/api/track/route.ts` (POST) :
  - valide le corps (zod, tailles bornées) et revérifie `isTrackedPath` ;
  - ignore les robots (`isBot(user-agent)`) et les requêtes sans user-agent ;
  - `visitor_hash` = HMAC-SHA256 de `IP | user-agent`, avec pour clé le **sel aléatoire du
    jour** (jour `ADMIN_TZ`, table `analytics_salt`, supprimé au bout de 2 jours), tronqué à
    32 caractères hexadécimaux — l'IP (`x-forwarded-for`) n'est jamais stockée ;
  - `device` = `mobile | tablet | desktop` ; `country` = header `x-vercel-ip-country`
    (nul en local) ;
  - `entry` = `first` et référent externe ou absent ; `referrer_host` = domaine référent si
    externe ; `source` = `utm_source` normalisé ;
  - `professional_id` : premier segment du chemin résolu en pro par slug (hors segments
    réservés), au moment de la visite → survit à un changement de slug ;
  - répond toujours `204` : un corps illisible est ignoré en silence, les vraies erreurs (base)
    sont journalisées sans être renvoyées.
- **Confidentialité** : ni cookie ni stockage local, pas d'identifiant utilisateur, IP non
  conservée. L'empreinte est un HMAC dont la clé est un **sel aléatoire par jour**
  (`analytics_salt`), créé à la première visite du jour et **supprimé au bout de 2 jours** :
  passé ce délai, personne — pas même quelqu'un qui détiendrait `BETTER_AUTH_SECRET` ou la
  base — ne peut relier une empreinte à une adresse IP, ni la suivre d'un jour à l'autre
  (pendant ces 2 jours, les empreintes restent pseudonymes). Les pages vues sont **conservées
  25 mois** puis supprimées → mesure d'audience anonyme sans bandeau. Conséquence : les
  visiteurs uniques sont comptés **par jour** ; sur une période, « visiteurs » = somme des
  visiteurs quotidiens.
- **Rétention** : `getDailySalt()` (`src/server/analytics-salt.ts`) garde le sel du jour en
  mémoire, par instance ; à chaque défaut de cache (environ une fois par jour et par instance)
  il supprime les sels de plus de 2 jours et les `page_view` de plus de 25 mois, sans jamais
  faire échouer le suivi.

### Page Trafic (`/admin/traffic`)

- `searchParams.range` : `7 | 30 | 90` (défaut 30).
- Totaux : pages vues, visiteurs, pages par visiteur, part mobile.
- Graphe en barres des visiteurs par jour, avec les pages vues du jour dans l'infobulle
  (une seule série, donc pas de légende).
- Top 10 : pages (vues, visiteurs), pages pro (nom d'activité + slug), sources (sur les
  `entry` : `source` sinon `referrer_host` sinon « Direct »), appareils, pays (« Inconnu » si
  nul).

## 6. Modèle de données — migrations `0006` et `0007`

| Table | Changement |
|---|---|
| enum `user_role` | `ADD VALUE 'admin'` |
| `user` | `banned boolean not null default false`, `ban_reason text`, `ban_expires timestamptz`, `last_login_at timestamptz` |
| `session` | `impersonated_by text` |
| `page_view` (nouvelle) | `id text pk`, `created_at timestamptz not null default now()`, `path text not null`, `professional_id text → professional.id on delete set null`, `referrer_host text`, `source text`, `entry boolean not null default false`, `device text not null`, `country text`, `visitor_hash text not null` ; index `(created_at)` et `(professional_id, created_at)` |
| `analytics_salt` (nouvelle, migration `0007`) | `day text pk` (`YYYY-MM-DD` en `ADMIN_TZ`), `salt text not null` (32 octets aléatoires, en hexadécimal), `created_at timestamptz not null default now()` ; une ligne par jour, supprimée au bout de 2 jours (§ 5) |

`page_view` est immuable : pas de `updated_at` ; ses lignes de plus de 25 mois sont supprimées.

**Application** : `pnpm db:generate` produit `0006` (puis `0007` pour `analytics_salt`, ajoutée
après la revue de la branche) ; en local, le SQL est appliqué sur la
branche Neon `development` via un petit script qui passe par le driver HTTP Neon de l'app
(`db:migrate` cassé sous Windows, MCP Neon indisponible dans cette session), en enregistrant
la migration dans `drizzle.__drizzle_migrations`. Preview/prod migrent au déploiement.

## 7. Fichiers

| Fichier | Contenu |
|---|---|
| `src/lib/db/schema.ts` | enum + colonnes + tables `page_view` et `analytics_salt` |
| `src/lib/auth.ts` | hook `last_login_at`, `disabledPaths` |
| `src/lib/auth-admin.ts` (+ test) | plugin `admin` ; `ADMIN_HTTP_ENDPOINTS` = tous ses endpoints HTTP, dérivés du plugin et fermés |
| `src/lib/admin.ts` | `getAdminUser`, `requireAdmin` |
| `src/lib/suspension.ts` (+ test) | `isSuspended`, `userIsSuspended()`, `userNotSuspended()` |
| `src/lib/entry.ts` (+ test) | logique pure du choix d'entrée |
| `src/lib/analytics.ts` (+ test) | `ADMIN_TZ`, `isTrackedPath`, `isBot`, `classifyDevice`, `browserName`, `classifyReferrer`, `normalizeSource`, `proSlugFromPath` |
| `src/lib/visitor-hash.ts` (+ test) | empreinte visiteur : HMAC-SHA256 avec le sel du jour (`node:crypto`) |
| `src/server/analytics-salt.ts` | `getDailySalt` (sel aléatoire du jour, cache par instance) + purge : sels de plus de 2 jours, `page_view` de plus de 25 mois |
| `src/lib/admin-metrics.ts` (+ test) | jours, séries, montants par devise, mode Stripe, dates relatives |
| `src/lib/admin-params.ts` (+ test) | lecture des `searchParams`, libellés, durées de suspension |
| `scripts/apply-migration.ts` | `pnpm db:apply` (migration via le driver HTTP Neon) |
| `src/server/entry.ts` | `resolvePostSignIn`, `chooseEntry`, `forgetEntryChoice` |
| `src/server/admin.ts` | actions utilisateur + `stopImpersonation` |
| `src/server/admin-queries.ts` | lectures admin |
| `src/app/admin/**` | layout + 5 pages + fiche utilisateur |
| `src/components/admin/**` | barre latérale, cartes, graphe SVG, tableau, panneau d'actions |
| `src/components/auth/entry-chooser.tsx` | modal |
| `src/components/dashboard/impersonation-banner.tsx` | bandeau |
| `src/components/analytics/page-view-tracker.tsx` | beacon |
| `src/app/api/track/route.ts` | réception des pages vues |
| `scripts/grant-admin.ts` | `pnpm admin:grant` |
| Modifiés | `auth-form.tsx`, `sign-in/page.tsx`, `dashboard/layout.tsx`, `sidebar.tsx`, `onboarding/page.tsx`, `app/layout.tsx`, `server/pro.ts`, `server/queries.ts`, `server/public.ts`, `package.json` |

## 8. Erreurs et cas limites

- Admin rétrogradé ou suspendu : perd l'accès à `/admin` à la requête suivante (rôle relu en
  base) ; ses sessions restent valides côté back-office pro jusqu'à 5 min (cache).
- Admin en impersonation : `/admin` renvoie 404 (la session est celle du pro) ; le bandeau
  permet de revenir. L'impersonation expire seule au bout d'1 h.
- Admin qui choisit « Dashboard Client » sans page pro : onboarding, avec le lien retour.
- Cookie `skedul_entry` invalide ou absent : la modal s'affiche.
- Suspension datée expirée : traitée comme levée partout (statut, page publique) ; le plugin
  nettoie la ligne à la prochaine connexion.
- `/api/track` en erreur ou corps invalide : `204`, rien n'est enregistré, aucune erreur
  visible.
- Plusieurs devises : le volume encaissé est listé par devise, jamais additionné.

## 9. Tests et vérification

- **Unitaires** (`pnpm test`, `node:test` via `tsx`) : `entry.test.ts` (matrice
  `resolveEntry`, cookie invalide), `analytics.test.ts` (chemins suivis, robots, appareils,
  référent interne/externe, slug depuis le chemin, remplissage des jours vides),
  `visitor-hash.test.ts` (empreinte stable pour un même sel, IP et user-agent ; différente avec
  un autre sel — la rotation quotidienne —, une autre IP ou un autre user-agent).
- **Statique** : `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- **Navigateur** (dev, base `development`) :
  - non-admin : connexion → `/dashboard` directement, `/admin` → 404 ;
  - admin : modal → chaque choix ; « Se souvenir » → reconnexion sans modal ; « Oublier mon
    choix » → modal de retour ;
  - pages admin avec les données du seed ;
  - suspension d'un pro de test → connexion refusée + page publique 404 → réactivation ;
  - « se connecter en tant que » → bandeau → retour à l'admin ;
  - navigation publique → lignes dans `page_view` ; pages `/dashboard` non suivies.

## Suite

Projet 2 — **facturation SaaS des pros** : plans, Stripe Billing (Checkout + portail client +
webhooks), limites par plan, puis remplissage de `/admin/subscriptions`.
