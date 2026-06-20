# Copier les disponibilités vers d'autres jours — Design

**Date:** 2026-06-20
**Statut:** Approuvé

## Problème

Dans l'éditeur de disponibilités hebdomadaires (`/dashboard/availability`),
configurer chaque jour à la main est répétitif : un pro qui travaille aux mêmes
heures du lundi au vendredi doit ressaisir les mêmes plages cinq fois.

On veut pouvoir **copier des créneaux déjà configurés vers d'autres jours** :

- un bouton **« dupliquer »** par créneau (plage horaire) ;
- un bouton **« Tout copier »** par jour (copie toutes les plages du jour) ;
- dans les deux cas, un **sélecteur de jours** (popover) où l'on coche les autres
  jours cibles, puis on applique.

## Comportement

### Sémantique de copie (hybride, décidée)

- **Dupliquer un créneau** → la plage est **ajoutée (fusionnée)** aux plages déjà
  présentes sur chaque jour cible. Les **doublons exacts** (même `start` **et**
  même `end`) sont ignorés : cliquer deux fois ne crée pas de répétition.
- **Tout copier** → chaque jour cible est **remplacé** : ses plages existantes sont
  écrasées par un clone de la liste complète du jour source.

Dans les deux cas, un jour cible qui était **désactivé** (liste vide) devient
automatiquement **activé**, puisque `enabled = ranges.length > 0` dans le rendu
existant. Aucun toggle séparé à gérer.

### Sélecteur de jours (popover)

- Ancré au bouton déclencheur (« dupliquer » d'une plage, ou « Tout copier »).
- Liste les **6 autres jours** (tous sauf le jour source), dans l'ordre
  `DAY_ORDER`, sous forme de **cases à cocher** (multi-sélection).
- Une case **« Tous »** en tête coche / décoche tout d'un coup.
- Bouton **« Appliquer »** (désactivé tant qu'aucun jour n'est coché) + fermeture.
- **Un seul popover ouvert à la fois.** Ouvrir un autre déclencheur ferme le
  précédent. Fermeture aussi au clic extérieur et sur `Escape`.

## Architecture

Modification **purement côté client**, dans la couche d'édition de `ByDay` qui
précède la sauvegarde existante. **Inchangés** : `AvailabilityEditor`, les server
actions, le schéma DB, le flux `saveAvailability`. La copie ne fait que muter
l'état `ByDay` local ; l'utilisateur clique ensuite « Enregistrer » comme
aujourd'hui.

### 1. Primitive `Popover` — `src/components/ui/popover.tsx`

Popover ancré minimal, sans nouvelle dépendance (ni Radix ni Floating UI, absents
du projet), au style maison.

- Conteneur `relative` ; panneau `absolute` positionné sous le déclencheur,
  `z-50`, repris du style `Card` (`rounded-2xl border border-border bg-card
  shadow-(--shadow-card)`).
- État d'ouverture **contrôlé** : props `open` / `onOpenChange`, pour que le parent
  garantisse un seul popover ouvert.
- Ferme au **clic extérieur** (listener `pointerdown` sur `document`, ignorant les
  clics dans le conteneur) et sur **`Escape`**.
- Pas de portal : les cartes n'ont pas d'`overflow: hidden` (vérifié dans
  `card.tsx`), un positionnement absolu suffit.

API esquissée :

```tsx
<Popover open={isOpen} onOpenChange={setOpen}>
  <PopoverTrigger>{trigger}</PopoverTrigger>
  <PopoverContent>{...}</PopoverContent>
</Popover>
```

(forme exacte trigger/content vs render-prop à arbitrer dans le plan ; l'important
est : contrôlé, ferme au clic extérieur + Escape.)

### 2. Composant métier `CopyToDaysPopover`

Dans `weekly-hours-editor.tsx` (ou fichier voisin). Ne connaît **pas** les plages :
il choisit seulement des jours.

- Props : `sourceDay: number`, `open: boolean`, `onOpenChange(open)`,
  `onApply(targetDays: number[])`, et le nœud déclencheur.
- Possède l'ensemble coché (les jours `DAY_ORDER` ≠ `sourceDay`), la case « Tous »,
  et le bouton « Appliquer » qui appelle `onApply(targetDays)` puis ferme.
- Réinitialise la sélection à chaque ouverture.

### 3. Helpers purs (testés) — `weekly-hours-editor.tsx`

Transformations `ByDay → ByDay`, pures, couvertes par des tests unitaires (comme
`availability.test.ts` couvre la lib) :

- `mergeRangeIntoDays(byDay, range, targetDays)` — ajoute `range` à chaque jour
  cible, **dédoublonnage** par `start+end`, sans réordonner les plages existantes.
- `replaceDaysWith(byDay, ranges, targetDays)` — clone `ranges` (copie profonde des
  objets `Range`) dans chaque jour cible.

### 4. Câblage dans `WeeklyHoursEditor`

- Ajouter, sur chaque ligne de plage, un déclencheur **« dupliquer »** (icône
  `Copy` de lucide-react, à côté du `X`).
- Ajouter, par jour activé, un déclencheur **« Tout copier »** à côté de
  « Ajouter une plage ».
- État `openPopover: { day: number; slot: number | "all" } | null` → garantit un
  seul popover ouvert et identifie la source.
- À l'application : appeler le helper adéquat (`mergeRangeIntoDays` pour une plage,
  `replaceDaysWith` pour « tout »), puis `onChange(next)`.

## Décomposition / testabilité

| Unité | Rôle | Dépend de |
|---|---|---|
| `Popover` | primitive d'ancrage générique (ouverture contrôlée, clic-extérieur, Escape) | — |
| `CopyToDaysPopover` | choisir des jours cibles | `Popover` |
| `mergeRangeIntoDays` / `replaceDaysWith` | transformer `ByDay` | — (purs) |
| `WeeklyHoursEditor` | câbler déclencheurs + helpers + `onChange` | tout ce qui précède |

Les helpers purs portent la logique délicate (fusion, dédup, remplacement, clone)
et sont testés isolément. Les composants restent fins.

## Hors périmètre (v1)

- Copier vers un **autre intervalle que la semaine** (ex. récurrence). Non.
- **Annuler (undo)** la copie : l'état n'est pas encore enregistré, l'utilisateur
  peut corriger à la main avant « Enregistrer ».
- Détection / fusion des plages **qui se chevauchent** (ex. 09:00–11:00 et
  10:00–12:00) : on ne fusionne que les doublons **exacts** ; les chevauchements
  sont laissés tels quels (le moteur de créneaux les tolère déjà).
- Réutiliser le popover ailleurs : on le conçoit générique mais on ne migre pas
  l'UI existante vers lui.

## Workflow technique

- Pas de changement de schéma → pas de migration.
- `pnpm typecheck` et `pnpm build` doivent rester verts.
- Tests des helpers via `pnpm test` (runner `tsx --test` déjà en place).
