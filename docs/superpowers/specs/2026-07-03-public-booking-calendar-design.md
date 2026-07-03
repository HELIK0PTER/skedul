# Calendrier mensuel pour la sélection de date (page de réservation publique)

## Contexte

Sur la page de réservation publique (`/[slug]/book/[eventTypeId]`), le composant
[`BookingFlow`](../../../src/components/public/booking-flow.tsx) affiche
aujourd'hui les jours disponibles sous forme d'une liste horizontale de
"pills" scrollable (`d.label` — ex. "Lundi 6 juillet"). Le client doit faire
défiler cette liste pour trouver un jour, sans vue d'ensemble du mois.

Le serveur ([`page.tsx`](../../../src/app/%5Bslug%5D/book/%5BeventTypeId%5D/page.tsx))
charge déjà tous les créneaux disponibles sur un horizon de 21 jours
(`loadBookableSlots(..., daysAhead = 21)`) et les regroupe par jour
(`groupSlotsByDay`) avant de les passer à `BookingFlow` via la prop `days`.
Toutes les données nécessaires sont donc déjà côté client — ce changement est
purement front-end.

## Objectif

Remplacer la liste de pills par un calendrier mensuel classique :
- Les jours du mois avec au moins un créneau disponible affichent un petit
  point bleu.
- Cliquer sur un jour avec un point bleu affiche ses créneaux disponibles
  (grille de créneaux existante, inchangée).
- Les jours sans disponibilité (passés, ou au-delà des 21 jours de fenêtre de
  réservation) sont grisés et non cliquables.
- Navigation mois précédent / mois suivant.

## Composant

Nouveau composant `src/components/public/day-calendar.tsx`, présentationnel et
sans appel serveur :

```ts
interface DayCalendarProps {
  availableDays: { key: string; date: Date }[]; // dérivé de `days` dans BookingFlow
  selectedKey: string | null;
  onSelect: (key: string) => void;
}
```

- `key` est le `dayKey` existant (déjà utilisé comme clé de sélection dans
  `BookingFlow`) ; `date` est la date du jour dans le fuseau du pro, dérivée du
  premier créneau du groupe (`d.slots[0].iso`).
- État interne : `viewMonth: Date`, le mois affiché. Initialisé une seule fois
  (via `useState(() => ...)`) au mois du **premier** jour de `availableDays`
  (liste déjà triée chronologiquement par le serveur). Si `availableDays` est
  vide, ce cas ne se présente pas : `BookingFlow` garde son état vide actuel
  (voir "Cas limites").
- Grille 7 colonnes (lundi → dimanche, cohérent avec le fuseau/locale FR déjà
  utilisée ailleurs — `formatDateLong` etc.), semaines complètes incluant les
  jours du mois précédent/suivant en cases vides ou grisées pour compléter la
  grille.
- Un jour est "disponible" si sa date (format `yyyy-MM-dd` dans le fuseau du
  pro) correspond à un `key` de `availableDays`. Ces jours :
  - affichent un point bleu (petit indicateur sous ou à côté du numéro du
    jour, style cohérent avec le thème violet existant — utiliser
    `bg-primary` pour le point).
  - sont cliquables (`onSelect(key)`).
  - le jour actuellement sélectionné (`selectedKey`) reprend le style
    d'accent déjà utilisé pour la pill sélectionnée aujourd'hui
    (`border-primary bg-accent text-accent-foreground` ou équivalent adapté à
    une cellule de calendrier).
- Les jours non disponibles (avant aujourd'hui, après l'horizon de 21 jours,
  ou simplement sans créneau resté disponible) sont grisés
  (`text-muted-foreground opacity-40` ou équivalent), non cliquables
  (`disabled` sur le `<button>`), sans point.
- Navigation : deux boutons flèche (prev/next mois) qui incrémentent/décrémentent
  `viewMonth` de 1 mois (`date-fns` `addMonths`/`subMonths`). Aucune limite de
  navigation imposée (le pro/client peut feuilleter librement dans le passé ou
  loin dans le futur ; ces mois seront simplement entièrement grisés puisque
  hors de la fenêtre de 21 jours).
- En-tête du calendrier : nom du mois + année (ex. "Juillet 2026"), formaté en
  français via `date-fns`'s `format(viewMonth, "MMMM yyyy", { locale: fr })`
  (vérifier que la locale `fr` de `date-fns` est déjà utilisée ailleurs dans le
  projet — sinon l'importer localement dans ce composant).

## Intégration dans `BookingFlow`

Dans [`booking-flow.tsx`](../../../src/components/public/booking-flow.tsx) :

- Dériver `availableDays` à partir de la prop `days` existante :
  `days.map(d => ({ key: d.key, date: new Date(d.slots[0].iso) }))`.
- Remplacer le bloc `<div className="flex gap-2 overflow-x-auto ...">` (la
  liste de pills, lignes ~133–152) par
  `<DayCalendar availableDays={availableDays} selectedKey={selectedDay} onSelect={(key) => { setSelectedDay(key); setSelectedIso(null); }} />`.
- Aucun changement à la logique de sélection de créneau existante
  (`selectedDay`, `selectedIso`, la grille de créneaux du jour sélectionné
  juste en dessous) : le state `selectedDay` reste la source de vérité, comme
  aujourd'hui.
- `useState(days[0]?.key ?? null)` pour `selectedDay` reste inchangé (déjà le
  comportement "pré-sélectionner le 1er jour dispo").

## Cas limites

- `days.length === 0` (aucune disponibilité) : le composant `BookingFlow`
  garde son early-return actuel affichant "Aucun créneau disponible" — le
  calendrier n'est jamais monté dans ce cas, pas de changement nécessaire.
- Navigation vers un mois sans aucun jour disponible : la grille s'affiche
  entièrement grisée (aucun point bleu), navigation prev/next reste possible
  pour revenir à un mois avec disponibilités.
- Fuseau horaire : le regroupement par jour (`groupSlotsByDay`) utilise déjà
  le fuseau du professionnel côté serveur ; le composant calendrier ne fait
  que comparer des clés de date déjà calculées correctement, donc pas de
  nouvelle logique de fuseau horaire à introduire côté client.

## Hors périmètre

- Pas de changement au serveur (`page.tsx`, `loadBookableSlots`,
  `groupSlotsByDay`) — l'horizon de 21 jours et le format de `days` restent
  identiques.
- Pas de changement à la grille de créneaux horaires elle-même (Step 1, partie
  basse du bloc, lignes ~154–180 de `booking-flow.tsx`).
- Pas de tests automatisés du rendu visuel du calendrier (pas de convention
  de test existante pour les composants React de ce projet) ; vérification
  manuelle via le navigateur (page `/altinha-paris/book/...` en dev) suffit.
