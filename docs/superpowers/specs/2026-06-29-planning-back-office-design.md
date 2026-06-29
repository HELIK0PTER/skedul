# Planning back-office — Design

> Spec du **#14** de [TODO.md](../../../TODO.md) : « Vue calendrier du planning (back-office) ».
> Périmètre validé : une page **Planning** dédiée avec un calendrier **semaine** affichant
> séances de groupe, RDV 1:1 et indisponibilités, plus des actions d'organisation des groupes
> (détail de séance, ajustement de capacité, déplacement d'inscrit, annulation, inscription
> manuelle).
>
> Date : 2026-06-29.

## Problème

Le pro n'a aujourd'hui aucune visualisation agenda. La page **Réservations**
([bookings/page.tsx](../../../src/app/dashboard/bookings/page.tsx)) liste les séances de
groupe (roster + réponses au questionnaire) et les réservations à venir/passées sous forme
de listes, mais rien ne donne une vue d'ensemble temporelle « qu'est-ce qui se passe cette
semaine », ni d'outils pour réorganiser les groupes (déplacer un élève vers le bon niveau,
inscrire quelqu'un à la main, annuler).

Le métier de référence (cours d'altinha en petits groupes par niveau, créneaux fixes matin
10h/11h/12h et soir 17h30/18h30/19h30, lun-sam) a besoin d'un **planning hebdomadaire**
lisible et actionnable.

## Décisions validées

1. **Placement** : nouvelle page dédiée **« Planning »** ; la page Réservations reste la
   liste détaillée (consultation/historique).
2. **Vue principale** : **semaine** (colonnes = jours, lignes = heures). Repli en vue jour au
   mobile.
3. **Contenu de la grille** : séances de groupe + RDV 1:1 + **indisponibilités grisées**.
   **Pas** d'affichage des créneaux vides disponibles.
4. **Actions** (les 4) : voir le détail d'une séance, ajuster la capacité, déplacer un
   inscrit, annuler / inscrire à la main.
5. **Rendu** : grille **maison** (CSS grid + Tailwind), aucune librairie calendrier (cohérence
   avec les primitives bespoke, l'AGENTS.md déconseille l'ajout de dépendances).
6. **Déplacement d'inscrit** : via **dialog + menu « Déplacer vers… »** (pas de glisser-déposer).
7. **Inscription manuelle** : bouton « + » → formulaire ; les créneaux proposés sont **calculés
   par le moteur de disponibilité existant** (intégrité, pas de surbooking).

## Contraintes structurantes

- **Neon HTTP** (`drizzle-orm/neon-http`) : pas de transactions interactives. Toute opération
  de siège réutilise les helpers atomiques existants
  ([sessions.ts](../../../src/lib/sessions.ts)) : `claimSeat` (upsert gardé
  `ON CONFLICT … WHERE seats_remaining > 0`) et `releaseSeat` (UPDATE gardé `< capacity`).
- **Temps** : tout est stocké en `timestamptz` (instants) et affiché dans `pro.timezone` via
  `@date-fns/tz` (déjà présent). Aucune nouvelle dépendance.
- **Modèle unifié** : depuis la fusion cours de groupe, chaque réservation pointe une
  `class_session` (1:1 = capacité 1, groupe = capacité N). Le calendrier est donc piloté par
  une **source unique** : les `class_session`.

## Architecture — 3 unités

| Unité | Rôle | Dépend de |
|---|---|---|
| **1. Vue semaine (lecture)** | Query semaine + grille + navigation | socle |
| **2. Détail de séance** | Dialog au clic (roster, réponses, capacité) | unité 1 |
| **3. Actions d'organisation** | Server actions atomiques (déplacer, annuler, inscrire) | unités 1-2 |

Chaque unité est testable et livrable indépendamment. L'unité 3 peut elle-même être
découpée action par action au moment du plan d'implémentation.

## Données (socle, unité 1)

### Nouvelle query `getProPlanningWeek(proId, startAt, endAt)`

Dans [queries.ts](../../../src/server/queries.ts). Renvoie pour la fenêtre `[startAt, endAt)` :

- **`sessions`** : toutes les `class_session` du pro dans la fenêtre, **capacité ≥ 1**
  (inclut donc les 1:1), avec `id`, `startAt`, `endAt`, `capacity`, `seatsRemaining`,
  `eventTypeId`, `eventTitle`, `eventColor`, et `attendees` :
  `{ bookingId, name, email, status, paymentType, answers: { label, value }[] }`.
  Même logique de jointure que `getProSessions` (bookings `pending|confirmed` → customer →
  bookingAnswer) mais **bornée à la fenêtre** et **sans filtre `capacity > 1`**.
- **`timeOff`** : les lignes `timeOff` du pro dont l'intervalle chevauche `[startAt, endAt)`.

> Note legacy : les réservations très anciennes sans `sessionId` (antérieures au backfill)
> n'apparaissent pas. Sans impact : le planning est tourné vers le présent/futur, et le
> backfill a peuplé les réservations futures `pending|confirmed`.

### Helpers purs `src/lib/planning.ts` (+ `planning.test.ts`)

Logique pure, testable sans base ni fuseau réseau :

- `weekBounds(date, timezone)` → `{ start, end }` instants du lundi 00:00 au lundi suivant
  00:00, dans le fuseau du pro (via `@date-fns/tz`).
- `weekDays(start, timezone)` → les 7 `Date` de jour (lun→dim) pour les en-têtes de colonnes.
- `blockPosition(startAt, endAt, dayStart, timezone)` → `{ topMinutes, heightMinutes }`
  (minutes depuis le début de journée affiché) pour positionner un bloc.
- `gridRange(events)` → `{ minHour, maxHour }` : borne dynamique calculée sur les événements
  de la semaine, fenêtre par défaut **8h–21h**, élargie si un événement déborde.
- `groupByDay(events, timezone)` → map `dayKey → events[]`.

## Unité 1 — Vue semaine

- **Page** `src/app/dashboard/planning/page.tsx` (server component) :
  - `searchParams` (async, Next 16) : `week=YYYY-MM-DD` (défaut = aujourd'hui).
  - Calcule `weekBounds`, appelle `getProPlanningWeek`, sérialise (ISO + tz) vers le client.
- **Navigation** : liens `← / Aujourd'hui / →` qui changent `?week=` (re-fetch serveur, pas
  d'état client). Affiche la plage de la semaine en libellé.
- **Composant** `src/components/dashboard/planning-calendar.tsx` (client) :
  - Grille CSS `7 colonnes (lun→dim) × heures` (de `minHour` à `maxHour`), blocs positionnés
    en absolu via `blockPosition`.
  - **Séance groupe** (cap > 1) : bloc à la couleur de la prestation + badge `X/N inscrits`.
  - **RDV 1:1** (cap = 1) : bloc coloré + nom du client.
  - **Indispo** : bloc grisé/hachuré, non cliquable.
  - Clic sur une séance → ouvre le dialog détail (unité 2).
  - **Mobile** : repli en **vue jour** (une colonne + sélecteur de jour).
  - **Vide** : « Aucune séance cette semaine. »
- Bouton **« + Inscrire »** en tête de page → formulaire d'inscription manuelle (unité 3).

## Unité 2 — Détail de séance

- **Nouveau primitive** `src/components/ui/dialog.tsx` (modale légère, style maison ;
  n'existe pas encore — `ui/` n'a que avatar/badge/button/card/input/label/logo/popover/
  select/slot/textarea).
- **Composant** `src/components/dashboard/session-detail-dialog.tsx` (client). Données déjà
  fournies par la query semaine (pas de fetch supplémentaire). Contenu :
  - Titre prestation, date/heure (`formatSlot`), remplissage `X/N`.
  - Contrôle de capacité : réutilise
    [`SessionCapacityControl`](../../../src/components/dashboard/session-capacity-control.tsx).
  - Liste des inscrits + leurs réponses au questionnaire ; par inscrit : menu
    **« Déplacer vers… »** (autres séances de la semaine) et **« Désinscrire »**.
  - Bouton **« Annuler la séance »**.

## Unité 3 — Actions d'organisation

Toutes dans [pro.ts](../../../src/server/pro.ts), `"use server"`, vérifient que le pro courant
possède la séance/réservation (`getCurrentProfessional`), renvoient `{ ok, error }`
(convention existante) et appellent `revalidatePath("/dashboard/planning")`.

### `moveAttendee(bookingId, targetSessionId)`

1. Charger le booking (vérif appartenance pro) + sa séance source.
2. Charger la séance cible (vérif appartenance pro). Si même séance → no-op.
3. **`claimSeat`** sur la cible (avec `eventTypeId/startAt/endAt/capacity` de la cible) :
   - `{ok:false}` (cible pleine) → abort, **aucun changement**, message « Séance complète ».
   - `{ok:true}` → continuer.
4. **`releaseSeat(sourceSessionId)`**.
5. Maj du booking : `sessionId`, `startAt`, `endAt`, `eventTypeId` ← valeurs de la cible.

Ordre « claim d'abord » : garantit qu'on ne libère le siège source que si la cible est
acquise.

### `cancelBooking(bookingId)`

- Statut → `cancelled` + `releaseSeat(sourceSessionId)`.
- Si `paymentType === "credit"` → re-créditer le `packPurchase` lié (`creditsRemaining + 1`,
  UPDATE gardé).
- Paiement direct : pas de remboursement automatique (hors périmètre, cf. TODO #13).

### `cancelSession(sessionId)`

- Pour chaque réservation `pending|confirmed` de la séance : même traitement que
  `cancelBooking` (statut + release + re-crédit éventuel).
- La séance peut être conservée (sièges revenus à `capacity`) ou marquée close ; choix
  d'implémentation au plan. Remboursements directs hors périmètre.

### `createManualBooking({ eventTypeId, day, customerName, customerEmail, answers })`

- Le formulaire « + » calcule les **créneaux disponibles du jour choisi** via le moteur
  existant (`loadBookableSlots` / `computeSlots`,
  [slots.ts](../../../src/lib/slots.ts) + [availability.ts](../../../src/lib/availability.ts))
  → le pro choisit un créneau (intégrité : respecte buffers, capacité, collisions).
- À la validation : find-or-create `customer` (par email, scope pro) → `claimSeat` →
  insert `booking` `confirmed` `paymentType: "free"` (+`sessionId`) → insert `bookingAnswer`
  (validation des questions `required`) → `fulfillBooking`
  ([payments.ts](../../../src/lib/payments.ts), idempotent, envoie la notif pro existante).
- **Composants** : `manual-booking-form.tsx` (+ sélecteur de créneau du jour).

## Erreurs & concurrence

- Course sur le dernier siège tranchée par `claimSeat` (un gagnant ; l'autre `{ok:false}`
  → « complet »). Idiome déjà en place pour la réservation publique.
- Les server actions renvoient `{ ok, error }` ; le dialog / formulaire affiche l'erreur en
  inline. Aucune transaction interactive (contrainte Neon HTTP respectée).

## UI / cohérence

- Réutilise les primitives bespoke (`Card`, `Badge`, `Button asChild`, `Select`) et le thème
  violet / `brandThemeVars` du pro déjà appliqué au dashboard.
- Nouvelle entrée de menu **« Planning »** (icône `CalendarRange`) dans
  [sidebar.tsx](../../../src/components/dashboard/sidebar.tsx), après « Réservations ».
- Libellés en **français**, cohérents avec l'existant.

## Tests

- `planning.test.ts` : `weekBounds`/`weekDays` (fuseau, passage minuit), `blockPosition`
  (minutes/jour), `gridRange` (fenêtre par défaut + élargissement), `groupByDay`.
- `moveAttendee` : cible pleine → abort sans changement ; succès → source libérée + booking
  ré-affecté. Logique unitaire ; `claimSeat`/`releaseSeat` réels déjà couverts en intégration.
- `pnpm typecheck` + `pnpm build` + tests restent verts.

## Fichiers (création / modification)

**Nouveaux :**
- `src/app/dashboard/planning/page.tsx`
- `src/components/dashboard/planning-calendar.tsx`
- `src/components/dashboard/session-detail-dialog.tsx`
- `src/components/dashboard/manual-booking-form.tsx`
- `src/components/ui/dialog.tsx`
- `src/lib/planning.ts` + `src/lib/planning.test.ts`

**Modifiés :**
- `src/server/queries.ts` → `getProPlanningWeek`
- `src/server/pro.ts` → `moveAttendee`, `cancelBooking`, `cancelSession`, `createManualBooking`
- `src/components/dashboard/sidebar.tsx` → entrée « Planning »

## Hors périmètre (YAGNI)

- Glisser-déposer des inscrits (menu « Déplacer vers… » suffit).
- Affichage des créneaux disponibles vides sur la grille.
- Remboursement automatique des paiements directs à l'annulation (TODO #13).
- Vues mois / multi-semaines, export iCal, récurrence (#11), liste d'attente (#10).
