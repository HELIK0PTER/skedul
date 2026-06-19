# Indisponibilités (time-off) — Design

**Date:** 2026-06-19
**Statut:** Approuvé

## Problème

Un pro doit pouvoir marquer ses indisponibilités (congés sur plusieurs jours, ou
absences ponctuelles dans une journée) depuis le back-office. Ces indisponibilités
doivent retirer les créneaux correspondants de la page publique `/[slug]` — à la
fois à l'affichage et au moment de la réservation.

Les disponibilités récurrentes hebdomadaires sont déjà gérées par
`availabilityRule` + l'éditeur `/dashboard/availability`. Les indisponibilités
sont des **exceptions ponctuelles** qui se soustraient à ces disponibilités.

## Granularité

Journées entières **et** plages horaires :

- **Toute la journée** : peut couvrir une plage de dates (ex. congés du 3 au 5 juil.).
- **Plage horaire** (ex. 14:00–16:00) : sur **un seul jour**.

Règle : si une plage horaire est saisie, l'indispo porte sur une seule journée.
Une indispo multi-jours est forcément « toute la journée ». Cela évite l'ambiguïté
« 14h–16h chaque jour » vs « bloc continu du jour A 14h au jour B 16h ».

## Modèle de données

Nouvelle table `timeOff` (DB `time_off`). Même forme que les `BusyInterval`
déjà consommés par le moteur de créneaux — une ligne = un intervalle continu
`[startAt, endAt)`.

```
timeOff
  id              text pk (nanoid)
  professionalId  text → professional.id (onDelete: cascade)
  startAt         timestamptz   -- instant UTC
  endAt           timestamptz   -- instant UTC, borne de fin EXCLUSIVE
  allDay          boolean notnull default true
  reason          text?         -- motif optionnel ("Congés")
  createdAt / updatedAt
  index time_off_pro_idx on (professionalId, startAt)
```

Relations Drizzle : `professional` a `many(timeOff)` ; `timeOff` a
`one(professional)`. Ajouter `timeOff: many(timeOff)` à `professionalRelations`.

### Conversion mur-horloge → instant

Via `instantFromWallClock(year, month1, day, minutesFromMidnight, tz)` avec
`tz = pro.timezone`, cohérent avec le reste du codebase.

- Toute la journée, du 3 au 5 juil. (tz pro) :
  `startAt = instantFromWallClock(.., 3, 0)`,
  `endAt   = instantFromWallClock(.., 6, 0)` (lendemain du dernier jour, borne exclusive).
- Plage 14:00–16:00 le 3 juil. :
  `startAt = instantFromWallClock(.., 3, 840)`, `endAt = instantFromWallClock(.., 3, 960)`.

## Intégration au moteur de créneaux

Point d'intégration unique : `loadBookableSlots` dans `src/lib/slots.ts` charge
déjà un tableau `busy[]` (actuellement seulement les réservations
`pending`/`confirmed`). On ajoute en parallèle un `SELECT` des `timeOff` du pro
où `endAt >= now`, projeté en `{ startAt, endAt }`, et on concatène les deux
tableaux dans `busy`.

`computeSlots` (dans `src/lib/availability.ts`) les soustrait via son test
d'overlap existant — **aucune modification de `computeSlots` nécessaire**.

Comme `isSlotAvailable` (la garde anti-race appelée par les server actions de
réservation dans `public.ts`) passe par le même `loadBookableSlots`, le blocage
s'applique automatiquement **à l'affichage ET à la réservation**.

## Server actions & queries

`src/server/pro.ts` (gardées par `requirePro()`) :

- `createTimeOff(input: { startDate: string; endDate: string; allDay: boolean;
  startMinute?: number; endMinute?: number; reason?: string })`
  — calcule `startAt`/`endAt` via `instantFromWallClock` avec `pro.timezone`,
  insère la ligne. `revalidatePath("/dashboard/unavailability")` + `/${pro.slug}`.
- `deleteTimeOff(id: string)` — supprime avec `and(eq(id), eq(professionalId, pro.id))`
  (ownership). Mêmes revalidations.

Validation : `endAt > startAt` (sinon erreur) ; en mode plage horaire,
`endMinute > startMinute` et `startDate === endDate`.

`src/server/queries.ts` :

- `getProTimeOff(proId)` — indispos à venir (`endAt >= now`) triées par `startAt asc`.

## UI

Route `/dashboard/unavailability`. Entrée sidebar **« Indisponibilités »** (icône
`CalendarOff` de lucide-react), insérée juste après « Disponibilités » dans
`src/components/dashboard/sidebar.tsx`.

Page serveur (`src/app/dashboard/unavailability/page.tsx`) : charge le pro +
`getProTimeOff`, passe à un composant client.

Composant client `UnavailabilityManager` :

- **Grille calendrier mensuelle** (construite avec `date-fns`, déjà installé ;
  pas de lib calendrier) : navigation mois précédent / suivant, jours passés
  grisés, jours avec indispo surlignés (violet, thème `primary`/`accent`), pastille
  distinguant « toute la journée » vs « partielle ». Cliquer un jour pré-remplit la
  date de début du formulaire.
- **Formulaire d'ajout** : date début / date fin, toggle « Toute la journée »,
  sinon heure début / heure fin, motif optionnel. Soumission via `createTimeOff`
  + `router.refresh()`.
- **Liste des indispos à venir** : chaque entrée formatée (`formatDateLong` /
  `formatTime`) avec bouton supprimer (`deleteTimeOff`).

Réutiliser les primitives existantes : `Button`, `Card`/`CardContent`, `Input`,
`Label`, `cn`. Le style suit l'éditeur de disponibilités existant.

## Hors périmètre (v1)

- Indispos **récurrentes** (déjà exprimables en retirant une plage dans
  Disponibilités).
- Afficher les **réservations existantes** dans la grille calendrier (le calendrier
  ne montre que les indispos). Extension possible plus tard.
- Édition d'une indispo existante (on supprime + recrée).

## Workflow technique

- Schéma modifié → `pnpm db:generate` puis `pnpm db:migrate` (cible `DATABASE_URL`).
- `pnpm typecheck` et `pnpm build` doivent rester verts.
