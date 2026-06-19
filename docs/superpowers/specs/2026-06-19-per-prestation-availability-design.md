# Disponibilités personnalisées par prestation — Design

**Date:** 2026-06-19
**Statut:** Approuvé

## Problème

Aujourd'hui un pro a **un seul planning hebdomadaire global** (`availabilityRule`
keyé par `professionalId`). Toutes les prestations partagent ces horaires.

Un pro veut pouvoir donner à **une prestation donnée** ses propres horaires —
ex. « pour cette presta je suis dispo le dimanche, mais pas pour les autres ».

## Décisions (validées en brainstorming)

1. **Remplacement total** : si une prestation définit ses propres horaires, le
   planning global est *ignoré* pour cette presta — elle utilise uniquement son
   planning. (Pas de surcouche additive, pas de restriction du global.)
2. **Horaires inline par presta** : chaque prestation a un interrupteur
   « Horaires personnalisés » dans son formulaire (back-office). Pas de plannings
   nommés réutilisables (hors périmètre).

## Modèle de données

Pas de nouvelle table. On ajoute une colonne nullable à `availabilityRule`
(`src/lib/db/schema.ts`) :

```
availability_rule
  + eventTypeId  text  NULL  → references event_type(id) ON DELETE CASCADE
  + index availability_event_type_idx on (eventTypeId)
```

Sémantique d'une ligne :

- `eventTypeId IS NULL` → **règle globale** du pro (comportement actuel, inchangé).
- `eventTypeId = X`     → règle propre à la prestation X.

Migration **additive et rétrocompatible** : toutes les règles existantes ont
`eventTypeId = NULL`, donc restent globales. Aucune donnée à backfiller.

FK `ON DELETE CASCADE` : supprimer une prestation supprime automatiquement ses
règles personnalisées.

Relations Drizzle : ajouter `availabilityRules: many(availabilityRule)` à
`eventTypeRelations`, et `eventType: one(eventType, …)` à
`availabilityRuleRelations` (nouvelle relation). Non strictement requis pour la
logique (on requête à plat) mais cohérent avec le reste du schéma.

## Résolution des règles (remplacement total)

Logique centralisée dans `loadBookableSlots` (`src/lib/slots.ts`), qui alimente
**à la fois l'affichage public et la garde anti-race** `isSlotAvailable`. Toute
la sémantique vit donc à un seul endroit.

- `EventTypeLike` gagne `id: string` (déjà disponible sur tous les call sites :
  page `book/[eventTypeId]` et `public.ts` passent la ligne `eventType` complète).
- Requête : charger les règles du pro où
  `professionalId = pro AND (eventTypeId IS NULL OR eventTypeId = evt.id)`,
  puis partition en mémoire :
  - s'il existe **au moins une** règle avec `eventTypeId = evt.id` → utiliser
    *uniquement* celles-là (remplacement total) ;
  - sinon → utiliser les règles globales (`eventTypeId IS NULL`).

`computeSlots` (`src/lib/availability.ts`) **n'est pas modifié** : il reçoit
simplement le bon jeu de `rules`.

### Cas « personnalisé mais vide »

Le modèle représente « personnalisé » par *l'existence de lignes*
`eventTypeId = X`. Donc « toggle ON mais aucune plage » = aucune ligne = retombe
sur le global. Pour éviter ce piège silencieux, le **formulaire exige au moins
une plage** quand l'interrupteur est ON (sinon il est traité comme OFF). Une
presta « jamais réservable » se gère en la rendant inactive (`isActive=false`),
pas via un planning vide.

## Server actions & queries

### `src/server/pro.ts`

- **`saveEventType`** — on intègre la dispo à l'upsert de la prestation (atomicité
  raisonnable, pas de transaction interactive sur Neon HTTP, cohérent avec le
  pattern delete+insert existant). Nouveau champ d'entrée :

  ```ts
  availability?: { customized: boolean;
                   rules: { dayOfWeek: number; startMinute: number; endMinute: number }[] }
  ```

  Après upsert (le chemin `insert` gagne `.returning({ id })` pour connaître l'id
  d'une nouvelle presta) :
  1. `DELETE availability_rule WHERE eventTypeId = id` (purge des règles de la presta) ;
  2. si `customized && rules` non vide → insérer les règles valides
     (`endMinute > startMinute`) avec `eventTypeId = id`.

- **`saveAvailability`** (éditeur global) — **bug à corriger** : aujourd'hui il
  fait `DELETE … WHERE professionalId = pro.id`, ce qui effacerait *aussi* les
  règles par-presta. Scoper le delete à `… AND eventTypeId IS NULL`. Les insertions
  globales mettent `eventTypeId = null`.

### `src/server/queries.ts`

- **`getProAvailability(proId)`** (éditeur global) — ajouter le filtre
  `isNull(availabilityRule.eventTypeId)` pour ne montrer que le planning global.
- **`getProEventTypeRules(proId)`** *(nouveau)* — règles où
  `eventTypeId IS NOT NULL` pour ce pro, à regrouper par `eventTypeId` côté page
  prestations pour pré-remplir chaque éditeur inline.

## UI

### Éditeur hebdomadaire réutilisable

Extraire la grille jour-par-jour (toggle + plages horaires + helpers `toHHMM`/
`toMinutes`) de `availability-editor.tsx` vers un composant présentational
**`WeeklyHoursEditor`** (`src/components/dashboard/weekly-hours-editor.tsx`) :
props `value: ByDay`, `onChange(next: ByDay)`. Pas de bouton « enregistrer » à
l'intérieur (présentational pur).

- `AvailabilityEditor` (global) le consomme et garde son propre bouton
  « Enregistrer les disponibilités » → `saveAvailability`.
- Le formulaire de prestation le consomme dans une section repliable.

### Formulaire de prestation (`event-types-manager.tsx`)

- `EventTypeItem` gagne `availability: { dayOfWeek; startMinute; endMinute }[]`
  (règles personnalisées de la presta ; tableau vide = hérite du global).
- Le formulaire gagne une section **« Horaires personnalisés »** avec un
  interrupteur :
  - **OFF** (défaut) : texte « Utilise les disponibilités générales » ; rien d'autre.
  - **ON** : affiche `WeeklyHoursEditor` (pré-rempli depuis `item.availability`,
    sinon valeur de départ vide).
- À la soumission, on envoie `availability: { customized: <toggle>, rules: <aplati> }`
  à `saveEventType`. Si `customized` est ON mais aucune plage valide, on l'envoie
  comme `customized: false` (cf. « personnalisé mais vide »).
- Une nouvelle presta peut donc définir ses horaires dès la création (l'action a
  l'id après insert).

### Page prestations (`src/app/dashboard/event-types/page.tsx`)

Charger `getProEventTypeRules(pro.id)`, regrouper par `eventTypeId`, et passer
`availability` dans chaque `EventTypeItem`.

### Indice visuel (léger)

Sur la carte d'une prestation en lecture, afficher un petit badge
« Horaires personnalisés » quand `availability.length > 0`, pour que le pro voie
d'un coup d'œil quelles prestas dérogent au planning global.

## Compatibilité avec « Indisponibilités (time-off) »

La feature time-off (spec `2026-06-19-unavailability-time-off-design.md`, encore
non implémentée) ajoute une source au tableau `busy[]` de `loadBookableSlots`.
La présente feature change la source `rules[]`. Les deux axes sont **orthogonaux**
et se composent sans conflit dans `computeSlots` (les indispos se soustraient des
créneaux, qu'ils viennent du planning global ou personnalisé).

## Hors périmètre (v1)

- Plannings nommés réutilisables entre prestations.
- Surcouche additive / restriction du global (on a choisi le remplacement total).
- Dates d'exception par prestation (couvert globalement par time-off).

## Workflow technique

- Schéma modifié → `pnpm db:generate` puis `pnpm db:migrate` (cible `DATABASE_URL`).
- `pnpm typecheck` et `pnpm build` doivent rester verts.
