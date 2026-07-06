# Page `/demo` — visite guidée automatique du produit

## Contexte

Le bouton « Voir une page de démo » du hero
([`page.tsx:234`](../../../src/app/page.tsx)) pointe aujourd'hui vers
`/altinha-paris`, la page publique du compte de démonstration. Le visiteur y
voit une page de réservation réelle, mais rien ne lui montre le parcours
complet (réservation, achat de pack, crédit) ni le back-office pro.

On veut une vraie page de démonstration `/demo` : une visite guidée scriptée
où l'utilisateur clique simplement sur « Suivant » et où la page joue
elle-même toutes les actions (curseur animé, champs qui se remplissent,
écrans qui s'enchaînent), d'abord côté client puis côté pro.

Décisions validées avec l'utilisateur :

- **Simulation scriptée** : page autonome, données fictives en dur, aucun
  appel serveur, aucune écriture en base. Les vrais composants produits ne
  sont pas modifiés.
- **Scénario** : réservation classique + achat de pack + réservation à
  crédit côté client ; planning, prestations, packs, disponibilités et
  branding côté pro.
- **Navigation** : « Suivant » / « Précédent » + mode lecture auto
  (pausable) + progression visible.

## Objectif

- Route `/demo` : visite guidée en **12 étapes** (~2 minutes), déterministe,
  rejouable, sans backend.
- Un faux curseur effectue les actions (déplacements, clics, saisie) dans
  une fausse fenêtre de navigateur contenant des répliques fidèles des
  écrans du produit.
- Les liens « démo » de la landing pointent vers `/demo` ;
  `/altinha-paris` reste accessible (lié depuis la fin de la démo).

## Scénario

Chapitre **« Côté client »** — l'URL affichée dans le faux navigateur est
`skedul.app/altinha-paris` puis ses sous-pages :

| # | Titre | Écran | Actions jouées |
|---|-------|-------|----------------|
| 1 | La page publique | Profil public | Présentation ; le curseur survole les cartes (aucune mutation). |
| 2 | Réserver une prestation | Profil → Réservation | Clic « Réserver » sur *Séance découverte · 60 min · 25 €* ; l'URL passe à `…/book/decouverte`. |
| 3 | Choisir un créneau | Réservation | Clic sur un jour disponible du calendrier mensuel, puis sur le créneau *18:00* ; la carte « 2. Vos informations » se dégrise. |
| 4 | Confirmer et payer | Réservation → Confirmation | Saisie machine-à-écrire (*Léa Martin*, *lea@exemple.com*), clic « Payer 25 € », battement « Paiement sécurisé… », écran « Réservation confirmée ! ». |
| 5 | Acheter un pack d'heures | Profil → Pack → Confirmation | Retour profil, clic « Acheter » sur *Pack 10 heures · 200 €*, formulaire pré-rempli rapide, clic « Payer 200 € », écran « Pack activé ! » (10 crédits). |
| 6 | Réserver avec un crédit | Réservation → Confirmation | Clic « Réserver un créneau », nouveau créneau choisi ; l'email reconnu fait apparaître la bannière verte « Vous avez 10 crédits applicables… » et le bouton primaire « Réserver avec 1 crédit » ; clic → confirmation immédiate, sans paiement. |

Chapitre **« Côté pro »** — l'URL bascule sur `skedul.app/dashboard/…`, la
sidebar du back-office apparaît dans le cadre :

| # | Titre | Écran | Actions jouées |
|---|-------|-------|----------------|
| 7 | Le planning | Planning semaine | La réservation de Léa apparaît dans la grille (animation type tampon) parmi quelques séances existantes ; mention des cours de groupe (`x/y inscrits`). |
| 8 | Vos prestations | Prestations | Clic sur le crayon d'une prestation : le formulaire inline s'ouvre (durée, prix, capacité, pastilles couleur). |
| 9 | Vos packs | Packs prépayés | La liste montre le *Pack 10 heures* avec badge succès « 12 vendus » ; le curseur ouvre le formulaire du pack (crédits, prix, prestation associée). |
| 10 | Vos disponibilités | Disponibilités | Le curseur active le samedi (switch iOS), une plage 09:00 – 12:00 apparaît. |
| 11 | Votre image | Réglages / Identité visuelle | Clic sur la pastille turquoise : l'aperçu en direct se rethème instantanément ; clic sur la mise en page « vitrine » : l'aperçu se recentre. |

**Outro** :

| # | Titre | Écran | Contenu |
|---|-------|-------|---------|
| 12 | À vous | Ticket final | Le cadre laisse place à un ticket sombre (style `TicketCta`) : bouton primaire « Créer ma page gratuitement » → `/sign-up`, bouton secondaire « Revoir la démo » (retour étape 1), lien discret « Voir une vraie page : altinha-paris » → `/altinha-paris`. |

## Architecture

```
src/app/demo/page.tsx                       — métadonnées + <DemoTour/> (aucun accès session/DB/env)
src/components/demo/demo-tour.tsx           — orchestrateur (état, timers, clavier, autoplay)
src/components/demo/demo-script.tsx         — les 12 étapes : titres, URL, écrans, timelines
src/components/demo/demo-data.ts            — données fictives (univers Altinha Paris)
src/components/demo/demo-cursor.tsx         — faux curseur (déplacement, pulsation de clic)
src/components/demo/browser-frame.tsx       — fausse fenêtre : points, pilule URL animée, scale-to-fit
src/components/demo/tour-controls.tsx       — talon de ticket : titres, tampons, Précédent/Suivant/lecture
src/components/demo/screens/client-profile.tsx
src/components/demo/screens/client-booking.tsx
src/components/demo/screens/client-pack.tsx
src/components/demo/screens/client-confirmation.tsx
src/components/demo/screens/pro-planning.tsx
src/components/demo/screens/pro-event-types.tsx
src/components/demo/screens/pro-packs.tsx
src/components/demo/screens/pro-availability.tsx
src/components/demo/screens/pro-branding.tsx
src/components/demo/screens/outro.tsx
```

Quelques keyframes s'ajoutent à
[`globals.css`](../../../src/app/globals.css) (pulsation de clic du curseur,
apparition d'un bloc dans le planning), suivant la convention existante :
CSS pur, derrière `@media (prefers-reduced-motion: no-preference)`.

## Moteur de scénario

Tout est déclaratif et déterministe, piloté par un état unique :

```ts
// demo-script.tsx
interface DemoStep {
  id: string;
  chapter: "client" | "pro" | "outro";
  title: string;        // ex. « Réserver avec un crédit »
  description: string;  // 1-2 phrases affichées dans le talon
  url: string;          // ex. "skedul.app/altinha-paris/book/decouverte"
  screen: ScreenId;     // quel composant screens/* afficher
  timeline: DemoAction[];
}

type DemoAction =
  | { type: "move"; target: string; delay: number }            // déplace le curseur vers [data-demo=target]
  | { type: "click"; target: string; patch: Patch; delay: number }
  | { type: "type"; target: string; field: TextField; text: string; delay: number }
  | { type: "wait"; delay: number };

type Patch = Partial<DemoState>; // appliqué à l'état au moment du clic / de la saisie
```

`DemoState` regroupe tout ce que les écrans affichent : jour/créneau
sélectionnés, champs saisis, crédits restants, sessions du planning,
formulaire de prestation ouvert, plages du samedi, couleur de marque, mise
en page, etc.

- **Composition d'état** : l'état initial de l'étape N est calculé en
  appliquant à l'état de départ tous les patches des étapes 1 à N-1
  (`stateBefore(n)`, mémoïsé). Conséquences : « Précédent » saute
  instantanément à l'état de début d'étape, « Suivant » pendant une
  animation applique d'un coup les patches restants de l'étape, et aucun
  écart ne peut apparaître entre le déroulé animé et le déroulé sauté.
- **Lecture d'une étape** : l'orchestrateur consomme la timeline avec des
  `setTimeout` chaînés (référencés dans un `ref`, tous annulés au skip, au
  changement d'étape et au démontage). `move` positionne le curseur sur
  l'élément `[data-demo=…]` (coordonnées via `getBoundingClientRect`
  relatives au cadre) ; `click` déclenche la pulsation puis applique son
  patch ; `type` révèle le texte caractère par caractère dans le champ
  contrôlé.
- **Lecture auto** : à la fin d'une timeline, pause de ~1,2 s puis étape
  suivante. Mise en pause si l'onglet devient masqué
  (`visibilitychange`) ; « Précédent » ou un clic manuel sur un tampon met
  la lecture auto en pause.
- **Clavier** : `→` = Suivant, `←` = Précédent.

## Écrans : réutilisés vs répliqués

**Réutilisés tels quels** (composants purs, aucune modification) :
[`DayCalendar`](../../../src/components/public/day-calendar.tsx),
[`WeeklyHoursEditor`](../../../src/components/dashboard/weekly-hours-editor.tsx)
(entièrement contrôlé), les primitives
[`ui/`](../../../src/components/ui) (Button, Card, Badge, Input, Label,
Logo…), `formatMoney`, `brandThemeVars`, les helpers de
`calendar-grid.ts` / `datetime.ts`, et les keyframes existantes
(`stamp-in`, `tap-hint`…).

**Répliques contrôlées** dans `src/components/demo/screens/` : mêmes
structures et classes Tailwind que les originaux, mais l'état vient des
props (dérivées de `DemoState`) au lieu de `useState` + server actions.
Concernés : profil public, flux de réservation, page pack, confirmation,
planning, prestations, packs, disponibilités, branding. Les éléments
ciblés par le curseur portent un attribut `data-demo="…"`. Les répliques
sont volontairement **statiques hors script** (pas de handlers utilisateur) :
seule la démo les anime.

L'avatar utilise le mode initiales de `BrandAvatar` (pas de dépendance
DiceBear à l'exécution) ; le bandeau est le dégradé de marque par défaut
(pas d'image externe).

## Chrome visuel

Signature : **le carnet à tampons**, déjà au cœur de l'identité (hero
`.carnet`, `stamp-in`, `TicketCta`).

- **Cadre navigateur** : carte blanche `rounded-2xl` + `shadow-card`, barre
  supérieure avec trois points muted et une pilule URL en mono (`text-xs`)
  qui change avec un léger fondu à chaque navigation simulée. Le contenu a
  une **largeur de design fixe (960 px)** et est mis à l'échelle
  (`transform: scale(largeurConteneur / 960)`, mesuré par `ResizeObserver`)
  pour tenir sur toutes les tailles d'écran, mobile compris. Le curseur vit
  *dans* le repère mis à l'échelle : aucune conversion de coordonnées.
- **Talon de contrôle** : colonne à droite du cadre sur desktop (comme le
  talon latéral d'un billet de cinéma — le cadre garde ainsi le maximum de
  hauteur d'écran), empilé sous le cadre sur mobile. Carte blanche à
  bordure en pointillés (perforation simplifiée). Contenu : eyebrow mono
  uppercase « Côté client » / « Côté pro », titre d'étape en `font-display`,
  description `text-sm text-muted-foreground`, boutons « Précédent »
  (ghost), lecture auto (icône Play/Pause, ghost) et « Suivant » (primaire,
  `ArrowRight`). À la dernière étape, « Suivant » devient « Créer ma page »
  → `/sign-up`.
- **Progression = carnet à tampons** : une case ronde par étape (cercle en
  pointillés, comme les cases non tamponnées du hero) ; chaque étape
  franchie est tamponnée en rose `--color-stamp` avec l'animation
  `stamp-in` existante. Les tampons sont cliquables (accès direct à une
  étape). Sur mobile, la rangée se compacte (cases plus petites).
- **Curseur** : pointeur violet (lucide `MousePointer2` rempli, même
  langage que le `TapHint` du hero), ombre portée légère, déplacement en
  `transition: transform ~600ms cubic-bezier(0.3, 0.9, 0.3, 1)`, clic =
  anneau qui se dilate et s'estompe.
- **Page** : fond `.bg-aurora`, en-tête minimal (Logo + lien « Quitter la
  démo » → `/`), pas de `SiteHeader` (il lit la session) ni de
  `SiteFooter`. Métadonnées : titre « Démo — Skedul ».

## Données fictives

Univers **Altinha Paris** (cohérent avec le compte seedé et le carnet du
hero), défini dans `demo-data.ts` :

- Branding : « Altinha Paris », accroche courte, violet par défaut
  `#6d5cf6`, avatar initiales « AP ».
- Prestations : *Séance découverte* (60 min, 25 €, couleur violette),
  *Cours collectif* (90 min, 18 €, capacité 8, couleur sky), *Coaching
  privé* (60 min, 40 €, couleur verte).
- Pack : *Pack 10 heures* — 10 crédits, 200 €, toutes prestations,
  12 vendus.
- Cliente : *Léa Martin* / `lea@exemple.com`.
- Calendrier : les jours/créneaux disponibles sont générés **relativement à
  la date courante** (comme le fait `HeroCards`) pour que la démo reste
  d'actualité sans maintenance ; le créneau réservé est à J+2, 18:00.
- Planning pro : 4-5 séances sur la semaine courante (dont un cours
  collectif `5/8 inscrits`), plus la réservation de Léa qui arrive à
  l'étape 7.

## Accessibilité et robustesse

- `prefers-reduced-motion: reduce` : curseur masqué, chaque étape affiche
  directement son état final (patches appliqués immédiatement), la lecture
  auto reste disponible mais sans mouvements.
- Titre + description de l'étape annoncés dans une zone `aria-live="polite"`.
- Focus visible sur tous les contrôles. Le contenu du cadre (les répliques)
  porte l'attribut `inert` : rien n'y est focusable ni annoncé aux lecteurs
  d'écran — la narration passe entièrement par le talon de contrôle et la
  zone `aria-live`.
- Timeouts nettoyés au démontage ; navigation clavier ; autoplay suspendu
  quand l'onglet est masqué.

## Modifications de l'existant

Trois liens passent de `/altinha-paris` à `/demo` :

1. Le bouton hero « Voir une page de démo » →
   [`page.tsx:234`](../../../src/app/page.tsx) (libellé : « Voir la démo »).
2. Le bouton révélé du ticket
   [`ticket-cta.tsx:130`](../../../src/components/ticket-cta.tsx)
   (« Voir la démo »).
3. Le lien « Page de démo » du footer
   [`site-footer.tsx`](../../../src/components/site-footer.tsx).

Le raccourci de connexion démo (`demo-quick-login.tsx`) et la ligne
d'identifiants du hero ne changent pas. Aucun composant produit existant
n'est modifié.

## Cas limites

- **Redimensionnement pendant une animation** : le curseur est positionné
  dans le repère du cadre (design 960 px) ; le scale-to-fit externe ne
  change pas ses coordonnées. Au pire, la cible d'un `move` est recalculée
  à l'action suivante.
- **Spam de « Suivant »** : chaque avancement annule les timers en cours et
  applique les patches restants — l'état reste cohérent quel que soit le
  rythme.
- **Étape 12 (outro)** : timeline vide ; « Suivant » y est remplacé par le
  CTA d'inscription.
- **JS désactivé / SSR** : la page rend l'étape 1 statique (écran profil,
  talon visible) ; sans hydratation, rien ne s'anime mais rien n'est cassé.

## Validation

- `pnpm typecheck` et `pnpm build` verts.
- Vérification navigateur complète : déroulé des 12 étapes (manuel + lecture
  auto), « Précédent », accès direct par tampon, mobile (~375 px),
  `prefers-reduced-motion`.

## Hors périmètre

- Pas de tests automatisés de rendu (aucune convention de test React dans
  le projet).
- Pas de version anglaise (tout le site est en français).
- Pas de tracking/analytics des étapes.
- `/altinha-paris` et son seed ne changent pas.
