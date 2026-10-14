# Tickets & événements — Design

> Les « prestations » deviennent des **types de ticket** vendus **à l'unité ou en carnets**. Le
> client **détient** ses tickets dans un portefeuille. Le pro place sur son **planning** des
> **événements** (ponctuels ou récurrents) et y **lie** les types de ticket acceptés. Le RDV libre
> « à la Calendly » reste disponible pour les types qui le demandent. Côté pro, une **fiche
> client** permet de pointer, offrir, convertir et clore des tickets, et des **alertes** signalent
> les tickets devenus inutilisables.
>
> Date : 2026-10-12. Branche : `feat/tickets-events` (worktree `.claude/worktrees/tickets`), créée
> depuis `main` = `ff24dfd` (PR #10 incluse). Statut : **approuvé** par le propriétaire le 2026-10-12 (design validé section par section, v2
> après relecture adversariale à 4 angles contre-vérifiés).

## 1. Problème

Aujourd'hui une « prestation » (`event_type`) joue trois rôles à la fois : produit vendu, modèle
de créneau calculé depuis les disponibilités, et source de capacité. Il n'existe **aucun objet
« événement »**. Une séance de groupe (`class_session`) n'est créée qu'à la première
réservation. Un cours collectif sans inscrit est donc invisible dans le planning et ne peut être
ni annulé ni modifié.

Les packs sont des compteurs de crédits liés au plus à une prestation. Ils dérivent (restitution
non plafonnée) et ne gardent aucun historique. Le client n'a pas de compte : quiconque connaît son
email peut voir et dépenser ses crédits.

Plusieurs défauts doivent aussi disparaître avec la refonte :
- fulfillment des paiements en « vérifier puis écrire » ;
- places bloquées à vie par un paiement abandonné ;
- aucun email pour les réservations par crédit, gratuites ou manuelles ;
- `moveAttendee` qui ignore l'éligibilité ;
- `cancelSession` qui laisse la séance réservable ;
- bug d'heure d'été dans la navigation du planning ;
- HTML non échappé dans les emails.

Les pros visés (cours collectifs type altinha, yoga, coaching) raisonnent en **créneaux fixes
récurrents** (« lundi 11h–12h, cours débutants ») et en **carnets de tickets** utilisables sur
certains cours.

## 2. Décisions validées (Q&R du 2026-10-12)

1. **Type de ticket** : c'est ce que le pro lie aux événements. Il est vendu par une ou plusieurs
   **offres** (unité ou carnet de N, prix, validité optionnelle). Un carnet contient N tickets
   **d'un seul type**. Pas de carnet mixte.
2. **Usages d'un ticket détenu** :
   - (a) une séance d'un événement qui accepte son type ;
   - (b) un RDV libre de son type ;
   - (c) un **pointage manuel** par le pro (consommation sur place).

   Un ticket dont le type n'est lié à rien **attend** dans le portefeuille.
3. **Événements** :
   - ponctuels, ou récurrents avec une récurrence riche : tous les N jours ; toutes les N
     semaines sur les jours choisis ; tous les N mois au jour J ou au n-ième jour de semaine ;
     fin jamais / à une date / après N séances ;
   - modification de « cette séance » ou de « cette séance et les suivantes ». Les inscrits restent
     inscrits et sont prévenus. Une séance annulée rend les tickets et prévient les clients ;
   - capacité par événement, modifiable par séance ;
   - les événements peuvent se chevaucher.
4. **Mode de réservation explicite** par événement : *Sur tickets* (types acceptés,
   plusieurs-à-plusieurs), *Inscription libre* (email, sans paiement, dans la limite des places)
   ou *Sans réservation en ligne* (affiché « Sur place »). Une option **Privé** masque l'événement
   de la page publique et le pro y inscrit à la main. Une liste vide ne veut **jamais** dire
   « tous les tickets ».
5. **Achat + réservation en une étape** :
   - sans ticket valide, le client choisit une offre d'un type accepté et paie ;
   - 1 ticket est utilisé sur la séance et le reste du carnet va dans le portefeuille ;
   - la place est bloquée pendant le paiement, avec une expiration.
6. **Identité** :
   - pas de compte requis pour réserver ou acheter : le client donne son email et reçoit une
     confirmation à chaque fois ;
   - pour **utiliser des tickets déjà détenus**, il prouve son email : code à 6 chiffres, Google
     ou mot de passe (sur un email confirmé, § 12) ;
   - un client déjà connecté est **reconnu automatiquement** ;
   - chaque email contient un **lien personnel** ;
   - le pro peut toujours utiliser ou déplacer les tickets d'un client, dans les règles
     d'éligibilité. Sinon il convertit d'abord ;
   - un compte client n'est jamais envoyé vers l'onboarding pro.
7. **Annulation** :
   - le client annule lui-même jusqu'à **X h avant** (24 h par défaut) et le ticket revient ;
     passé ce délai, seul le pro peut annuler ;
   - **exception** : si le pro a changé l'horaire de la séance ou a déplacé le client après son
     inscription, le client peut annuler lui-même jusqu'au début ;
   - le pro annule toujours (inscription ou séance), les tickets reviennent et un email part ;
   - **jamais de remboursement en argent automatique**.
8. **Expiration** : par offre, aucune par défaut. Un ticket doit être valide **à la date de la
   séance**. Le portefeuille et les emails affichent l'expiration.
9. **RDV libre** :
   - on garde la page « Disponibilités », et un type de ticket peut être « réservable en RDV
     libre, durée X » ;
   - les créneaux sont calculés comme aujourd'hui, et seuls les RDV réservés apparaissent dans le
     planning ;
   - les séances d'événements **bloquent** les créneaux de RDV qui les chevauchent.
10. **Page publique** : un bloc **Planning** (séances + cartes RDV libre), un bloc **Boutique**
    (offres par type) et l'accès au portefeuille, avec détection automatique du client connecté.
    Le client peut aussi se connecter pour voir ses tickets.
11. **Fiche client et alertes** :
    - actions Pointer, Offrir, Convertir (garde le statut payé et l'expiration), Clore avec
      motif (reste visible barré), Retirer (tickets offerts uniquement) ;
    - un ticket payé ne peut jamais simplement diminuer ;
    - alertes dans la liste des clients : 🔴 tickets d'un type archivé, 🟠 type lié à aucun
      événement à venir et pas en RDV libre ;
    - « supprimer » un type détenu = l'archiver.
12. **Données** : tout le domaine en production est de la donnée de test. **Table rase** du
    domaine, sans reprise. On garde les comptes, les profils pro, le centre d'aide, les
    statistiques et le support.
13. **Réglages de réservation** du pro :
    - « réservable jusqu'à X jours à l'avance » : défaut 60, de 1 à 365 ;
    - « au plus tard X avant le début » : défaut 1 h, de 0 à 7 j ;
    - « annulation par le client jusqu'à X h avant » : défaut 24, de 0 à 720 ;
    - **les trois** se surchargent par événement et par type RDV libre.
14. **Paiement en prod** : Stripe activé, clés de test d'abord. Le paiement simulé est coupé en
    production dès que Stripe y est configuré.

**Choix par défaut validés avec le design** :
- 1 inscription = 1 place = 1 ticket au plus ;
- le ticket consommé est celui qui expire le plus tôt, puis le plus ancien ;
- l'usage suit les liens **actuels** du type ;
- questions d'inscription sur l'événement, ou sur le type pour le RDV libre ;
- une indisponibilité posée sur des séances avec inscrits **propose** de les annuler ;
- un email pour chaque inscription, quelle que soit sa couverture ; pas de rappels ;
- Google Agenda ne reçoit que les séances avec au moins un inscrit, plus chaque RDV ;
- pas d'offre à 0 € : les tickets gratuits passent par « Offrir », les événements gratuits par
  l'inscription libre.

**RDV libre gratuit** (confirmé par le propriétaire le 2026-10-12) : sans ticket ni paiement
(ex. « Appel découverte 15 min »), comme aujourd'hui avec une prestation à 0 €. C'est l'option
« Gratuit » sur un type RDV libre : § 6.4 `rdv_free`, E4.

## 3. Hors périmètre (v1)

Le point d'extension est indiqué entre parenthèses.
- Liste d'attente (statut de réservation ou table `waitlist_entry` sur `occurrence`).
- Abonnements et passes illimités (table `pass` + couverture `pass`).
- Stripe Connect et remboursements Stripe (colonne de frais + statut `refunded` sur
  `ticket_purchase`).
- Réservation de plusieurs places, ticket valant plusieurs unités, plusieurs coachs (`staff`).
- Rappels ; QR code ou check-in ; pénalités d'annulation tardive ; absences ; codes promo ;
  export CSV.
- Titre, mode ou tickets différents **par séance**. Ces champs se changent pour tout l'événement ;
  seul le **lieu** a une surcharge par séance.
- Import ou export RRULE ; envoi des séances vides vers Google.
- Choix manuel du ticket par le client ; validité à partir de la première utilisation ;
  prolongation d'expiration (le pro offre un remplacement) ; transfert entre clients.
- Lien magique de connexion ; pool WebSocket transactionnel ; fusion de comptes clients.
- Changement de fuseau horaire d'un pro qui a des séances planifiées (verrouillé, § 7).

## 4. Contraintes structurantes

- **Next.js 16** : `params`/`searchParams` asynchrones. Lire `node_modules/next/dist/docs/` avant
  d'écrire du code Next. Après une Server Action, faire `router.push` seul, jamais avec un
  `refresh` qui suit.
- **Neon HTTP sans transaction interactive.** `db.batch([...])` exécute ses requêtes dans **une**
  transaction non interactive (READ COMMITTED), en tout ou rien sur erreur. Une requête du lot ne
  peut pas lire en JS le résultat d'une précédente : les ids sont générés en JS (nanoid). Toute
  écriture multi-lignes passe par `atomic()` (§ 10).
- **Better Auth 1.6.19** : plugin `emailOTP` (installé, à activer), `admin` (endpoints HTTP
  désactivés via `disabledPaths`). Le cache cookie de session dure 5 min, donc une autorisation
  sensible relit la session sans cache. Les hooks `*.after` d'une requête HTTP s'exécutent
  **après** la fin de l'endpoint (`queueAfterTransactionHook`).
- **Suppression de compte** : `deleteUser` = un seul `DELETE FROM "user"`. Tout le domaine
  cascade depuis `professional` (§ 6.3).
- **Temps** :
  - instants via `instantFromWallClock` (`@date-fns/tz`) ;
  - on itère **par date locale**, jamais en ajoutant `n × 86 400 000` ms ;
  - le moteur reçoit son horloge en paramètre (`now`, § 10).
- **Argent** : centimes entiers + devise du pro, via `formatMoney(cents, currency)`.
- **Bases Neon de travail.** Aucune migration 0010+ n'est appliquée sur `development`, `preview`
  ou `main` avant la mise en ligne (P6).
  - `tickets-dev`, enfant de `development` : le `.env.local` du worktree pointe dessus.
  - `tickets-test`, enfant de `tickets-dev` après migration : `.env.test` pointe dessus.
  - Le spike tourne sur une branche jetable `spike-batch`, supprimée ensuite.
- **Migrations** : procédure en § 15.2. Les objets SQL manuels (§ 6.5) sont invisibles pour
  drizzle-kit, donc `db:push` est retiré de `package.json`.
- **Routes** : toute nouvelle route de premier niveau rejoint `RESERVED_SEGMENTS`
  (`src/lib/analytics.ts`).
- **UI** :
  - passer par le skill `design-taste-frontend` avant d'écrire l'UI ;
  - primitives de `src/components/ui/`, thème de `globals.css`, `lucide-react` ;
  - garder sur une seule ligne tout texte JSX qui contient une entité HTML (bug d'espace de
    SWC).
- **Worktree** : `node_modules` en jonction vers la copie principale. Appeler
  `./node_modules/.bin/*` directement, jamais `pnpm <script>`, dans le worktree.

## 5. Vocabulaire

Les libellés, les valeurs d'enum, les bornes et les messages d'erreur sont centralisés dans un
nouveau `src/lib/tickets.ts`. Il sert de source aux `pgEnum` et aux schémas zod, sur le modèle de
`src/lib/support.ts`.

| UI (FR) | Table | Sens |
|---|---|---|
| Type de ticket | `ticket_type` | Ce qu'un événement accepte ; peut être « réservable en RDV libre » |
| Offre (« À l'unité », « Carnet de 10 ») | `ticket_offer` | N tickets d'un type, prix, validité optionnelle |
| Achat | `ticket_purchase` | Un paiement ; **seule** ligne portant de l'argent |
| Ticket / Portefeuille | `ticket` | Une unité détenue par un client |
| Historique | `ticket_movement` | Registre des mouvements (ajout seulement) |
| Événement | `event` | Une série : récurrence, capacité, mode, types acceptés |
| Séance | `occurrence` (avec `event_id`) | Une date d'un événement, porte le compteur de places |
| RDV | `occurrence` (sans `event_id`) | Un rendez-vous libre réservé (1 place) |
| Inscription | `booking` | 1 client = 1 place = au plus 1 ticket, sur une séance ou un RDV |
| Client | `customer` | Identité par pro, clé = email |

## 6. Modèle de données

### 6.1 Conservé, modifié, supprimé

- **Conservé tel quel** : `user`, `session`, `account`, `verification`, `time_off`, `page_view`,
  `analytics_salt`, `help_*`, `support_*`.
- **`professional`**, colonnes ajoutées :
  - `booking_horizon_days int NOT NULL DEFAULT 60`, CHECK 1..365 ;
  - `min_notice_minutes int NOT NULL DEFAULT 60`, CHECK 0..10080 ;
  - `cancel_deadline_hours int NOT NULL DEFAULT 24`, CHECK 0..720.
- **Supprimé** :
  - tables `event_type`, `class_session`, `pack`, `pack_purchase`, `customer`, `booking`,
    `question`, `booking_answer`, `availability_rule` ;
  - enums `booking_status`, `payment_type`, `purchase_status`. On les recrée plutôt que de faire
    `ALTER TYPE … ADD VALUE`, inutilisable dans la transaction de `db:apply` ;
  - `scripts/backfill-sessions.ts`.

### 6.2 Enums

| Enum | Valeurs |
|---|---|
| `booking_mode` | `tickets`, `free`, `none` |
| `recurrence_freq` | `once`, `daily`, `weekly`, `monthly` |
| `monthly_by` | `day_of_month`, `weekday` |
| `recurrence_end` | `never`, `until`, `count` |
| `validity_unit` | `day`, `month` |
| `occurrence_status` | `scheduled`, `cancelled` |
| `booking_status` | `pending`, `confirmed`, `cancelled`, `expired` |
| `booking_coverage` | `ticket`, `free`, `guest` |
| `actor` | `client`, `pro`, `system` |
| `purchase_status` | `pending`, `paid`, `expired` |
| `ticket_status` | `available`, `booked`, `used`, `expired`, `closed` |
| `ticket_close_reason` | `rembourse`, `compense`, `retire`, `autre` |
| `movement_kind` | `purchase`, `offer`, `spend`, `return`, `pointage`, `unpoint`, `convert`, `expire`, `close` |
| `question_type`, `user_role` | inchangés |

### 6.3 Règles de clés étrangères

- **R1** : aucun `RESTRICT`.
- **R2** : chaque table du domaine a `professional_id → professional ON DELETE CASCADE`.
- **R3** : les références internes au domaine sont `NO ACTION` (le défaut de drizzle). La
  contrainte est vérifiée en fin de requête, après les cascades : elle bloque une suppression
  accidentelle d'une ligne qui a un historique, mais laisse passer `deleteUser`. Exceptions :
  - les compositions parent → enfant **cascadent** : offre ← type ; lien ← événement ou type ;
    question ← événement ou type ; réponse ← inscription ; séance ← événement ;
  - `booking_answer.question_id → question` est **SET NULL** : la réponse garde l'instantané
    `question_label`.

  Comme `booking → occurrence` est NO ACTION, une séance qui a une inscription, même annulée,
  n'est jamais supprimée physiquement.
- **R4** : les références vers `user` sont `SET NULL` (`customer.user_id`,
  `ticket_movement.actor_user_id`). Aucun CHECK ne dépend d'une colonne qui peut passer à NULL.
- **R5** : on archive (`archived_at`), on ne supprime pas, ce qui a un historique : types,
  offres, événements.
- **R6** : un test DB exécute `deleteUser` sur un pro entièrement peuplé (T11).

### 6.4 Tables

Sauf mention contraire, chaque table a `id text pk` (nanoid), `created_at`, `updated_at` si ses
lignes changent, et `professional_id → professional CASCADE`. Exceptions :
- `event_ticket_type` a une PK composite ;
- `throttle` a pour PK `key` et pas de `professional_id` ;
- `rate_limit` n'a pas de `professional_id`.

Toutes les CHECK ont un **nom explicite**, utilisé par `mapDbError` (§ 10). Une CHECK
conditionnelle écrit ses `IS NOT NULL`, car une CHECK qui vaut NULL passe.

**`ticket_type`**
- Colonnes : `name`, `description`, `color`, `position`, `archived_at` ; pour le RDV libre :
  - `rdv_enabled bool default false`, `rdv_free bool default false` ;
  - `rdv_duration_min`, `rdv_buffer_before_min default 0`, `rdv_buffer_after_min default 0` ;
  - surcharges `rdv_booking_horizon_days NULL`, `rdv_min_notice_minutes NULL`,
    `rdv_cancel_deadline_hours NULL`.
- CHECK `ticket_type_rdv_chk` : `NOT rdv_enabled OR (rdv_duration_min IS NOT NULL AND
  rdv_duration_min BETWEEN 5 AND 480 AND rdv_duration_min % 5 = 0)`.
- CHECK `ticket_type_rdv_free_chk` : `NOT rdv_free OR rdv_enabled`.
- CHECK : marges 0..240 ; surcharges dans les bornes de `professional`.
- Index : `(professional_id)`.

**`ticket_offer`**
- Colonnes : `ticket_type_id → ticket_type CASCADE`, `label NULL` (sinon généré : « À l'unité »,
  « Carnet de N »), `quantity`, `price_cents`, `validity_count NULL`, `validity_unit NULL`,
  `is_active`, `position`, `archived_at`.
- CHECK : `quantity` 1..100 ; `ticket_offer_price_chk` `price_cents > 0` ; `(validity_count IS
  NULL) = (validity_unit IS NULL)` ; `validity_count` 1..1000.

**`availability_rule`** (recréée)
- Colonnes : `ticket_type_id → ticket_type CASCADE NULL` (NULL = horaires globaux),
  `day_of_week`, `start_minute`, `end_minute`.
- CHECK : `day_of_week` 0..6 (0 = dimanche) ; `0 ≤ start_minute < end_minute ≤ 1440`.
- Les règles d'un type **remplacent** les règles globales pour ce type, comme aujourd'hui.

**`event`**
- Colonnes : `title`, `description`, `location`, `color`, `booking_mode`, `is_private`,
  `capacity`, `duration_min`, colonnes de récurrence (§ 8), surcharges `booking_horizon_days
  NULL`, `min_notice_minutes NULL`, `cancel_deadline_hours NULL`, `generated_until date`,
  `series_root_id text NULL` (filiation, sans FK ; égal à son propre `id` pour le premier
  segment), `version int default 1`, `last_action_id text NULL`, `archived_at`.
- CHECK : capacité 1..500 ; durée 5..720 et multiple de 5 ; CHECK de récurrence (§ 8) ;
  surcharges dans les bornes de `professional`.

**`event_ticket_type`**
- Colonnes : `event_id CASCADE`, `ticket_type_id CASCADE`.
- PK `(event_id, ticket_type_id)` ; index `ticket_type_id`.

**`question`**
- Colonnes : `event_id CASCADE NULL`, `ticket_type_id CASCADE NULL` (questions de RDV),
  `label`, `type`, `options[]`, `required`, `position`.
- CHECK : `num_nonnulls(event_id, ticket_type_id) = 1`.

**`occurrence`**
- Colonnes :
  - `event_id → event CASCADE NULL`, `ticket_type_id → ticket_type NULL` (RDV) ;
  - `series_date date NULL` ;
  - `starts_at`, `ends_at`, `block_start`, `block_end` (RDV : élargi par les marges ;
    événement : égal à début et fin) ;
  - `capacity`, `seats_taken int default 0`, `status`, `location_override text NULL` ;
  - `time_detached bool default false`, `capacity_override bool default false` ;
  - `changed_at NULL`, `cancelled_at NULL`, `google_event_id NULL`.
- CHECK : `num_nonnulls(event_id, ticket_type_id) = 1` ; `(event_id IS NULL) = (series_date IS
  NULL)`.
- CHECK de places : `occurrence_seats_chk`, `seats_taken BETWEEN 0 AND capacity`.
- CHECK : capacité 1..500 ; `occurrence_rdv_capacity_chk` `event_id IS NOT NULL OR capacity =
  1`.
- CHECK : `ends_at > starts_at` ; `block_start ≤ starts_at` ; `block_end ≥ ends_at` ;
  `(status = 'cancelled') = (cancelled_at IS NOT NULL)`.
- UNIQUE `(event_id, series_date)` ; index `(professional_id, starts_at)` ; EXCLUDE
  `occurrence_rdv_excl` (§ 6.5).

**`customer`**
- Colonnes : `user_id → user SET NULL`, `email`, `name`, `phone`, `link_version int default 1`.
- CHECK : `email = lower(email) AND email <> ''`.
- UNIQUE `(professional_id, email)` ; index `user_id` ; index `email`.

**`ticket_purchase`**
- Colonnes :
  - `customer_id`, `offer_id`, `ticket_type_id` ;
  - instantané : `label`, `quantity`, `amount_cents`, `currency`, `validity_count`,
    `validity_unit` ;
  - `status`, `livemode bool NOT NULL DEFAULT false`, `checkout_session_id`, `checkout_url`,
    `checkout_expires_at NOT NULL`, `processing_at NULL`, `payment_intent_id`, `paid_at`,
    `fulfilled_action_id`.
- CHECK : `quantity` 1..100 ; `amount_cents > 0` ; `(status = 'paid') = (paid_at IS NOT NULL)`.
- UNIQUE `checkout_session_id`.
- Index : `(professional_id, status, paid_at)`, `(customer_id)`, `(status, checkout_expires_at)`.

**`booking`**
- Colonnes : `occurrence_id NOT NULL`, `customer_id NOT NULL`, `status`, `coverage`, `purchase_id
  NULL` (achat + réservation), `created_by actor`, `hold_expires_at NULL`, `confirmed_at`,
  `moved_at NULL`, `ended_at`, `ended_by actor`, `ended_action_id`, `cancel_reason`,
  `customer_notes`.
- CHECK :
  - `status <> 'pending' OR (hold_expires_at IS NOT NULL AND purchase_id IS NOT NULL)` ;
  - `coverage <> 'free' OR purchase_id IS NULL` ;
  - `(status IN ('cancelled','expired')) = (ended_at IS NOT NULL)`.
- UNIQUE partiel `booking_active_uq (occurrence_id, customer_id) WHERE status IN
  ('pending','confirmed')` ; UNIQUE `purchase_id`.
- Index : `(occurrence_id, status)`, `(customer_id)`, `(ended_action_id)`, partiel
  `(hold_expires_at) WHERE status = 'pending'`.

**`booking_answer`**
- Même forme qu'aujourd'hui : `booking CASCADE`, `question SET NULL`, instantané
  `question_label`.
- UNIQUE `(booking_id, question_id)`.

**`ticket`**
- Colonnes : `customer_id`, `ticket_type_id`, `purchase_id NULL` (NULL = offert), `status`,
  `booking_id NULL`, `expires_at NULL`, `closed_reason NULL`, `closed_note`, `status_changed_at`.
- CHECK : `(status = 'booked') = (booking_id IS NOT NULL)` ; UNIQUE `booking_id`.
- CHECK : `(status = 'closed') = (closed_reason IS NOT NULL)`.
- CHECK `ticket_retire_paid_chk` : `closed_reason IS DISTINCT FROM 'retire' OR purchase_id IS
  NULL`. Un ticket payé ne peut pas être « retiré ».
- Index : `(customer_id, status, ticket_type_id)` ; partiel `(expires_at) WHERE status =
  'available'`.

**`ticket_movement`**
- Colonnes : `seq bigint GENERATED ALWAYS AS IDENTITY`, `customer_id`, `ticket_id`, `action_id`,
  `kind`, `from_status NULL`, `to_status`, `ticket_type_id`, `from_ticket_type_id NULL`,
  `booking_id NULL`, `purchase_id NULL`, `actor`, `actor_user_id → user SET NULL`, `reason NULL`.
- UNIQUE `(action_id, ticket_id)` ; index `(customer_id, seq)` et `(action_id)`.
- L'ordre du registre est `seq`, jamais `created_at` : celui-ci vaut le début de transaction.
- **Pas de trigger** : un trigger « ajout seulement » entrerait en conflit avec les actions de FK.
  Le caractère « ajout seulement » est une convention, vérifiée par l'invariant I4.

**`throttle`** (limites applicatives, § 12)
- Colonnes : `key text pk`, `window_start timestamptz`, `hits int`.

**`rate_limit`** (modèle Better Auth `rateLimit`)
- Colonnes : `id text pk`, `key text NOT NULL UNIQUE`, `count int NOT NULL`, `last_request
  bigint NOT NULL`. Les clés TS sont `key`, `count`, `lastRequest`.
- Déclarée dans `schema.ts` et ajoutée à la map `schema` du `drizzleAdapter`.

### 6.5 Objets SQL manuels (migration 0012)

Le fichier est créé par `drizzle-kit generate --custom --name=tickets_manual` pour être journalisé.
Les trois instructions sont séparées par `--> statement-breakpoint`, puisque `db:apply` envoie
chaque morceau comme une seule requête.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE occurrence ADD CONSTRAINT occurrence_rdv_excl
  EXCLUDE USING gist (professional_id WITH =, tstzrange(block_start, block_end) WITH &&)
  WHERE (event_id IS NULL AND status = 'scheduled');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION skedul_assert(ok boolean, code text) RETURNS boolean LANGUAGE plpgsql AS
$$BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'skedul:' || code; END IF; RETURN true; END$$;
```

Le test `IS NOT TRUE` est voulu : une sous-requête scalaire sur une ligne disparue renvoie NULL,
et ce cas doit aussi lever une erreur.

## 7. Séances

**Les séances d'événement sont matérialisées.** Une même ligne porte :
- le compteur de places et l'état annulé ;
- la capacité, le lieu surchargé et `google_event_id` ;
- les inscriptions (`booking.occurrence_id`) ;
- l'URL publique `/[slug]/seance/[id]` et les liens des emails.

**Génération.**
- Enregistrer un événement insère ses séances sur `[start_date, min(fin, aujourd'hui +
  MATERIALIZE_DAYS)]` dans le même lot, avec `ON CONFLICT (event_id, series_date) DO NOTHING`.
  L'insertion est plafonnée à 450 lignes par appel.
- `MATERIALIZE_DAYS = 400`, une constante. Un test vérifie `365 (horizon max) + 30 <
  MATERIALIZE_DAYS`.
- `ensureHorizon(proId, now)` ramène `generated_until` à aujourd'hui + 400 j, en un lot par pro :
  1. verrouiller les événements concernés (`FOR NO KEY UPDATE`, premier rang de l'ordre des verrous) ;
  2. `INSERT … SELECT … FROM unnest($dates) WHERE EXISTS (SELECT 1 FROM event WHERE id = $e AND
     version = $v AND archived_at IS NULL AND (until_date IS NULL OR date ≤ until_date))` ;
  3. mettre à jour `generated_until` sous la même condition de version.

  Un événement dont la version a changé entre la lecture et l'écriture est sauté, puis régénéré
  par l'appel suivant. Une coupure ne peut donc jamais être doublée par des séances fantômes.
- Appelants de `ensureHorizon` : la tâche de nuit, et `after()` au rendu du planning pro et de la
  page publique. Ces deux derniers lisent d'abord `min(generated_until)` des séries actives et
  n'appellent `ensureHorizon` que si ce minimum est sous aujourd'hui + 393 j.

**Identité.**
- `series_date` est la date locale produite par la règle (équivalent iCal RECURRENCE-ID).
- Chaque règle supportée produit au plus une séance par date locale. Déplacer ou annuler une
  ligne ne la recrée donc jamais.

**Exceptions** : ce sont des états de la ligne. Le planning montre les annulées barrées.

| Changement | Effet sur la ligne |
|---|---|
| Déplacer (date, heure, durée) | nouveaux `starts_at`/`ends_at`, `time_detached = true`, `changed_at = now` |
| Capacité | `capacity = GREATEST(n, seats_taken)`, `capacity_override = true` |
| Lieu | `location_override = …` (lieu effectif = `COALESCE(location_override, event.location)`) |
| Annuler | `status = 'cancelled'`, `seats_taken = 0` |
| Rétablir (séance d'événement future) | retour à `scheduled`, liste des inscrits vide (E6b) |

**Horizons de réservation.**
- **Horizon, préavis et délai d'annulation effectifs** : la surcharge de l'événement (ou du type
  RDV), sinon le réglage du pro. Ils sont calculés par `booking-window.ts`.
- **Réservable en ligne** quand `now + préavis ≤ starts_at` **et** que la date locale de la
  séance ≤ aujourd'hui (local) + horizon.
- La page publique n'affiche que les séances dans l'horizon. Celles qui sont dans le préavis
  apparaissent « Réservations fermées ».
- Le chemin pro ignore préavis et horizon.

**Indisponibilités** : elles n'ajoutent aucun état aux séances.
- Les lectures masquent les séances d'événement **vides** qui chevauchent un `time_off`.
- Chaque prise de place **en ligne** vérifie qu'aucun `time_off` ne chevauche. Le chemin pro
  passe outre.
- Les séances avec inscrits sous une nouvelle indisponibilité suivent le choix du pro (E6c).
- Supprimer l'indisponibilité fait réapparaître les séances masquées.

**RDV libre.**
- Une réservation insère une séance avec `event_id NULL`, `ticket_type_id` renseigné, capacité 1
  et `seats_taken` 1.
- Une annulation ou une place expirée la passe en `cancelled`, ce qui la sort de l'EXCLUDE.
- Les créneaux sont calculés **par fenêtre demandée** (semaine affichée), dans la limite de
  l'horizon.
- Un RDV n'occupe un créneau que s'il a une inscription `confirmed`, ou `pending` avec
  `hold_expires_at > now`.

**Lecture d'une semaine.**
- Bornes : `instantFromWallClock(lundi local, 0)` → `instantFromWallClock(lundi local + 7 jours,
  0)`, avec un pas par date locale. Ceci corrige `planning/page.tsx` et `planning.ts`.
- **Requête pro** :
  - `occurrence LEFT JOIN event LEFT JOIN ticket_type WHERE professional_id = $p AND starts_at <
    $fin AND ends_at > $début` ;
  - les RDV annulés sont exclus ;
  - inscrits, réponses et couverture sont chargés par `inArray`, avec les `time_off` qui
    chevauchent ;
  - un `layoutLanes` pur place côte à côte les séances qui se chevauchent.
- **Requête publique** : la même, filtrée sur :
  - les séances futures, d'un événement non privé et non archivé ;
  - `scheduled`, ou `cancelled` (affichée « Annulée ») ;
  - dans l'horizon ;
  - hors séances vides sous indisponibilité.
- **Places affichées** = `capacity − seats_taken + (places en attente dont hold_expires_at <
  now)`.
- Un rendu ne modifie jamais ni places ni inscriptions. Seul `ensureHorizon` peut écrire, via
  `after()`.

**Heure d'été.**
- `starts_at = instantFromWallClock(series_date, start_minute, tz)` et `ends_at = starts_at +
  durée`, en millisecondes écoulées.
- Une heure inexistante au passage à l'heure d'été est décalée vers l'avant (comportement de
  `TZDate`, règle RFC 5545) : 02:30 le 2026-03-29 devient 03:30.
- Une heure répétée au passage à l'heure d'hiver prend le premier instant : 2026-10-25 02:30
  devient 00:30Z.
- L'aperçu de l'éditeur signale les deux cas.

**Fuseau du pro.** `updateProfile` refuse de changer `timezone` tant qu'il existe un événement non
archivé ou une séance future `scheduled` : « Fuseau verrouillé : vous avez des séances
planifiées ». Un test le couvre.

**Affichage des tickets passés.** Un ticket `booked` dont la séance est passée s'affiche « Utilisé
le JJ/MM ». C'est dérivé à l'affichage, sans changement d'état.

## 8. Récurrence

**Colonnes sur `event`.**

| Colonne | Valeurs / CHECK |
|---|---|
| `start_date date`, `start_minute` | 0..1439 |
| `freq` | `once`, `daily`, `weekly`, `monthly` |
| `interval smallint` | daily 1..31, weekly 1..52, monthly 1..12 ; `once` ⇒ 1 |
| `weekdays smallint[]` | weekly uniquement : `weekdays IS NOT NULL AND cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ '{0,1,2,3,4,5,6}'` (0 = dimanche) ; distinction et tri imposés par zod |
| `monthly_by` | `day_of_month` (jour de `start_date`) ou `weekday` (jour de semaine de `start_date`) |
| `month_week smallint NULL` | 1..4 ou −1 (« dernier ») ; requis (`IS NOT NULL`) si `monthly_by = weekday` ; l'éditeur le déduit de `start_date` par défaut |
| `end_mode` | `never` ; `until` (`until_date IS NOT NULL`, incluse, ≤ `start_date` + 5 ans) ; `count` (`occurrence_count IS NOT NULL`, 1..730) |

- Une CHECK par fréquence et par mode de fin, chacune avec ses `IS NOT NULL`.
- `once` ⇒ `interval = 1`, `end_mode = 'count'`, `occurrence_count = 1`, et `weekdays`,
  `monthly_by`, `month_week`, `until_date` NULL.

**Expandeur.** `src/lib/recurrence.ts`, pur, en arithmétique de dates civiles entières (nouveau
`src/lib/civil-date.ts`) : `expand(rule, tz, fromDate, toDate) → {seriesDate, startsAt,
endsAt}[]`.

| Fréquence | Règle |
|---|---|
| daily | garder les jours `start_date + k × interval` |
| weekly | index de semaine (base lundi) depuis la semaine de `start_date` ; garder `weekIdx % interval == 0` et un jour de l'ensemble |
| monthly, par jour | les mois sans ce jour sont sautés (RFC 5545) ; l'UI prévient « certains mois n'ont pas de 31 » |
| monthly, n-ième jour de semaine | calculé par mois ; −1 = le dernier |

- **Toute date antérieure à `start_date` est écartée.** `start_date` n'est pas forcément une
  séance (ex. un mercredi avec les jours lundi et jeudi).
- **`never` / `until`** : l'expandeur saute arithmétiquement à la première période alignée qui
  contient `fromDate`, puis avance **par période** (jour, semaine ou mois), jamais en parcourant
  depuis `start_date`.
- **`count`** : seul ce mode parcourt depuis `start_date`, par période, et s'arrête à
  `occurrence_count` dates produites (≤ 730). Les dates annulées comptent.
- `until` est inclus.
- **Plafond** : 1 000 dates **produites** dans `[fromDate, toDate]`, plus un plafond d'itérations
  de `(toDate − fromDate en jours) + 31`. Cela empêche aussi la boucle infinie actuelle sur
  `durationMinutes = 0`.
- `describeRecurrence(rule)` produit le libellé français, par exemple « Toutes les 2 semaines le
  lundi et le mercredi, jusqu'au 30/06 ».
- Validation serveur par zod.
- `computeSlots` (`availability.ts`) passe à la même boucle par date locale.

**Coupure et compteur.** Après une coupure au jour d, le nouveau segment prend `occurrence_count`
= ancien total − (dates produites par l'ancienne règle avant d). L'éditeur affiche « Il reste K
séances » et préremplit « après K séances ».

## 9. Portefeuille et registre

**Une ligne par ticket fait foi.** Le solde est un `count(*)` : aucun compteur ne peut dériver.

| Mouvement | Transition | Acteur | Notes |
|---|---|---|---|
| `purchase` | ∅ → `available`, ou ∅ → `booked` pour le ticket n° 1 d'un achat + réservation | système | N lignes depuis l'instantané d'achat ; **un seul** mouvement par ticket et par action |
| `offer` | ∅ → `available` | pro | `purchase_id NULL`, expiration optionnelle, email optionnel |
| `spend` | `available` → `booked` | client ou pro | renseigne `booking_id` |
| `return` | `booked` → `available`, ou `expired` si périmé | client, pro ou système | vide `booking_id` |
| `pointage` / `unpoint` | `available` ↔ `used` | pro | la note va dans `reason`, la date est celle du mouvement |
| `convert` | `available` → `available`, type A → B | pro | garde `purchase_id` et `expires_at` |
| `close` | `available` → `closed` | pro | motif obligatoire ; `retire` seulement si offert (CHECK) |
| `expire` | `available` → `expired` | système (tâche de nuit) | trace seulement : l'utilisabilité n'attend jamais la tâche |

**Payé ou offert.**
- Un ticket est payé si `purchase_id IS NOT NULL`.
- Un ticket payé ne sort que par utilisation, pointage, conversion, expiration ou clôture avec
  motif : « remboursé hors Skedul », « compensé » ou « autre » + note.
- Un ticket offert peut être « Retiré » librement.
- Rien n'est jamais effacé.

**Éligibilité.** Un seul fragment SQL dans `src/lib/booking/eligibility.ts`, partagé par la
dépense et l'affichage « utilisable ici ». Un ticket est éligible si :
- `t.status = 'available'` et son type n'est pas archivé ;
- `t.expires_at IS NULL OR t.expires_at > o.starts_at` (**valide à la date de la séance**) ;
- **et** :
  - soit la séance est celle d'un événement en mode `tickets`, avec un lien `event_ticket_type`
    pour ce type ;
  - soit c'est un RDV avec `o.ticket_type_id = t.ticket_type_id`, sur un type `rdv_enabled` et
    non `rdv_free`.

Les liens sont lus en direct. C'est une jointure interne : une liste vide n'accepte personne.

**Ordre de consommation** : `ORDER BY expires_at ASC NULLS LAST, created_at, id`, avec `FOR NO KEY UPDATE
OF t SKIP LOCKED`.

**Expiration.**
- `ticketExpiry(paidAt, validity, tz)` (`src/lib/ticket-expiry.ts`) renvoie l'instant de minuit
  local qui suit (date locale du paiement + N jours ou mois), avec le plafonnement de fin de mois
  de date-fns.
- Le ticket est valable toute sa dernière journée : « valable jusqu'au 12/01 inclus ».
- Une offre dont la validité n'atteint pas une séance n'est pas proposée pour cette séance.

**Solde par type** : `count(*) FILTER (WHERE status = 'available' AND (expires_at IS NULL OR
expires_at > now))`.

**Archiver ou supprimer.**
- **Type** : « Supprimer » un type référencé lève 23503 (FK NO ACTION), et le type est archivé à
  la place. L'archivage pose `archived_at` et **ne touche ni aux offres ni aux liens**.
  - Les offres et la page publique ignorent tout type archivé (`type.archived_at IS NULL` est
    vérifié partout).
  - Désarchiver restaure tout.
  - Un type sans ticket, sans achat et sans séance est supprimé physiquement.
- **Offre** : « Supprimer » une offre déjà achetée pose `archived_at`. `is_active` reste le
  simple interrupteur « en vente / pas en vente ».
- **Événement** : un événement en mode `tickets` sans aucun type actif lié est signalé « aucun
  ticket actif accepté ».

**Alertes** : `classifyTypes` (`src/lib/wallet-rules.ts`), calculé une fois par pro. Les tickets
comptés sont `status = 'available'` et non expirés, avec le même prédicat que le solde.
- 🔴 le client détient de tels tickets d'un type **archivé**.
- 🟠 le client détient de tels tickets d'un type actif qui n'est pas `rdv_enabled` et qui n'est
  lié à aucun événement en mode `tickets`, non archivé, ayant une séance future `scheduled`. Les
  événements privés comptent comme liés.
- Les alertes disparaissent d'elles-mêmes quand la condition cesse.

**Clients, KPI et argent.**
- `isClient` = a une inscription confirmée **ou** détient au moins un ticket, quel que soit son
  état.
- KPI du tableau de bord :
  - **Séances à venir (7 j)** : séances d'événement `scheduled` + RDV réservés, avec en
    sous-titre « dont N inscrits » ;
  - **Tickets en circulation** : tickets valides disponibles ;
  - **Clients** ;
  - **Encaissé**.
- **Encaissé** = Σ `amount_cents` des achats payés dont `livemode` correspond au mode Stripe en
  cours, par devise.
  - Prédicat unique `paidPurchaseOf` dans `src/lib/booking/revenue.ts` (sans `server-only`),
    réexporté par `src/server/revenue.ts`. Il est partagé par le tableau de bord,
    `/dashboard/payments` et `admin-queries.ts`.
  - En simulé ou en clés de test, `livemode = false` et les achats comptent, pour que les
    environnements de test montrent des chiffres. En clés live, seuls les achats `livemode =
    true` comptent.
  - Les pages Paiements et Admin marquent « Test » les achats `livemode = false`.
- Les tickets clos « remboursé hors Skedul » ne baissent pas l'encaissé brut ; la page Paiements
  les affiche en note.

## 10. Mécanisme d'écriture : `atomic()`

`src/lib/db/atomic.ts` n'importe pas `server-only` : les actions, le seed et les tests DB
l'utilisent tous.

**Signature** : `atomic(db, plan)`, où `plan = async () => (aid) => Query[]`.
- `plan()` fait les lectures préalables et choisit les ids JS, puis renvoie le constructeur de
  requêtes. `aid` est un id d'action (nanoid).
- **`40P01`** (interblocage) : on relance une fois les **mêmes** requêtes.
- **`skedul:stale`** : `atomic` remonte l'erreur à l'appelant, qui décide.
  - E7 (suivantes), E8 et `ensureHorizon` rappellent `atomic(db, plan)` **une fois** : nouvelle
    lecture, nouveaux ids, nouvel `aid`.
  - E1, E4, E6c et E9 renvoient l'erreur à l'UI (« L'offre a changé », nouvel aperçu…).

**Horloge.** Chaque point d'entrée du moteur prend `now: Date` (par défaut `new Date()`), passé
en paramètre SQL `$now` à la place de `now()`. Les actions passent l'heure réelle. Le seed et les
tests DB injectent des instants passés, par exemple un achat à J−120 pour obtenir un ticket
expiré, ou une place échue pour T5.

**Verrouiller d'abord.**
- Ordre global des verrous : **professional → event → occurrence (id croissant) → customer →
  booking → purchase → ticket**. Seuls E4 et E6c prennent le verrou `professional` : ils
  sérialisent les RDV face aux indisponibilités. Les verrous explicites sont des
  `FOR NO KEY UPDATE` : un `FOR UPDATE` bloquerait le `FOR KEY SHARE` que prend chaque contrôle de
  clé étrangère à l'insertion, et réintroduirait des verrous hors ordre.
- En READ COMMITTED, chaque requête suivante prend un instantané neuf. Elle voit tout ce qui a été
  validé avant l'obtention des verrous, plus les écritures du lot. Une écriture en éventail
  (annuler une séance) ne peut donc pas rater une inscription validée pendant l'attente du
  verrou ; une seule grosse CTE, qui garde un instantané unique, le pourrait.

**Garder, puis affirmer.**
- Chaque UPDATE gardé est suivi de `G(prédicat, code)` = `select skedul_assert(prédicat, code)`.
- La garde porte sur des lignes connues par id JS, ou **marquées par cet `aid`** :
  `booking.ended_action_id`, `ticket_purchase.fulfilled_action_id`, `event.last_action_id`,
  `ticket_movement.action_id`. Une garde ne compte jamais « les lignes qui sont dans l'état
  cible » : une action concurrente identique passerait aussi.
- Une garde qui ne touche aucune ligne lève une erreur et tout le lot est annulé.
- Les contraintes CHECK, UNIQUE et EXCLUDE lèvent d'elles-mêmes.
- **Transition + mouvement en une seule requête** quand le registre est concerné : `WITH u AS
  (UPDATE ticket … RETURNING …) INSERT INTO ticket_movement … SELECT … FROM u`, puis `G((SELECT
  count(*) FROM ticket_movement WHERE action_id = $aid) = N, 'stale')`. Le mouvement n'existe
  ainsi que pour les lignes réellement changées par cette action.

**Effets de bord après validation**, depuis une lecture finale, dans `src/server/notify.ts`
(`server-only`) : emails, Google, Stripe `sessions.expire`, `revalidatePath`. Ils sont faits au
mieux, sans garantie.

**Traduction des erreurs** : `mapDbError(err, ctx: 'delete' | 'write')`, messages en français
dans `tickets.ts`.

| Erreur | Contexte | Code → message |
|---|---|---|
| P0001 `skedul:already_paid` | fulfillment | succès sans effet (livraison en double) |
| P0001 `skedul:<code>` | tous | selon le code (`changed` → « La séance a changé, rafraîchissez ») |
| 23514 `occurrence_seats_chk` | write | `full` → « Complet » |
| 23514 autre CHECK nommée | tous | table indexée par nom (ex. `ticket_retire_paid_chk` → « Un ticket payé ne peut pas être retiré »), repli `invalid` |
| 23505 `booking_active_uq` | write | `already_booked` → « Vous êtes déjà inscrit(e) », ou reprise du paiement en attente |
| 23505 autre (dont `ticket_movement_action_id_ticket_id_unique`, `ticket_pkey`) | tous | erreur de programmation : relancée (le webhook répond 500, Stripe réessaie) |
| 23P01 `occurrence_rdv_excl` | write | `slot_taken` → « Ce créneau vient d'être pris » |
| 23503 | delete | `in_use` → archivage à la place |
| 23503 | write | `stale` → « Ceci a changé, rafraîchissez la page » |
| 40P01 | tous | relance une fois |

**Fragments partagés.**
- **`R(o)`**, libération paresseuse sur une séance déjà verrouillée : `UPDATE booking SET status
  = 'expired', ended_at = $now, ended_by = 'system', ended_action_id = $aid WHERE occurrence_id =
  $o AND status = 'pending' AND hold_expires_at < $now`.
- **`rel(o)`** = `(SELECT count(*) FROM booking WHERE occurrence_id = $o AND ended_action_id =
  $aid)`, évalué **dans** la requête SEAT, donc après toutes les fins d'inscription de cette
  séance dans le lot.
- **`SEAT(o, delta)`** :
  - `UPDATE occurrence SET seats_taken = seats_taken + delta − rel(o)` ;
  - pour un RDV qui retombe à 0 place prise : `status = 'cancelled'` et `cancelled_at` ;
  - le CHECK lève `full` ;
  - **appelé une seule fois par séance et par action**, après toutes les fins d'inscription de
    cette séance.
- **`RET(aid)`**, appelé une seule fois par action, rend les tickets des inscriptions terminées
  par cette action, en une requête : `WITH u AS (UPDATE ticket SET status = CASE WHEN expires_at
  <= $now THEN 'expired' ELSE 'available' END, booking_id = NULL WHERE booking_id IN (SELECT id
  FROM booking WHERE ended_action_id = $aid) RETURNING …) INSERT INTO ticket_movement (kind
  'return', …) SELECT … FROM u`.

### Résultat du spike P1 (2026-10-12)

Exécuté sur la branche Neon jetable `spike-batch` (enfant de `development`, Postgres 17.11) par
`scripts/spike/run.ts` (plan P1). Tableau du passage final, après la revue indépendante : S2 prouve
l'ordre avec les horloges du serveur, S8c lit le cache avant la base, S8d compte les envois.

| Check | Résultat | Durée | Détail |
|---|---|---|---|
| S1 a raising assert rolls back the whole batch | PASS | 2494 ms | P0001 skedul:boom rolled back the insert; a 0-row UPDATE alone does not abort |
| S2 a statement after a lock wait sees rows committed during the wait | PASS | 3634 ms | server: waiter began, insert committed +666 ms, lock got +1687 ms; saw 1 row (total 2181 ms) |
| S3 FOR UPDATE SKIP LOCKED inside a batch | PASS | 3638 ms | picked t2 in 185 ms while t1 was locked |
| S4 parameterised data-modifying CTE in a batch, aid-marked guard | PASS | 2070 ms | sql.param(array) binds one text[] param; RETURNING rows come back; replay raises stale |
| S5 btree_gist + partial EXCLUDE on (pro, tstzrange) | PASS | 1644 ms | 23P01 rdv_excl on overlap; other pro, back-to-back and cancelled rows allowed |
| S6 NO ACTION FKs survive the deleteUser cascade | PASS | 13339 ms | no action after/before: ok/ok; restrict-before: ok; direct delete: 23503 |
| S7 SQLSTATE and constraint names reach the caller | PASS | 2196 ms | in batch: NeonDbError; outside: DrizzleQueryError+cause |
| S8a password sign-up sends an e-mail-verification CODE (no link) | PASS | 1746 ms | one email-verification code sent on sign-up |
| S8b a logged-in user verifies by code and keeps the password | PASS | 3884 ms | verified; credential kept; hook path=/email-otp/verify-email |
| S8c OTP sign-in on an unverified password account purges it (takeover fix) | PASS | 5689 ms | purged; victim session kept; attacker STILL shown by the cookie cache, gone on a no-cache read |
| S8d resend within expiry sends the SAME code (encrypted + reuse) | PASS | 1790 ms | two e-mails sent, the second reused the first code |
| S8e a before-hook cap short-circuits without invalidating the live code | PASS | 2532 ms | capped send answered 200 {success:true}, nothing sent, live code still valid |

**Verdict : GO.** Le mécanisme `atomic()` est retenu tel quel ; le plan B (plpgsql, Pool) n'est
pas nécessaire.

Points à appliquer en P2, établis par le spike :
- **Tableaux en paramètre** : toujours `= any(${sql.param(ids)}::text[])` (S4 : un seul paramètre
  `text[]`, la ligne hors tableau reste intacte). Un tableau nu, lui, est développé en liste
  `($1, $2)` par le gabarit `sql` de drizzle (source : `drizzle-orm/sql/sql.js`, pas le spike).
- **Erreurs** : dans un lot, neon lève un `NeonDbError` brut ; hors lot, drizzle l'enveloppe dans
  un `DrizzleQueryError` (`.cause`). `mapDbError` s'appuie sur `pgErrorInfo` / `skedulCode`
  (`src/lib/db/pg-error.ts`, livré en P1), qui lit les deux formes.
- **Garde sans assertion** : un UPDATE gardé qui touche 0 ligne n'annule pas le lot (S1). Toute
  garde est donc suivie d'un `skedul_assert`.
- **FK** : `deleteUser` passe parce que **chaque table du domaine a sa propre cascade directe
  depuis `professional` (règle R2)**. La revue l'a vérifié : si la ligne qui référence (une
  inscription) n'est atteinte que par une cascade plus profonde (via `customer`), la suppression
  échoue en 23503, en NO ACTION comme en RESTRICT ; avec une cascade directe, les deux passent
  (S6). R2 est donc obligatoire pour toute nouvelle table, et T11 le vérifie ; R1 (aucun
  `RESTRICT`) reste une règle de prudence.
- **Auth** : voir § 12 (options emailOTP corrigées, hook confirmé).

## 11. Parcours d'écriture

### E1. Achat + réservation d'une séance (sans connexion)

**Validation, sans verrou :**
- séance `scheduled`, réservable en ligne (préavis et horizon) ;
- événement en mode `tickets`, non privé, non archivé ;
- offre active, non archivée, type non archivé et lié à l'événement ;
- `ticketExpiry(now, offre) > starts_at` ;
- réponses valides (`buildAnswers`) ;
- `throttle` (§ 12) et champ piège vide.

Puis `upsertCustomer`, une requête isolée : `INSERT … ON CONFLICT (professional_id, email) DO
UPDATE SET phone = COALESCE(customer.phone, excluded.phone), user_id = COALESCE(customer.user_id,
excluded.user_id)`.
- `user_id` n'est fourni que si une session vérifiée porte le même email.
- Le nom n'est **jamais** écrasé par une saisie anonyme.

**Lot :**
1. verrouiller la séance (`FOR NO KEY UPDATE`), puis le client ;
2. `R(o)`, puis `SEAT(o, +1)` ;
3. `G(scheduled ∧ réservable ∧ aucun time_off ∧ mode tickets ∧ non privé ∧ non archivé,
   'unavailable')`, puis `G(starts_at = $vu, 'changed')` ;
4. `G(offre active ∧ non archivée ∧ type non archivé ∧ lié, 'stale')`, puis `G(nb d'inscriptions
   pending du client chez ce pro, séances et RDV confondus, < 2, 'too_many_holds')` ;
5. `INSERT ticket_purchase` : pending, instantané de l'offre, `checkout_expires_at = $now + 31
   min` ;
6. `INSERT booking` : pending, couverture ticket, `purchase_id`, `hold_expires_at = $now + 45
   min`. Puis les réponses.

**Après validation :**
- `createCheckoutUrl` avec :
  - `expires_at = Date.now() + 31 min`, calculé juste avant l'appel ;
  - `payment_method_types: ['card']` ;
  - métadonnées `{purchaseId}` ;
  - `success_url = /[slug]/merci?p=…` ;
  - `cancel_url = /[slug]/seance/[o]?paiement=annule&p=…`.
- UPDATE gardé de `checkout_session_id` et `checkout_url`, `WHERE status = 'pending'`.
- Si Stripe échoue, on libère la place tout de suite (E11).
- En mode simulé, l'URL est `/api/mock-checkout?purchase=$pid`.

**Courses :**
- dernière place : le CHECK ;
- séance déplacée ou annulée entre-temps : `changed` ou `unavailable` ;
- offre modifiée : `stale` ;
- deux achats parallèles du même client : verrou `customer` ;
- double envoi : `booking_active_uq`, puis « Reprendre le paiement » ou « Libérer ma place » ;
- annulation par le pro pendant le paiement : les tickets vont au portefeuille (E10).

### E2. Utiliser un ticket détenu (session vérifiée) et « Inscrire » côté pro

L'autorisation passe par `requireWalletOwner(proId)` côté client (§ 12) et par `requirePro` côté
pro.

**Choix du client par le pro.** `register-attendee-dialog` cherche parmi les clients du pro (nom
ou email) ou crée un « Nouveau client » (`createCustomer`, E8).

**Lot :**
1. verrouiller la séance ;
2. `R(o)`, puis `SEAT(o, +1)`. Avec l'option pro « +1 place » (séances d'événement uniquement),
   `capacity = GREATEST(capacity, seats_taken + 1 − rel(o))` dans la même requête ;
3. gardes :
   - **client** : celles de E1 ;
   - **pro** : séance non annulée uniquement. Le pro accepte les événements privés, les séances
     passées, hors horizon et sous indisponibilité ;
4. `INSERT booking`, confirmed. La couverture dépend du cas :
   - `ticket` : séance en mode `tickets`, ou RDV payant ;
   - `free` : séance en mode `free`, ou RDV gratuit ;
   - `guest` : « Sans ticket / Invité », pro seulement, sur tout mode ;
5. couverture `ticket` uniquement :
   - `WITH u AS (UPDATE ticket SET status = 'booked', booking_id = $bid WHERE id = (choix éligible
     … FOR NO KEY UPDATE SKIP LOCKED) RETURNING …) INSERT INTO ticket_movement (spend) …` ;
   - le pro peut imposer un ticket précis, toujours soumis à l'éligibilité ;
   - puis `G(EXISTS ticket WHERE booking_id = $bid, 'no_ticket')` ;
6. les réponses. Les questions obligatoires ne sont pas exigées du pro.

**Après validation** : `notifyBookingConfirmed` pour **chaque** inscription. Le pro est prévenu
quand c'est le client qui réserve.

**Courses :**
- deux onglets sur le dernier ticket : SKIP LOCKED + UNIQUE `booking_id` → `no_ticket` ;
- dernière place : le CHECK ;
- conversion ou clôture concurrente : verrous de ligne.

### E3. Inscription libre (séance en mode `free`)

- Même lot que E2 avec la couverture `free` et `G(mode = 'free' ∧ non privé ∧ réservable …)`.
- Validation : `throttle`, champ piège, une seule inscription active par séance et par email
  (index unique).
- Un email de confirmation part toujours.

### E4. RDV libre (ticket détenu, achat + réservation, ou gratuit)

**Lecture préalable :**
- type `rdv_enabled`, non archivé ;
- `startAt` fait partie des créneaux de `computeSlots` :
  - règles du type, sinon règles globales ;
  - occupé = `time_off`, toute séance d'événement `scheduled` (privée, mode `none` et vide
    comprises), RDV occupés (§ 7) ;
  - marges du type ;
  - préavis et horizon effectifs ;
- identité et limites.

**Lot :**
1. verrouiller le pro ;
2. `SELECT id FROM occurrence WHERE professional_id = $p AND event_id IS NULL AND status =
   'scheduled' AND tstzrange(block_start, block_end) && $range ORDER BY id FOR NO KEY UPDATE` ;
3. expirer leurs places en attente échues, puis libérer les places en agrégat, par N et non
   par 1. Un RDV retombé à 0 devient `cancelled` ;
4. `INSERT occurrence` (RDV, capacité 1, `seats_taken` 1). L'EXCLUDE lève `slot_taken` contre
   tout RDV actif ;
5. `G(aucune séance d'événement scheduled qui chevauche ∧ aucun time_off ∧ préavis et horizon,
   'slot_taken')` ;
6. selon le cas :
   - **ticket détenu** : E2 étapes 4 à 6 sur la nouvelle séance ;
   - **gratuit** (`rdv_free`) : inscription confirmée de couverture `free` ;
   - **achat + réservation** : E1 étapes 4 à 6. Là, « lié » signifie `offer.ticket_type_id =
     o.ticket_type_id`, type `rdv_enabled`, non `rdv_free`, non archivé, et
     `ticketExpiry(now, offre) > starts_at`.

   Les réponses sont celles des questions RDV du type.

**Courses :**
- deux clients sur le même créneau : EXCLUDE, garanti par la base ;
- un RDV face à une indisponibilité en cours d'écriture : verrou `professional` ;
- un événement créé par le pro au même instant : toléré. L'éditeur d'événement avertit
  « conflit avec N RDV », et le planning affiche les deux.

### E5. Annulation par le client (session vérifiée ou lien personnel)

**Lot :**
1. verrouiller la séance ;
2. `UPDATE booking b SET status = 'cancelled', ended_at = $now, ended_by = 'client',
   ended_action_id = $aid WHERE id = $b AND customer_id = $c AND status = 'confirmed' AND EXISTS
   (…)`. La condition `EXISTS` exige :
   - une séance future ;
   - **et** l'une des trois conditions suivantes :
     - `starts_at − délai effectif > $now` ;
     - `o.changed_at > b.created_at` ;
     - `b.moved_at IS NOT NULL` ;
3. `G(ligne marquée par $aid, 'too_late_or_done')` ;
4. `SEAT(o, 0)` (le `rel` compte cette inscription ; un RDV passe en annulé) ;
5. `RET(aid)`.

**Après validation** : email au client et au pro ; événement Google supprimé s'il ne reste aucun
inscrit. Après le délai, la page affiche « Seul(e) [pro] peut annuler maintenant ».

« Annuler » depuis le lien de l'email est un formulaire **POST** sur `/[slug]/espace` : un
scanner de liens ne peut pas déclencher l'annulation.

### E6. Annulations par le pro

**(a) Une ou plusieurs inscriptions d'une séance.**
- Comme E5, sans délai, avec `status IN ('pending','confirmed')` et `ended_by = 'pro'`.
- Autorisé aussi sur une séance passée, pour corriger une erreur : le ticket revient.
- Pour un ensemble, on termine d'abord toutes les inscriptions, puis un seul `SEAT(o, 0)` par
  séance, puis un seul `RET(aid)`.
- Si une inscription était en attente de paiement, on appelle ensuite
  `stripe.checkout.sessions.expire`. Un paiement qui arrive quand même part au portefeuille.

**(b) Une séance entière.**
1. `UPDATE occurrence SET status = 'cancelled', cancelled_at = $now, seats_taken = 0 WHERE id = $o
   AND professional_id = $p AND status = 'scheduled'` (ce qui verrouille) ;
2. `G(status = 'cancelled', 'not_found')`, idempotent ;
3. `UPDATE booking SET status = 'cancelled', ended_*, ended_action_id = $aid WHERE occurrence_id
   = $o AND status IN ('pending','confirmed')` ;
4. `RET(aid)`.

Après validation : email « séance annulée » (tickets rendus), Stripe `expire` pour les paiements en
attente, suppression de l'événement Google.

**Rétablir** (séance d'événement future uniquement, jamais un RDV) :
- `UPDATE occurrence SET status = 'scheduled', cancelled_at = NULL, changed_at = $now WHERE id =
  $o AND professional_id = $p AND status = 'cancelled' AND event_id IS NOT NULL AND starts_at >
  $now`, puis `G(status = 'scheduled', 'not_found')` ;
- aucune inscription n'est restaurée, et rien ne part vers Google avant la première inscription.

**(c) Indisponibilité.**
- Lecture préalable des séances `scheduled` chevauchées qui ont des inscrits actifs. La fenêtre
  propose « Annuler ces N séances (tickets rendus, clients prévenus) » ou « Les garder ».
- **Lot :**
  1. verrouiller le pro, puis **toutes** les séances chevauchées, vides comprises (id
     croissant) ;
  2. `INSERT time_off` ;
  3. `G(ensemble des séances chevauchées avec seats_taken > 0 = $idsVus, 'stale')`. Une
     inscription arrivée après l'aperçu renvoie à un nouvel aperçu ;
  4. si « Annuler » : (b) sur cet ensemble.
- Les séances gardées restent pour leurs inscrits mais sont fermées aux inscriptions en ligne.
  Le pro peut encore y inscrire quelqu'un.

### E7. Modifications

**Cette séance** : date, heure, durée, capacité, lieu, annuler, rétablir.
- Lot : verrou, puis `UPDATE occurrence SET …` (`time_detached`, `capacity_override`,
  `location_override` selon le champ changé ; `capacity = GREATEST($cap, seats_taken)` ;
  `changed_at = $now` si date, heure ou durée changent) `WHERE id AND status = 'scheduled' AND
  event_id IS NOT NULL`, puis `G`.
- Un RDV se déplace par « annuler et réinscrire », jamais par cette voie.
- **Déplacement au-delà de la validité.** La fenêtre liste les inscrits dont le ticket expire
  avant le nouveau début. Choix :
  - « Garder » (par défaut ; le ticket reste dépensé). Le changement vient du pro, et le ticket
    était valide à la date réservée ;
  - « Désinscrire (ticket rendu) », qui applique E6a à cet ensemble dans le même lot.
- Après validation : email « séance modifiée » si la date, l'heure, la durée ou le lieu effectif
  change.

**Éditeur d'événement** (`/dashboard/events/[id]`) : il édite le **segment courant**, celui qui
porte la prochaine séance.
- **Sur place, sans coupure** :
  - titre, description, lieu, couleur, privé ;
  - mode, types acceptés, questions ;
  - surcharges d'horizon, de préavis et d'annulation ;
  - capacité : `event.capacity`, et `UPDATE occurrence SET capacity = GREATEST($cap,
    seats_taken)` pour les séances futures `scheduled` sans `capacity_override`.

  Tout cela se fait dans un seul lot gardé par `version`/`last_action_id`. Si le lieu change, un
  email « séance modifiée » part aux inscrits actifs des séances futures sans
  `location_override`.
- **Par coupure « cette séance et les suivantes »** : récurrence, date de début, heure et durée.
  Depuis l'éditeur, d = date de la première séance future non commencée. La modification se fait
  en place si le segment n'a aucune séance passée.

**Cette séance et les suivantes** (coupure au jour local d).

Lecture préalable : l'événement (`version`) et les séances `series_date ≥ d`, avec
`time_detached`, le nombre d'inscrits actifs et `has_history = EXISTS(booking sur cette séance)`.

Planificateur pur `planSeriesEdit(ancien, lignes, nouvelleRègle)` (`src/lib/series-plan.ts`). Il
renvoie :
- `retime` : lignes non `time_detached` dont la date existe encore ;
- `reparentOnly` : lignes `time_detached` ;
- `delete` : lignes sans aucun historique d'inscription dont la date disparaît ;
- `cancelEmpty` : lignes dont la date disparaît, sans inscrit actif mais avec un historique (ou
  déjà annulées). Elles passent `cancelled`, barrées pour le pro et masquées du public ;
- `orphanBooked` : lignes avec inscrits actifs dont la date disparaît. Le pro choisit « Garder
  (séance isolée) », par défaut, ou « Annuler (tickets rendus) » ;
- `insert` : nouvelles dates ;
- le total restant.

L'aperçu compte exactement les inscrits prévenus : « 12 séances modifiées, 3 inscrits prévenus, 1
séance annulée (2 tickets rendus) ».

**Lot :**
1. `UPDATE event SET version = version + 1, last_action_id = $aid, end_mode = 'until', until_date
   = d − 1 WHERE id = $e AND version = $v` (en place si d est la première séance), puis
   `G((SELECT last_action_id FROM event WHERE id = $e) = $aid, 'stale')` ;
2. `INSERT` du nouvel événement (même `series_root_id`, nouvelle règle), puis copie des liens et
   des questions ;
3. verrouiller les séances `series_date ≥ d` ;
4. les rattacher au nouvel événement ;
5. recaler les lignes `retime` depuis une liste `VALUES` :
   - `starts_at`, `ends_at`, `block_*` et `changed_at = $now` là où l'heure change ;
   - `capacity = GREATEST(v.cap, seats_taken)` seulement si `NOT capacity_override` ;
6. `DELETE … WHERE id = ANY($delete) AND seats_taken = 0 AND NOT EXISTS (booking)`, puis `G(aucune
   ne reste, 'stale')` ;
7. `cancelEmpty` → `cancelled`. Pour `orphanBooked` : `time_detached = true`, ou E6b sur cet
   ensemble ;
8. `INSERT` des nouvelles dates `ON CONFLICT DO NOTHING`, puis mise à jour de `generated_until`.

Un 23503 dans ce lot est traduit en `stale`, avec un nouveau plan une fois.

Après validation : email « séance modifiée » à chaque inscrit actif d'une séance ≥ d dont la date,
l'heure, la durée, le titre ou le lieu effectif change, séances isolées gardées comprises. Aucun
email si seuls la capacité, la description, les types ou les questions changent. Puis
resynchronisation Google.

**« Supprimer à partir du… ».**
- Les séances futures avec inscrits sont annulées (E6b).
- Les vides sans historique sont supprimées, les vides avec historique sont annulées.
- `until_date` devient d − 1.
- Un événement qui n'a jamais eu d'inscription est supprimé physiquement. Sinon, la tâche de nuit
  l'archive dès qu'il n'a plus rien de futur (E12).

### E8. Fiche client (pro ; chaque requête filtrée par `professional_id`)

Schéma commun :
1. choisir les ids de tickets en JS, dans l'ordre de consommation ;
2. **une requête** `WITH u AS (UPDATE ticket SET … WHERE professional_id = $p AND id = ANY($ids)
   AND <état attendu> RETURNING …) INSERT INTO ticket_movement (…, action_id) SELECT …, $aid FROM
   u` ;
3. `G((SELECT count(*) FROM ticket_movement WHERE action_id = $aid) = N, 'stale')`.

Un `stale` refait le choix et relance une fois. Les boutons sont désactivés pendant l'action.

| Action | Effet |
|---|---|
| Nouveau client | `createCustomer({name, email, phone?})` : upsert sur `(professional_id, email)` ; le pro peut écraser nom et téléphone |
| Offrir N | `INSERT ticket` (N ids JS, `purchase_id NULL`, expiration optionnelle) depuis `customer WHERE id AND professional_id`, type actif ; mouvements `offer` dans la même requête ; `G(N)` ; email optionnel |
| Convertir N, A → B | transition `type A → B` sur des tickets `available` valides ; `G(N)` ; `G(B actif)` ; mouvements `convert` avec `from_ticket_type_id` |
| Clore N (motif) / Retirer N | → `closed` avec `closed_reason` et note ; « Retirer » filtre aussi `purchase_id IS NULL` (et le CHECK l'impose) |
| Pointer / Annuler le pointage | `available` ↔ `used` ; mouvements `pointage` / `unpoint` |
| Modifier nom / téléphone | UPDATE simple sur `customer` |
| Déconnecter ses liens | `link_version = link_version + 1` |
| Déplacer un inscrit | voir ci-dessous |

**Déplacer un inscrit** (corrige le `moveAttendee` actuel) :
- verrouiller les deux séances par id croissant ;
- terminer la place sur la source, `SEAT −1` ; prendre la place sur la cible, `SEAT +1` ;
- `UPDATE booking SET occurrence_id = $vers, moved_at = $now WHERE id AND occurrence_id = $depuis
  AND status = 'confirmed'`, puis `G` ;
- `G(cible scheduled ∧ séance d'événement ∧ (couverture ≠ ticket ∨ type du ticket accepté par la
  cible), 'not_eligible')`. Un type non accepté propose « Convertir » d'abord, **dans la même
  action** : avec `convertToTicketTypeId` (type actif du pro, autre que celui du ticket), le ticket
  réservé lui-même est converti dans le même lot, après le déplacement de l'inscription et avant ce
  `G` : transition `type A → B` sur ce ticket `booked`, qui reste `booked` (`purchase_id` et
  expiration gardés), un mouvement `convert` `booked → booked` avec `from_ticket_type_id` ;
  `G(B actif, 'stale')` et `G(un seul mouvement pour l'action, 'stale')`. L'inscription garde son
  `moved_at` ; « Convertir » seul ne touche que des tickets `available` ;
- si le ticket expire avant la cible, la fenêtre demande « Ticket expiré à la date de cette
  séance — déplacer quand même ? ». Le pro peut forcer ;
- `booking_active_uq` couvre le cas d'un client déjà inscrit sur la cible ;
- email au client.

### E9. Achat en boutique (offre seule)

- Validation, `throttle`, `upsertCustomer`.
- Puis un seul `INSERT ticket_purchase` (pending, `checkout_expires_at = $now + 24 h`).
- `createCheckoutUrl` avec `expires_at` = la même valeur et les moyens de paiement du tableau de
  bord. Aucune place n'est en jeu.

### E10. Fulfillment

`fulfillPurchase(purchaseId, {sessionId, paymentIntentId, livemode}, now)`
(`src/lib/booking/fulfillment.ts`) remplace `src/lib/payments.ts`. Trois appelants :
- le webhook `checkout.session.completed` avec `payment_status === 'paid'` ;
- `checkout.session.async_payment_succeeded` ;
- la route simulée (`livemode = false`).

**Lecture préalable** : l'achat (quantité, validité), le fuseau du pro, l'inscription éventuelle.
- **Achat introuvable** (pro supprimé, session d'avant la refonte) : réponse 200, log `[stripe]
  orphan payment <session>/<payment_intent>`, et compteur « paiements orphelins » dans la carte
  santé de l'admin. Le remboursement se fait à la main dans Stripe.
- Les N ids de tickets et `expires_at` sont calculés en JS.

**Lot :**
1. (achat + réservation) verrouiller l'inscription `WHERE purchase_id = $p` ;
2. `UPDATE ticket_purchase SET status = 'paid', paid_at = $now, livemode, checkout_session_id,
   payment_intent_id, fulfilled_action_id = $aid WHERE id = $p AND status IN
   ('pending','expired')`. Un argent reçu donne **toujours** des tickets ;
3. `G(fulfilled_action_id = $aid, 'already_paid')`. Une livraison en double lève ici et est
   traduite en succès sans effet : ni tickets, ni emails ;
4. `UPDATE booking SET status = 'confirmed', confirmed_at = $now WHERE purchase_id = $p AND
   status = 'pending'`. Une inscription expirée ou annulée n'est **jamais** ressuscitée ;
5. `WITH t AS (INSERT INTO ticket SELECT … FROM unnest($ids) WITH ORDINALITY … RETURNING …)
   INSERT INTO ticket_movement (purchase) SELECT … FROM t` :
   - le ticket n° 1 est `booked` (avec `booking_id`) si une inscription confirmée existe pour $p,
     les autres sont `available` ;
   - **un seul** mouvement `purchase` par ticket, sans `spend`.

**Après validation** : le reçu (avec expiration), puis soit la confirmation d'inscription, soit
l'email de paiement tardif (« Paiement reçu, votre place n'était plus réservée : vos N tickets sont
dans votre portefeuille »).

**Autres événements du webhook** :
- `checkout.session.completed` avec `payment_status = 'unpaid'` (paiement différé) :
  `processing_at = $now`. La page `merci` affiche « Paiement en cours de traitement ».
- `async_payment_failed` → E11.
- `checkout.session.expired` → E11.

**Route simulée** :
- elle renvoie 404 dès que `env.STRIPE_ENABLED` ;
- elle n'accepte que `?purchase=` et redirige vers une page `/[slug]/merci` construite côté
  serveur, sans paramètre de redirection ;
- en production, elle est coupée dès que les clés Stripe y sont posées (P6).

### E11. Libération des places

**`releasePurchase(p)`**, idempotent. Appelants : le webhook `expired`, « Libérer ma place », une
erreur Stripe, `async_payment_failed`.

Lot :
1. verrouiller la séance de l'inscription ;
2. `UPDATE booking SET status = 'expired', ended_*, ended_action_id WHERE purchase_id = $p AND
   status = 'pending'` ;
3. `SEAT(o, 0)` ;
4. `UPDATE ticket_purchase SET status = 'expired' WHERE id = $p AND status = 'pending'`.

**Abandon.**
- La page de `cancel_url` est un GET sans effet de bord. Elle propose « Reprendre le paiement » et
  « Libérer ma place ».
- « Libérer ma place » est un POST qui appelle d'abord `stripe.checkout.sessions.expire`. Si
  Stripe répond que la session est déjà payée, la page affiche « Paiement reçu ». Sinon, on
  appelle `releasePurchase`.

**`sweepHolds`** (tâche de nuit). Lot :
1. verrouiller les séances qui ont des places échues (id croissant) ;
2. expirer les inscriptions ;
3. libérer les places en agrégat, par N. Les RDV retombés à 0 deviennent annulés.

Les achats encore pending 1 h après `checkout_expires_at`, et sans `processing_at`, passent
`expired`.

La correction ne dépend jamais de la tâche de nuit : `R(o)` libère aussi avant chaque prise de
place.

### E12. Tâche de nuit `/api/cron/daily`

- Déclarée dans `vercel.ts` : `crons: [{ path: "/api/cron/daily", schedule: "0 3 * * *" }]`.
- `CRON_SECRET` est déclaré (optionnel) dans `env.ts` et `.env.example`. La route répond 401 si le
  secret est absent ou ne correspond pas à `Authorization: Bearer …`.
- Étapes :
  1. `sweepHolds` ;
  2. achats pending échus (sans `processing_at`) → `expired` ;
  3. expiration des tickets en **une** requête : `WITH u AS (UPDATE ticket SET status =
     'expired' WHERE status = 'available' AND expires_at <= $now RETURNING …) INSERT INTO
     ticket_movement (expire) SELECT … FROM u` ;
  4. `ensureHorizon` pour chaque pro ;
  5. archivage des événements terminés (`until_date` passé, ou `count` épuisé) sans séance future
     `scheduled` ;
  6. purge des lignes `throttle` de plus de 2 jours ;
  7. `checkInvariants()`, avec le nombre de violations stocké pour la carte santé de l'admin.

### E13. Suppression d'un compte pro

`deleteUser` (admin) lit d'abord les achats `pending` du pro qui ont un `checkout_session_id`, et
appelle `stripe.checkout.sessions.expire` pour chacun (au mieux). Ensuite seulement vient le
`DELETE FROM "user"`. L'impact affiché par `delete-user-card` inclut les tickets en circulation et
« N paiements en cours ».

## 12. Identité client et authentification

**Options d'authentification sans `server-only`.**
- `buildAuthOptions({ db, sendEmail })` est extrait dans `src/lib/auth-options.ts`. Il contient
  les hooks, emailOTP, rateLimit, `disabledPaths` et emailVerification.
- `auth.ts` = `betterAuth({ ...buildAuthOptions(dépendances de prod), plugins: [...,
  nextCookies()] })`. Le seed et les tests DB construisent leur propre instance, avec un
  `sendEmail` qui capture les codes.

**Plugin `emailOTP`** : `{ otpLength: 6, expiresIn: 300, allowedAttempts: 3, storeOTP:
"encrypted", resendStrategy: "reuse", overrideDefaultEmailVerification: true }`, **plus**
`emailVerification: { sendOnSignUp: true }` dans les options de `betterAuth`, et
`emailOTPClient()` dans `auth-client.ts`.
- Avec `overrideDefaultEmailVerification`, l'option `sendVerificationOnSignUp` du plugin est
  **inerte** : son hook d'inscription ne s'active que sans `overrideDefaultEmailVerification`
  (`better-auth/dist/plugins/email-otp/index.mjs:52`). Le code d'inscription vient de
  `emailVerification.sendOnSignUp` du cœur, qui appelle l'envoi par code du plugin (spike S8a :
  exactement un code `email-verification`).
- `sendVerificationOTP` envoie `loginCodeEmail` pour `type === "sign-in"` et
  `verifyEmailCodeEmail` pour `type === "email-verification"`.
- Un renvoi dans les 5 minutes renvoie **le même** code, sans rotation.
- **Limite par email** : 5 envois par heure, appliquée dans un `hooks.before` sur
  `/email-otp/send-verification-otp`. Au-delà, le hook répond `{ success: true }` **avant** que
  Better Auth génère un code : le code déjà envoyé reste valide. Ce hook s'exécute avant la
  validation : il ne compte que les demandes que la route enverra, soit le type `sign-in` ou
  `email-verification` avec un email que la route accepte (une chaîne sans espace autour, valide
  pour `z.email()` une fois en minuscules), et pour `email-verification` seulement si l'adresse a un
  compte (sinon la route répond 200 sans rien envoyer). Toute autre demande passe sans compter :
  la route répond elle-même (400, ou 200 sans mail), et la victime garde son plafond.
- **Demandes de réinitialisation** : même plafond (5 par heure et par adresse), avec **son propre
  compteur** (`t:reset:e:…`, distinct de `t:otp:e:…`) : un spam de réinitialisation ne doit pas
  bloquer les codes de connexion de l'adresse. Le plafond compte les mails de réinitialisation
  **que l'on tente d'envoyer** (un échec Resend compte aussi) : `sendResetPassword` l'applique,
  et non un `hooks.before`, qui s'exécute avant la validation. Une requête que l'endpoint rejette (adresse mal formée, `redirectTo`
  refusé) ou qui vise une adresse sans compte ne compte donc pas, et ne peut pas priver la victime
  de son lien. Au-delà, `sendResetPassword` n'envoie rien et rend la main sans erreur : la
  réponse de l'endpoint reste la sienne, identique à celle de toute requête valide (`{ status:
  true, message: "If this email exists in our system, check your email for the reset link" }`).
  Si le compteur lui-même échoue, le mail n'est pas envoyé : Better Auth attrape l'erreur et la
  journalise (`runInBackgroundOrAwait`), et la réponse de l'endpoint ne change pas.
- L'UI affiche toujours « Si l'adresse est valide, un code a été envoyé ».
- Le premier code de connexion crée un utilisateur `client`. Le hook admin pose le rôle, le hook
  de bannissement s'applique toujours, et `emailVerified` est vrai. Le nom saisi est envoyé.

**Verrouillage des endpoints.** `disabledPaths` = endpoints admin + tous les endpoints `emailOTP`
sauf `/email-otp/send-verification-otp`, `/sign-in/email-otp` et `/email-otp/verify-email`. La
liste est dérivée de `plugin.endpoints`, comme dans `auth-admin.ts`, avec un test du même type.

**Limites de débit Better Auth.**
- `rateLimit: { enabled: true, storage: "database", window: 600, max: 6000, customRules: {
  "/email-otp/send-verification-otp": { window: 600, max: 5 }, "/sign-in/email-otp": { window:
  600, max: 10 }, "/email-otp/verify-email": { window: 600, max: 10 }, "/sign-up/email": {
  window: 600, max: 3 }, "/request-password-reset": { window: 600, max: 3 } } }`. Les deux
  dernières règles couvrent les autres endpoints qui envoient un email : les règles par défaut de
  Better Auth (3 par 10 s pour l'inscription, 3 par 60 s pour la réinitialisation, par IP) sont
  trop courtes pour protéger le quota d'envoi.
- `enabled: true` est explicite, pour que dev et tests passent par le même chemin que la prod. La
  fenêtre globale de 600 s fait que la purge de Better Auth respecte les fenêtres personnalisées.
- Modèle `rateLimit` déclaré (§ 6.4) et ajouté à la map du `drizzleAdapter`, dans `auth.ts` et
  dans l'instance du seed.

**Limites applicatives** (`src/lib/throttle.ts`, reçoit `db`). L'IP est hachée par `ipHash(salt,
ip)` (IP seule) avec le sel du jour `analytics_salt` : aucune IP en clair.

| Action | Par IP | Par email |
|---|---|---|
| Inscription libre (`free`), achat + réservation (`buybook`), RDV (`rdv`), boutique (`shop`) | 20 / h | 6 / h |

Deux plafonds par adresse, sans plafond par IP applicatif (la règle Better Auth ci-dessus s'en
charge), passent par la même table `throttle` : les codes de connexion et de confirmation
(`otp`) et les mails de réinitialisation envoyés (`reset`), chacun à 5 par heure
(`OTP_EMAIL_LIMIT`). La clé est le hachage de l'email normalisé.

**Faille de pré-compte, fermée.**
- **Le scénario** : quelqu'un crée un compte à mot de passe sur l'email d'un client. Cet email
  n'est jamais vérifié. Le premier code de connexion du vrai client marque ce compte « vérifié »,
  et la session à mot de passe de l'intrus peut alors dépenser les tickets.
- **Correctif** : un hook `databaseHooks.user.update.before`. Il ne réagit qu'à la mise à jour qui
  passe `emailVerified` à vrai pendant `/sign-in/email-otp` : la route ne l'émet que pour un
  utilisateur non vérifié, après avoir consommé le code et **avant** de créer la session. Le hook
  retrouve l'utilisateur par l'email du corps de la requête, comme la route, puis fait ce qui suit
  en **une seule requête SQL** (les deux suppressions passent ensemble ou pas du tout). Il n'agit
  que si l'utilisateur a un compte `credential` et que l'adresse n'est pas encore vérifiée ; sans compte
  `credential`, il ne supprime aucune session et n'envoie aucun mail. Dans ce cas, il :
  - supprime ce compte `credential` ;
  - supprime **toutes** les sessions de l'utilisateur : celle de cette connexion n'existe pas
    encore, il n'y a rien à épargner ;
  - une fois la suppression réussie, envoie « Pour votre sécurité, le mot de passe associé à
    cette adresse a été désactivé ; utilisez « Mot de passe oublié » pour en choisir un ». L'envoi
    est au mieux : un échec est journalisé et n'annule rien.
- **Échec fermé** : si la suppression lève une erreur, la mise à jour est abandonnée. L'utilisateur
  reste non vérifié, la connexion échoue, et le code suivant relance la purge. Il en va de même si
  la requête ne porte pas d'email : le hook lève au lieu de sauter la purge.
- **Connexion par mot de passe en cours** : `/sign-in/email` lit le compte `credential`, vérifie le
  mot de passe (scrypt), puis crée sa session ; une session créée après la purge lui échappe. Deux
  verrous sur la ligne `user` ferment cette course. La purge est un lot (une transaction) qui
  verrouille d'abord cette ligne (`FOR NO KEY UPDATE`), puis supprime. Un hook `session.create.after`
  sur `/sign-in/email` la verrouille `FOR SHARE` (il attend donc qu'une purge en cours soit validée),
  puis supprime la session qu'il vient de créer si l'utilisateur n'a plus de compte `credential`, et
  lève : échec fermé, la connexion échoue (un aller-retour de plus par connexion par mot de passe).
- **Pourquoi `before` et pas `after`** : une autre mise à jour de l'utilisateur a lieu dans la même
  requête, pour un utilisateur déjà vérifié. À la création de la session, le plugin admin écrit
  `{ banned: false, … }` quand un bannissement à durée (`banExpiresIn`) a expiré. Un hook `after`
  qui teste seulement que `emailVerified` est vrai supprimerait alors le mot de passe et les
  sessions d'un client légitime.
- Après un code réussi, le client appelle `authClient.getSession({ query: { disableCookieCache:
  true } })` avant `router.refresh()`. Sinon, le cache cookie garde `emailVerified: false`.
- **T12** passe par `auth.handler(new Request(…))`, pas par `auth.api.*`, et vérifie que la
  nouvelle session survit.
- **Confirmé par le spike S8c** : le mot de passe de l'intrus est supprimé et la session de la
  victime survit (le spike l'a fait dans `user.update.after` avec `ctx.context.newSession` ; le
  code final purge avant la création de la session, voir plus haut).
  **Attention** : le cache cookie (5 min) montre encore l'intrus connecté ; seule une lecture sans
  cache le voit déconnecté. D'où la règle : `requireWalletOwner` **et toute lecture qui affiche des
  données client** (portefeuille, `/mon-espace`, `/[slug]/espace`) lisent la session avec
  `disableCookieCache: true`.
- Ce hook ne vise **que** la connexion par code d'un visiteur déconnecté. La confirmation d'adresse
  d'un utilisateur connecté passe par `/email-otp/verify-email` et ne le déclenche pas, pas plus
  que la levée d'un bannissement expiré pendant une connexion par code.

**Mot de passe comme preuve.**
- L'inscription par mot de passe envoie un **code** de vérification
  (`emailVerification.sendOnSignUp` avec `overrideDefaultEmailVerification`, spike S8a-S8b). L'utilisateur le saisit dans la page où il est
  connecté. Il n'y a **pas de lien** de vérification : un antivirus qui précharge les liens
  validerait le compte d'un intrus.
- Ce code ne bloque pas l'onboarding pro.
- Une session à mot de passe ne compte comme preuve que si `emailVerified` est vrai. Il le devient
  par ce code, par une réinitialisation, par Google ou par un code de connexion.
- **Comptes existants non vérifiés** (pros, admins) : le tableau de bord pro et `/mon-espace`
  affichent un bandeau « Confirmez votre adresse » (code `email-verification`). Avant de mettre
  P4 en prod, le propriétaire confirme les comptes admin et pro existants.

**Autorisation du portefeuille** : `requireWalletOwner(proId)` (`src/server/client.ts`).
- Relit la session **sans cache** (`disableCookieCache: true`).
- Exige : pas d'impersonation, `user.emailVerified`, et `customer.email = lower(user.email)` pour
  ce pro.
- Renseigne `customer.user_id` s'il est nul. À la connexion, `session.create.after` relie aussi au
  mieux les fiches `customer` de tous les pros pour un utilisateur vérifié.

**Détection automatique** (`/[slug]` et pages de séance ou de RDV) :
- **propriétaire de la page** : bandeau « Vous êtes sur votre propre page : vos réservations de
  test comptent dans vos chiffres ». Les formulaires restent actifs, pour que le pro puisse tester
  son parcours ;
- **session vérifiée** : portefeuille affiché, email prérempli en lecture seule, bouton « Réserver
  avec 1 ticket (il vous en restera N) » ;
- **session non vérifiée** : « Confirmez votre adresse » envoie un code `email-verification` et le
  vérifie par `authClient.emailOtp.verifyEmail` ;
- **déconnecté** : « J'ai déjà des tickets » ouvre `OtpDialog`. Elle propose email puis code,
  « Continuer avec Google » si `GOOGLE_CALENDAR_ENABLED`, et « J'ai un mot de passe ». Ensuite on
  rafraîchit la session (voir ci-dessus).
- `lookupCredits` et `credit-lookup.tsx` sont supprimés : ils permettaient d'énumérer les emails
  et envoyaient toute la fiche client au navigateur.

**Lien personnel** (`src/lib/guest-link.ts`, pur et testé).
- Jeton = `customerId.linkVersion.base64url(HMAC-SHA256(clé, customerId|version))`, avec une clé
  dérivée de `BETTER_AUTH_SECRET`.
- Les emails pointent vers `/api/c/<jeton>`. Cette route vérifie le jeton, pose le cookie httpOnly
  `skedul_guest` (Secure, SameSite=Lax, **Path=/<slug>**, 30 jours) et redirige (303) vers
  `/<slug>/espace`. Le jeton n'apparaît jamais dans un chemin suivi par l'analytique.
- Portée : voir les inscriptions et tickets de ce client chez ce pro, et annuler avant le délai
  (E5, POST). **Dépenser** ouvre la fenêtre de code, préremplie avec l'adresse.
- Une session vérifiée l'emporte sur le cookie.
- « Déconnecter mes liens » (client) ou l'action pro incrémente `link_version`, ce qui révoque
  tous les liens.

**Espaces client.**
- **`/mon-espace`, déconnecté** : formulaire de code en ligne (email → code), « Continuer avec
  Google », « J'ai un mot de passe ». Jamais de redirection vers `/sign-in`.
- **`/mon-espace`, connecté** : `getMySpace(user)` (`client-queries.ts`) = les fiches `customer`
  `WHERE user_id = $uid OR (email = lower($emailVérifié) AND user_id IS NULL)`, groupées par pro.
  Chaque carte montre :
  - les prochaines inscriptions ;
  - le solde par type avec les expirations ;
  - un lien vers `/<slug>/espace`.

  La page propose aussi le nom modifiable, « Déconnecter mes liens » et « Vous êtes pro ? Créer ma
  page ». État vide : « Aucune réservation pour l'instant ».
- **`/[slug]/espace`** : même contenu, limité à ce pro, avec l'annulation (E5) et les dépenses
  (E2).
  - Sans session ni cookie, il affiche le formulaire de code, limité à ce pro.
  - Sans fiche pour l'email de la session, il affiche « Aucun ticket chez <pro> pour <email> » et
    « Utiliser une autre adresse ».
- `/sign-in` gagne un lien « Espace client » vers `/mon-espace`.

**Routage.**
- `resolveEntry({ isAdmin, hasProfessional, remembered })` : un pro va sur `/dashboard`, tous les
  autres sur **`/mon-espace`**, un admin sur le choix habituel.
- `dashboard/layout.tsx` renvoie vers `/mon-espace` un utilisateur sans fiche `professional`.
- `/sign-up` (tunnel pro) utilise `callbackURL=/onboarding`.

## 13. Surface applicative

### 13.1 Routes pro

| Route | État | Contenu |
|---|---|---|
| `/dashboard` | refonte | 4 KPI (§ 9) ; carte Alertes ; checklist « Premiers pas » (type → offre → événement) ; bandeau « Confirmez votre adresse » si besoin ; `week-preview` et `upcoming-bookings` rebranchés |
| `/dashboard/planning` | refonte | séances, RDV, indisponibilités ; colonnes côte à côte ; clic sur case vide → nouvel événement ; `occurrence-dialog` |
| `/dashboard/events`, `/new`, `/[id]` | nouveau | une ligne par `series_root_id` (segment courant ; segments passés dans le détail) : mode, types acceptés, prochaine séance, badge privé, alerte « aucun ticket actif » ; `event-editor` + `recurrence-editor`, aperçu, notes d'heure d'été, conflits RDV |
| `/dashboard/tickets`, `/[id]` | nouveau, remplace `/event-types` et `/packs` | types et offres ; « Accepté par » ; RDV libre (durée, marges, gratuit, horaires perso via `weekly-hours-editor`, surcharges, questions) ; archivage |
| `/dashboard/clients` | refonte | bouton « Nouveau client » ; filtres Tous / Avec tickets / Inscriptions à venir / Alertes ; badges par type ; pastilles 🔴 🟠 |
| `/dashboard/clients/[id]` | nouveau | fiche client, détail ci-dessous |
| `/dashboard/payments` | refonte | achats payés avec l'inscription liée, badge « Test », notes de tickets clos |
| `/dashboard/settings` | mise à jour | section « Réservations » (horizon, préavis, délai d'annulation) ; fuseau verrouillé si séances |
| `/dashboard/availability` | conservé | renommé « Disponibilités (RDV libre) » |
| `/dashboard/unavailability` | mise à jour | fenêtre de conflit (E6c) |

- Barre latérale : Vue d'ensemble, Planning, Événements, Clients, Paiements, Tickets,
  Disponibilités, Indisponibilités, Réglages, Centre d'aide.
- `/dashboard/event-types` et `/dashboard/packs` redirigent vers `/dashboard/tickets`.
- Le filtre « Inscriptions à venir » = au moins une inscription confirmée sur une séance ou un RDV
  futur.

**Fiche client** (`/dashboard/clients/[id]`) :
- **En-tête** : nom, email, téléphone (modifiables), compte client lié ou non, « Déconnecter ses
  liens ».
- **Portefeuille groupé par type** : nombre utilisable et expirations. Les tickets inutilisables
  sont en **rouge** (type archivé, avec l'action « Convertir » proposée, ou ticket expiré). Un type
  lié à aucun événement est en **orange**. Les tickets utilisés et clos (avec leur motif) sont en
  gris barré, et l'origine (acheté ou offert) est indiquée. Les actions sont Pointer, Offrir,
  Convertir, Clore, Retirer.
- **Inscriptions** à venir et passées : séance ou RDV, couverture, statut. Actions Déplacer et
  Désinscrire.
- **Achats** : libellé, montant, date, statut, badge « Test ».
- **Historique** : groupé par `action_id`, dans l'ordre `seq`, par exemple « 12/10 14:03 · Vous ·
  Converti 3 Cours collectif → Cours débutants ».

### 13.2 Routes publiques et client

- **`/[slug]`** :
  - Planning, avec une bascule **Semaine / Liste** et un pas par date locale. Chaque ligne affiche
    titre, heure, lieu effectif, places restantes, badges des types acceptés, et un état parmi
    Complet / Annulée / Inscription libre / Sur place / Réservations fermées ;
  - cartes RDV libre ;
  - Boutique : offres par type, bouton « Acheter » ;
  - accès au portefeuille.
- **`/[slug]/seance/[occurrenceId]`** :

  | Cas | Affichage |
  |---|---|
  | séance publique réservable | ticket détenu, achat + réservation, inscription libre, ou info seule (Sur place) |
  | séance annulée | « Annulée », sans formulaire |
  | séance passée | « Terminée » |
  | séance privée | informations et statut de l'inscription pour le visiteur identifié (session vérifiée, cookie `skedul_guest` ou référence d'achat `p`), sinon `notFound()` |
  | occurrence RDV | redirection vers `/<slug>/espace` |
  | séance d'un autre pro, ou id inconnu | `notFound()` |

- **`/[slug]/rdv/[ticketTypeId]`** : réutilise `day-calendar` et le formulaire d'identité extrait
  de `booking-flow`. Un type archivé ou non `rdv_enabled` donne `notFound()`.
- **`/[slug]/offre/[offerId]`** : une offre inactive, archivée ou d'un type archivé affiche « Cette
  offre n'est plus proposée », avec un lien vers la Boutique.
- **`/[slug]/merci`** : états réels (payé, en attente, paiement en cours de traitement, place
  expirée). Vérifie que la référence appartient au slug.
- **`/[slug]/espace`** et **`/mon-espace`** : § 12.
- Les anciennes URL `/[slug]/book/[id]` et `/[slug]/pack/[id]` redirigent vers `/[slug]`.

### 13.3 API

- `/api/c/[token]` ; `/api/cron/daily`.
- `/api/stripe/webhook` : `checkout.session.completed`, `async_payment_succeeded`,
  `async_payment_failed`, `expired`.
- `/api/mock-checkout` : verrouillée (E10).
- `/api/bookings/[id]/calendar.ics` : jointure sur la séance ; titre de l'événement ou du type,
  lieu effectif.

### 13.4 Code serveur

| Fichier (`"use server"`) | Contenu |
|---|---|
| `pro.ts` | profil (avec le verrou du fuseau), branding, règles de disponibilité, Google, réglages |
| `pro-catalog.ts` (nouveau) | types, offres, événements, questions |
| `pro-planning.ts` (nouveau) | modifications et coupures de séances, annuler et rétablir, inscrire, déplacer, indisponibilités |
| `pro-clients.ts` (nouveau) | créer un client, offrir, convertir, clore, retirer, pointer et annuler le pointage, modifier la fiche, révoquer les liens |
| `public.ts` (réécrit) | `startPurchase`, `startBuyAndBook`, `bookWithHeldTicket`, `registerFree`, `bookRdv`, `abandonCheckout` |
| `client.ts` (nouveau) | `requireWalletOwner`, `cancelMyBooking`, modification du nom, révocation des liens |

- **Lectures** (`server-only`) :
  - `queries.ts` garde profil et tableau de bord ;
  - nouveaux : `catalog-queries.ts`, `planning-queries.ts`, `client-queries.ts` (dont
    `getMySpace`), `public-queries.ts` ;
  - les fonctions mortes `getProBookings` et `getProSessions` sont supprimées.
- **Moteur** (`src/lib/booking/`, sans `server-only`, `db` et `now` en paramètres) :
  `eligibility`, `holds`, `claims`, `cancel`, `wallet`, `fulfillment`, `occurrences`, `series`,
  `rdv`, `revenue`, `invariants`. S'y ajoutent `src/lib/db/atomic.ts` et `src/server/notify.ts`
  (`server-only`).
- **Modules purs** : `civil-date`, `recurrence`, `series-plan`, `ticket-expiry`,
  `cancellation`, `booking-window`, `guest-link`, `lanes`, `wallet-rules`, `tickets`.
- **Module DB** : `throttle` (reçoit `db`). Sa fonction de fenêtre est pure et testée.
- **Modifiés** :
  - `availability.ts` : boucle par date locale, blocage par les séances, marges, préavis et
    horizon ; l'ancienne logique de places est retirée ;
  - `planning.ts` : semaines sûres pour l'heure d'été ;
  - `slots.ts` : chargeur de créneaux RDV ;
  - `stripe.ts` : `expires_at`, moyens de paiement, `expire()` ;
  - `auth.ts` → `auth-options.ts` + `auth.ts`.
- **Supprimés** : `sessions.ts` et son test, `server/booking-core.ts` (`buildAnswers` est
  déplacé), `payments.ts`.

### 13.5 Composants

- **Supprimés** : `dashboard/event-types-manager.tsx`, `dashboard/packs-manager.tsx`,
  `public/credit-lookup.tsx`.
- **Évolués** :
  - `session-detail-dialog` → `occurrence-dialog` ;
  - `manual-booking-form` → `register-attendee-dialog` (recherche ou nouveau client ; ticket,
    ticket précis, invité ; « +1 place ») ;
  - `public/booking-flow` → `occurrence-booking` ;
  - `public/buy-pack-form` → `offer-checkout-form`.
- **Nouveaux** : `event-editor`, `recurrence-editor`, `ticket-type-editor`, `client-wallet`,
  `wallet-actions`, `ledger-list`, `time-off-conflict-dialog`, `getting-started`,
  `public-planning`, `boutique`, `rdv-booking`, `otp-dialog`, `verify-email-banner`,
  `wallet-panel`, `coverage-badge`, `owner-preview-banner`.
- **Réutilisés** : géométrie de `planning-calendar`, `week-preview`, `booking-detail-dialog`,
  `upcoming-bookings`, `session-capacity-control` (avec une portée), `weekly-hours-editor`,
  `availability-editor`, `unavailability-manager`, `public-shell`, `day-calendar`,
  `admin/filter-chips`.
- Les composants orphelins `hero-cards.tsx` et `ticket-cta.tsx` attendent toujours le feu vert du
  propriétaire. Ils ne sont pas touchés ici.

### 13.6 Emails

Dans `src/lib/emails/`, un fichier par modèle. Toute valeur interpolée passe par `escapeHtml`, tout
montant par `formatMoney(cents, currency)`, et chaque modèle a son test.

- **Client** :
  - reçu d'achat, avec l'expiration ;
  - confirmation d'inscription, quelle que soit la couverture : date, lieu, couverture, tickets
    restants et leurs expirations, délai d'annulation, lien personnel, ICS, Google, Outlook ;
  - annulation ;
  - séance modifiée, séance annulée, inscrit déplacé ;
  - paiement tardif ;
  - code de connexion, code de confirmation d'adresse, mot de passe désactivé ;
  - tickets offerts (optionnel).
- **Pro** :
  - nouvelle inscription, seulement quand c'est le client qui réserve ;
  - annulation par le client.

### 13.7 Google Agenda

- Le chargeur de `calendar-sync.ts` est indexé sur la séance.
- Un événement Google existe pour chaque séance `scheduled` avec au moins une inscription
  confirmée, et pour chaque RDV.
- Id **déterministe** : `hex(sha256(occurrence.id))`, valide en base32hex.
- Le corps envoyé porte toujours `status: "confirmed"`. Un insert qui reçoit 409 (id déjà connu,
  y compris un événement supprimé que Google garde annulé) devient un patch du **corps complet**,
  ce qui le fait réapparaître.
- 404 ou 410 à la suppression comptent comme un succès.
- `calendar-sync-core.ts`, `google-calendar.ts` et `google-event.ts` sont conservés.

### 13.8 Admin, analytique, textes

**Admin.**
- `getOverviewStats` :
  - pros actifs 30 j = pros avec au moins une inscription confirmée ou un achat payé sur 30 j ;
  - inscriptions 30 j = inscriptions `confirmed` créées sur 30 j.
- `getRevenue` utilise `paidPurchaseOf`.
- `/admin/activity` :
  - onglet **Inscriptions** : date de séance, pro, client, titre de l'événement ou du type,
    couverture, statut ∈ `booking_status` ;
  - onglet **Achats** : pro, client, libellé, montant, statut ∈ `purchase_status`, badge « Test » ;
  - `PAYMENT_TYPE_LABELS` est remplacé par `COVERAGE_LABELS`.
- Le fil d'activité affiche « Réservation · … » et « Achat · … » : « Inscription » y désigne déjà
  les créations de compte.
- `app-health-card` : places en attente de plus d'1 h, achats en attente, paiements orphelins,
  violations d'invariants, retard d'horizon.
- `getProStats` et l'impact de `delete-user-card` comptent les tickets en circulation et les
  paiements en cours.
- `admin-params.ts` et son test passent aux nouveaux enums.

**Analytique.** `RESERVED_SEGMENTS` reçoit `mon-espace`, `UNTRACKED_PREFIXES` reçoit
`/mon-espace`, et `isTrackedPath` exclut `/<slug>/espace`. Le test est mis à jour.

**Textes.**
- Landing : `src/app/page.tsx`, `landing/hero-deck.tsx`, `landing/planning-screen.tsx`, lien
  `/#packs` de `site-header`.
- Métadonnées de `layout.tsx`, `site-footer`, aperçu de `branding-form`, texte de
  `google-calendar-card`.
- Démo : `demo-data.ts`, `demo-script.ts`, écrans `pro-event-types`, `pro-packs`, `client-pack`,
  `client-booking`, et les deux tests de démo.
- Docs : README, AGENTS.md (modèle du domaine, règle `atomic()` et ordre des verrous, jamais
  `db:push`, espace client, nouvelles routes, branches Neon de travail), TODO.md.
- Les articles FAQ `ha_creer_page`, `ha_packs`, `ha_credits` et `hc_packs` sont édités à la main
  dans `/admin/support/faq`.

### 13.9 Comportements d'interface

**Valeurs par défaut.**
- Événement : durée 60 min, capacité 12, mode *Sur tickets*, début = prochaine date libre à l'heure
  cliquée, récurrence « Une fois ».
- Offre : quantité 1, sans validité.
- Type RDV libre : durée 60 min, marges 0.

**Validation.**
- Les bornes et messages viennent de `tickets.ts`. Le même schéma zod sert au client et au
  serveur.
- Enregistrer un événement *Sur tickets* sans type est autorisé : il est alors signalé « aucun
  ticket actif accepté ».

**États vides**, chacun avec un appel à l'action :

| Écran | Message |
|---|---|
| Événements | « Créez votre premier événement » |
| Tickets | « Créez un type de ticket, puis une offre » |
| Clients | « Vos clients apparaîtront ici » |
| Portefeuille | « Aucun ticket » + lien Boutique |
| RDV libre | « Aucun créneau cette semaine » + semaine suivante |
| Planning public | « Aucune séance à venir » |

**Mobile (moins de 640 px).** Planning pro en vue jour, planning public en liste par jour, fiche
client en sections empilées.

**Confirmations.** Tout geste destructif (annuler une séance, désinscrire, clore, retirer) ouvre
une confirmation qui rappelle ses conséquences : tickets rendus, emails envoyés.

## 14. Cohérence et tests

**Invariants** (`src/lib/booking/invariants.ts`), vérifiés après chaque test DB
(`checkInvariants({ proId })`) et chaque nuit :

| # | Invariant |
|---|---|
| I1 | `seats_taken` = nombre d'inscriptions pending + confirmed, pour chaque séance |
| I2 | ticket `booked` ⇔ une inscription confirmée de couverture `ticket` pointe dessus (1:1) |
| I3 | un achat payé a exactement `quantity` tickets ; un achat non payé n'en a aucun |
| I4 | le dernier mouvement (par `seq`) de chaque ticket correspond à son état et à son type |
| I5 | aucune inscription active sur une séance annulée ; RDV `scheduled` ⇔ `seats_taken = 1` |
| I6 | tout achat `paid` a `paid_at` et `fulfilled_action_id` ; tout achat `livemode` a `payment_intent_id` |

**Tests purs** (`pnpm test`, qui exclut `*.db.test.ts`) :
- récurrence : semaines à intervalle, plusieurs jours par semaine, début en milieu de semaine,
  31 sauté, n-ième et dernier jour de semaine, `until` inclus, `count` depuis le début, total
  restant après coupure, décalage et premier instant à Paris, saut arithmétique (série
  quotidienne commencée il y a 4 ans qui produit encore 400 jours), plafonds ;
- `civil-date` et expiration (fin de mois, fin de journée) ;
- délai d'annulation avec surcharges, `changed_at` et `moved_at` ;
- fenêtre de réservation (préavis, horizon, surcharges) ;
- `computeSlots` : heure d'été, blocage par les séances, marges, RDV occupés ;
- navigation de semaine à travers l'heure d'été ;
- `series-plan` (y compris `cancelEmpty`) ; `wallet-rules` (alertes, ordre) ; `guest-link`
  (falsification, version) ;
- dérivation de `disabledPaths` ; traduction des erreurs ; échappement des emails ; routage
  d'entrée ; chemins suivis ; fenêtre de `throttle` ; `lanes` ; constantes d'horizon.

**Tests DB** :
- Commande : `pnpm test:db` = `tsx --env-file-if-exists=.env.test --test --test-concurrency=1
  "src/**/*.db.test.ts"`.
- `.env.test` (non versionné) contient :
  - `DATABASE_URL` = `DATABASE_URL_TEST` = URL de `tickets-test` ;
  - un `BETTER_AUTH_SECRET` de test ;
  - Resend et Stripe en placeholder.
- Harnais `src/test/db.ts` :
  - il saute si `DATABASE_URL_TEST` est absent ;
  - il refuse de tourner si l'hôte de `DATABASE_URL` diffère de celui de `DATABASE_URL_TEST` ;
  - il n'importe la base qu'après ces gardes ;
  - chaque test crée son pro et supprime son utilisateur à la fin.

| # | Cas | Attendu |
|---|---|---|
| T1 | 20 dépenses concurrentes sur 5 places | exactement 5 |
| T2 | 3 tickets, 10 réservations concurrentes | 3 |
| T3 | annulations client et pro simultanées | un seul retour |
| T4 | double fulfillment concurrent | N tickets, une fois |
| T5 | nettoyage puis paiement tardif | N disponibles, inscription expirée |
| T6 | RDV concurrents sur le même créneau ; RDV sur un événement ; RDV face à une indisponibilité | un seul gagne ; `slot_taken` ; sérialisé |
| T7 | annulation de séance pendant des prises de place | I5 tient |
| T8 | coupure pendant une prise de place ; coupure contre `ensureHorizon` | `stale`, relance, inscription préservée ; aucune séance fantôme |
| T9 | conversion contre dépense ; deux conversions identiques concurrentes ; retirer un ticket payé | un seul effet ; refusé |
| T10 | lot d'indisponibilité contre une prise de place | `stale` ou `unavailable` |
| T11 | `deleteUser` sur un pro entièrement peuplé | passe |
| T12 | compte à mot de passe, puis code de connexion, via `auth.handler` | `credential` supprimé, autres sessions révoquées, nouvelle session conservée |
| T13 | 6 demandes de code dans l'heure | pas de 6e envoi ; le code du 1er envoi fonctionne encore |
| T14 | achat + réservation payé | N tickets, n° 1 `booked`, inscription confirmée, un mouvement par ticket |
| T15 | utilisateur connecté non vérifié qui confirme son adresse | `credential` conservé, `emailVerified = true` |

## 15. Livraison

### 15.1 Découpage en plans

La spec est unique, car le modèle doit rester cohérent. L'implémentation est découpée en **plans
successifs** sur la branche d'intégration `feat/tickets-events`. Chaque plan est écrit quand le
précédent est terminé : les plans 3 à 5 consomment l'API du moteur figée par le plan 2. Rien ne
part en prod avant le plan 6, sauf le plan 0.

| Plan | Contenu | Où |
|---|---|---|
| **P0 — Correctifs immédiats** | Heure d'été (navigation et bornes du planning, `computeSlots` par date locale, tests Paris 2026-03-29 et 2026-10-25) ; échappement HTML des emails ; route simulée coupée **si `STRIPE_ENABLED`** et redirection limitée au même domaine ; `vercel.ts` `git.deploymentEnabled: false` ; PR pour `ab56600` | `main`, **en prod avant le 25/10/2026** |
| **P1 — Spike** (go / no-go) | `scripts/spike-batch.ts` sur la branche jetable `spike-batch`, points S1 à S8 ci-dessous ; résultat consigné en § 10 avant P2 | branche Neon jetable |
| **P2 — Domaine** | Migrations 0010 à 0012 (§ 15.2) ; `atomic.ts` ; **tout** `src/lib/booking/*` (E1 à E13 sans UI) ; modules purs ; `auth-options.ts` (emailOTP, hooks, rate limit) ; harnais et tests T1 à T15 ; seed v2 complet ; neutralisation de l'existant (§ 15.3) | `feat/tickets-events` |
| **P3 — Back-office pro** | Tickets, Événements (éditeur, récurrence, aperçu), planning et fiche séance, indisponibilités, réglages, clients et fiche client, Paiements, KPI, admin ; emails de modification et d'annulation ; `/api/c` et `/[slug]/espace` en lecture ; Google indexé sur la séance | idem |
| **P4 — Public, paiements, identité** | `/[slug]` Planning + Boutique, pages séance et offre, `merci`, webhooks et route simulée, abandon, tâche de nuit, limites ; `OtpDialog`, bandeaux de confirmation, `/mon-espace`, `/[slug]/espace` complet (annulation, dépense) ; reçus et confirmations | idem |
| **P5 — RDV libre** | Créneaux bloqués par les séances, avec marges, préavis et horizon ; `/[slug]/rdv` (ticket, achat, gratuit) ; tests EXCLUDE dans l'UI | idem |
| **P6 — Textes et mise en ligne** | Démo, landing, FAQ, README, AGENTS.md, code mort ; mise en ligne (§ 15.5) | idem, puis prod |

**Spike P1** :
- S1 : un `skedul_assert` qui lève annule les requêtes précédentes du lot ;
- S2 : la requête 2 voit une ligne validée par une autre connexion pendant que la requête 1
  attendait un verrou ;
- S3 : `FOR UPDATE SKIP LOCKED` fonctionne dans un lot ;
- S4 : les éléments `db.execute(sql)` paramétrés, y compris `WITH … UPDATE … RETURNING … INSERT`,
  fonctionnent dans un lot ;
- S5 : `btree_gist` et l'EXCLUDE sont acceptés par Neon ;
- S6 : les FK NO ACTION survivent à la cascade de `deleteUser` ;
- S7 : `code` et `constraint` remontent dans les erreurs neon-http ;
- S8 : les options emailOTP (`storeOTP: "encrypted"`, `resendStrategy`,
  `overrideDefaultEmailVerification`) se comportent comme décrit, et une connexion par code purge
  le mot de passe d'un compte non vérifié. Le spike le faisait dans `user.update.after`, avec
  `ctx.context.newSession` ; le code final purge dans `user.update.before` (§ 12).

Plan B si un point S1 à S7 échoue : une fonction plpgsql par parcours, puis un Pool par requête.

### 15.2 Migrations

1. **0010** : retirer de `schema.ts` les 9 tables et les 3 enums (garder `question_type` et
   `user_role`), puis `drizzle-kit generate --name=domain_drop`.
2. **0011** : ajouter le nouveau schéma, puis `drizzle-kit generate --name=tickets_schema`. Les deux
   étapes séparées évitent les questions interactives de renommage.
3. **0012** : `drizzle-kit generate --custom --name=tickets_manual`, puis coller le SQL du § 6.5.
4. Appliquer avec `db:apply` sur `tickets-dev`. Créer ou réinitialiser `tickets-test` depuis
   `tickets-dev` après chaque nouvelle migration.
5. **À chaque rebase sur `main`** : si `main` a ajouté des migrations, supprimer de la branche les
   fichiers 0010 à 0012, leurs snapshots et leurs entrées de journal, puis régénérer. Ensuite,
   réinitialiser `tickets-dev` depuis son parent et réappliquer.
6. `buildCommand` reste `pnpm db:migrate && pnpm build`. Le même commit est d'abord déployé en
   preview (même commande), ce qui valide le build avant la prod. Inverser l'ordre ferait échouer
   toute page prérendue qui lirait le nouveau schéma.

### 15.3 Neutralisation de l'existant (P2)

Ces modules lisent les tables supprimées. En P2, ils sont remplacés par un bouchon qui renvoie
« vide » ou « bientôt disponible », puis réécrits dans le plan indiqué :
- **P3** : `queries.ts` (tableau de bord, clients, planning), `pro.ts` (actions du domaine),
  `admin-queries.ts` (`getOverviewStats`, `getRevenue`, `getRecentActivity`, `getAppHealth`,
  `listRecentBookings`, `listRecentPurchases`, `getProStats`, `getDeletionImpact`),
  `/admin/activity`, `calendar-sync.ts`, `calendar.ics` ;
- **P4** : `public.ts`, le webhook Stripe, `mock-checkout` ;
- **P5** : `slots.ts`.

### 15.4 Seed v2 et contenu

**Seed** (`scripts/seed.ts`), entièrement passé par le moteur, avec une horloge injectée pour
l'historique.
- **Garde-fous** :
  - il refuse de tourner si l'hôte de `DATABASE_URL` n'est pas dans `SEED_ALLOWED_HOSTS`, ou si
    `APP_ENV=production` ;
  - `--wipe` supprime seulement les utilisateurs de démo (`@skedul.app`, `@skedul.test`) et donc,
    par cascade, leurs pages. Jamais de `TRUNCATE "user"`.
- **Contenu** : partagé dans `scripts/content/altinha.ts`, utilisé aussi par
  `bootstrap-content`.
  - Types et offres :
    - Cours collectif : unité 25 €, carnet de 4 à 85 € (3 mois), carnet de 10 à 190 € (6 mois) ;
    - Cours d'essai : 15 € ;
    - Cours particulier : RDV libre 60 min, unité 50 €, carnet de 5 à 225 € (6 mois) ;
    - Appel découverte : RDV libre gratuit 15 min.
  - Événements :
    - Altinha débutants : lun et mer 19:00, 60 min, 12 places, accepte collectif et essai ;
    - Intermédiaires : mar et jeu 19:00, 90 min, 12 places, collectif ;
    - Roda libre : un samedi sur deux à 15:00, 120 min, 30 places, inscription libre ;
    - Atelier technique : 1er dimanche du mois à 14:00, 120 min, 10 places, collectif ;
    - Équipe compétition : ven 20:00, 90 min, 8 places, privé, collectif.
  - Données du seed uniquement :
    - portefeuilles avec tickets utilisés, offerts, expirés, clos et convertis ;
    - inscriptions passées et à venir ;
    - une séance annulée, une indisponibilité ;
    - les deux cas d'alerte.

**`scripts/bootstrap-content.ts --pro <slug>`** crée **uniquement le catalogue** :
- types, offres, événements (récurrence, liens, questions) ;
- horaires de disponibilité (globaux et par type) et réglages de réservation.

Il ne crée ni client, ni achat, ni ticket, ni inscription, ni indisponibilité, et n'envoie aucun
email. Il refuse si ce pro a déjà des données du domaine.

Exécution en prod : `vercel env pull --environment=production .env.prod.local`, puis
`DATABASE_URL` surchargé pour cette seule commande.

### 15.5 Mise en ligne (P6)

1. Branche Neon de sauvegarde `pre-tickets` depuis `main`.
2. `pnpm deploy:preview` (migration de la preview, puis build), puis `seed --wipe` sur la
   preview.
3. Recette en mode simulé, puis en mode test Stripe, avec `expired`, `async_payment_succeeded` et
   `async_payment_failed` activés sur l'endpoint.
4. Prod :
   - clés Stripe de test et événements webhook. La route simulée est alors coupée. Un bandeau
     « Paiements en mode test » s'affiche sur les pages d'achat tant que les clés ne sont pas
     live ;
   - `CRON_SECRET` ;
   - domaine Resend `myskedul.com` vérifié ;
   - comptes admin et pro existants confirmés (§ 12) ;
   - `pnpm deploy:prod`, qui supprime les données de test du domaine ;
   - `checkInvariants`, et vérifier que la tâche de nuit est enregistrée ;
   - `bootstrap-content --pro altinha-paris` sur le compte du propriétaire ;
   - éditer la FAQ.
5. **Passage aux clés live**, quand le propriétaire le décide : un script clôt les tickets des
   achats `livemode = false` (motif `autre`, note « mode test »), et le bandeau disparaît.

## 16. Risques

| # | Risque | Parade |
|---|---|---|
| 1 | Comportement lot / verrous / instantanés non encore vérifié sur Neon | Le spike P1 conditionne P2 ; plan B : plpgsql, puis Pool |
| 2 | SQL manuel invisible pour drizzle-kit | `db:push` retiré ; 0012 journalisée ; T6 échoue si l'EXCLUDE disparaît |
| 3 | Migration destructive | Branches de travail dédiées, sauvegarde, même commit validé en preview d'abord, correctif `vercel.ts` |
| 4 | Délivrabilité : codes et vérification dépendent du domaine Resend ; consentement Google en mode Test | Condition de mise en prod de P4 |
| 5 | « Cette séance et les suivantes » est le parcours le plus complexe | Planificateur pur, aperçu, `stale` avec nouveau plan, T8 |
| 6 | Interblocages | Ordre de verrouillage fixe et une relance |
| 7 | Le hook anti-pré-compte supprime le mot de passe d'un utilisateur non vérifié qui se connecte par code depuis l'état déconnecté | Bandeau de confirmation par code pour les connectés (sans effet sur le mot de passe) ; comptes existants confirmés avant P4 ; email explicatif |
| 8 | Inscriptions libres remplies par des adresses jetables | Limites ; le pro peut désinscrire ; confirmation par email possible plus tard |
| 9 | Le lien personnel est un jeton au porteur | Lecture + annulation seulement, révocable, cookie limité au chemin du pro |
| 10 | Paiement carte uniquement pour l'achat + réservation : comportement d'Apple Pay et Google Pay | À vérifier en P4 |
| 11 | Limites des crons Vercel | La correction ne dépend jamais de la tâche de nuit |
| 12 | Droit de la consommation sur l'expiration des prestations prépayées, non vérifié | Validité par défaut « sans expiration » ; à valider par le propriétaire avant des expirations courtes |
| 13 | Valeur stockée sur le compte plateforme tant que Connect reste un stub | Inchangé par rapport à aujourd'hui |
| 14 | Achats en clés de test sur la prod | `livemode`, badge « Test », clôture au passage en live |
| 15 | Branche longue avec des sessions parallèles sur le dépôt | Worktree et bases Neon dédiés, rebase à chaque plan |

## 17. Journal des décisions

| Décision | Choix | Alternative écartée | Pourquoi |
|---|---|---|---|
| Séances | Lignes matérialisées sur 400 j glissants ; RDV créé à la réservation | Expansion virtuelle, ou création à la première réservation | Les cours vides doivent être visibles, modifiables et annulables ; un seul id pour places, inscriptions, Google et liens |
| Identité de séance | `series_date` (date locale) | `original_start_at` (instant) | Résiste aux déplacements |
| Stockage de récurrence | Colonnes typées + expandeur pur à saut arithmétique | Texte RRULE + bibliothèque `rrule` | Contrôlable par CHECK, colle au formulaire ; `rrule` absent |
| Heure inexistante | Décalage vers l'avant (RFC 5545) | Sauter la date | Le cours a lieu ; identique à Google |
| Exceptions de séance | `time_detached`, `capacity_override`, `location_override` séparés | Un seul `detached` | Une capacité modifiée ne doit pas figer l'horaire face à une coupure |
| Portefeuille | Une ligne par ticket + registre ordonné par `seq` | Lots avec compteurs | 1:1 avec l'inscription, pas de sur-restitution, conversion qui garde paiement et expiration |
| Atomicité | Un `db.batch` par parcours : verrous d'abord, petites requêtes, assertions qui lèvent, ids JS, marques ciblées, horloge injectée | Transactions par Pool WebSocket | Cycle de vie du Pool sur Fluid non vérifié ; testable avec des dates passées |
| Gardes | Sur les lignes marquées par l'`aid` (registre, `ended_action_id`, `last_action_id`) | Compter les lignes dans l'état cible | Une action identique concurrente passerait |
| Écritures en éventail | Lot qui verrouille d'abord le parent | Une grande CTE | Un instantané unique rate les inscriptions validées pendant l'attente du verrou |
| Compteur de places | `seats_taken` + CHECK ; `SEAT` une fois par séance et par action | `seats_remaining` gardé seulement | Le CHECK lève dans un lot ; pas de double déduction |
| Double RDV | EXCLUDE (btree_gist) RDV/RDV + verrou pro face aux indisponibilités + garde événement | EXCLUDE RDV/événement | Garantie base là où les clients se concurrencent ; le pro reste libre de poser un événement sur un RDV |
| Génération des séances | `ensureHorizon` gardé par `version`, `after()` seulement si en retard | Insertion libre | Une coupure concurrente ne crée pas de séances fantômes ; un rendu n'écrit presque jamais |
| Masquage sous indisponibilité | Filtre à la lecture + garde à la prise de place en ligne | Statut stocké `off` | Rien qui dérive |
| Indisponibilité sur séances réservées | Le pro choisit Annuler ou Garder | Annulation automatique | Décision « propose » |
| Coupure : dates qui disparaissent | Réservées : gardées isolées (défaut) ou annulées ; vides avec historique : annulées ; vides sans historique : supprimées | Suppression systématique | « Les inscrits restent inscrits » ; FK NO ACTION |
| Éditeur d'événement | Champs descriptifs, mode, types, capacité en place ; horaire et récurrence par coupure | Tout par coupure | Pas de segments inutiles pour une faute de frappe |
| Durées de blocage | Place 45 min ; Stripe `expires_at` 31 min ; boutique 24 h explicites | Défauts | Minimum Stripe de 30 min ; tâche de nuit fiable |
| Abandon | POST qui appelle `sessions.expire` puis libère | Libération sur le GET de `cancel_url` | La session reste payable ; préchargement de liens |
| Paiement tardif ou différé | Fulfillment depuis `pending` ou `expired` ; tickets au portefeuille ; inscription jamais ressuscitée ; `processing_at` | Ressusciter l'inscription | Risque de surréservation |
| Idempotence du fulfillment | Transition gardée + assertion `fulfilled_action_id` ; un seul mouvement par ticket | Mouvements `purchase` + `spend` | UNIQUE `(action_id, ticket_id)` |
| Paiements orphelins | 200 + log + compteur santé | Erreur | Stripe arrêterait sinon après de vains essais ; remboursement manuel |
| Validité | `expires_at > début de séance` ; le pro peut garder ou forcer | Valide à la réservation | Décision 8 ; le changement vient du pro |
| Archivage | Type : `archived_at`, offres et liens intacts ; offre : `archived_at` | Désactiver les offres, supprimer les liens | Désarchiver restaure tout |
| Offres à 0 € | Interdites ; gratuit via « Offrir », inscription libre ou RDV gratuit | Autorisées | Sinon n'importe qui crée des tickets |
| Politique de FK | CASCADE depuis `professional` ; NO ACTION dans le domaine ; SET NULL vers `user` et vers `question` (réponses) | RESTRICT | Protège l'historique ; NO ACTION est vérifié après les cascades |
| Preuve client | emailOTP chiffré, renvoi du même code | magicLink ; OTP haché | Fonctionne dans la page ; une limite ne grille pas le code envoyé |
| Vérification d'adresse | Par code, dans la page connectée | Lien | Un antivirus qui précharge les liens validerait le compte d'un intrus |
| Mot de passe comme preuve | Seulement sur email confirmé | Toute session à mot de passe | Faille de pré-compte |
| Limites de débit | Stockage base Better Auth (`enabled: true`, fenêtre 600 s) + table `throttle` | Mémoire | Par instance en serverless |
| Lien personnel | Jeton HMAC → `/api/c` → cookie limité au chemin ; lecture + annulation ; révocable | Jeton dans le chemin, ou lien par inscription | Couvre inscriptions et tickets ; jamais dans un chemin suivi |
| Espace client | `/mon-espace` + `/[slug]/espace`, formulaire de code sur place | Redirection vers `/sign-in` | La connexion pro n'offre pas le code |
| Propriétaire sur sa page | Bandeau d'avertissement, formulaires actifs | Formulaires désactivés | Le pro doit pouvoir tester son parcours |
| Annulation après changement par le pro | Autorisée jusqu'au début (`changed_at`, `moved_at`) | Délai maintenu | Le client n'a pas choisi le nouvel horaire |
| Horizons | Réglage pro + surcharges par événement et type RDV (les trois réglages) ; matérialisation constante 400 j | Horizon fixe | Demande du propriétaire |
| Fuseau | Verrouillé tant que des séances existent | Recaler les séances | Rare ; évite des heures mêlées |
| Mode Stripe | `livemode` sur l'achat | Rien | Prod lancée en clés de test |
| Emplacement du moteur | `src/lib/booking/*` (db et now en paramètres, sans `server-only`) ; `auth-options.ts` | `src/server/*` | Testable en DB avec tsx |
| Noms de tables | `ticket_offer`, `ticket_purchase` | `offer`, `purchase` | Pas de collision avec la future facturation SaaS des pros |
| Livraison | Une spec, sept plans successifs | Un seul plan | Trop gros ; le spike conditionne le moteur |
| Déploiements | `vercel.ts` `deploymentEnabled: false` ; même commit validé en preview avant la prod | Auto-déploiement preview ; build puis migration | AGENTS.md ; une page prérendue pourrait lire le nouveau schéma |
| Route simulée | Coupée dès que Stripe est actif | Coupée seulement en production | En P0 la prod n'a pas encore de clés : la couper casserait les achats |
| Paiement au lancement | Stripe activé en prod (clés de test d'abord) | Lancer sans paiement | Choix du propriétaire |
