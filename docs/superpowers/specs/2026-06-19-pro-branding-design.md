# Branding personnalisé des professionnels — Design

**Date :** 2026-06-19
**Statut :** Validé (brainstorming) — à transformer en plan d'implémentation

## Contexte

Aujourd'hui un pro n'a quasiment aucun levier de branding sur sa page publique
`/[slug]` : seule la `brandColor` est utilisée, et uniquement pour le dégradé du
header ([public-shell.tsx](../../../src/components/public/public-shell.tsx)). Le champ
`avatarUrl` existe en base ([schema.ts](../../../src/lib/db/schema.ts)) mais n'est ni
éditable ni rendu. Aucune infrastructure d'upload d'image n'existe.

On veut permettre au pro de **personnaliser l'identité visuelle de sa page publique** :
bannière, avatar, et propagation de la couleur de marque aux éléments d'interface.

## Objectifs

1. **Avatar** : le pro choisit son avatar parmi
   - une **galerie d'avatars générés** (libres de droits, 4 styles : `fun-emoji`,
     `micah`, `lorelei`, `pixel-art`),
   - un **pack de personnages 3D illustrés** embarqué dans l'app (images CC0/MIT),
   - ou **upload** de son propre logo / sa propre photo.
2. **Bannière** : image uploadée par le pro, affichée en hero en haut de la page
   publique. Sans bannière → fallback dégradé dérivé de la couleur de marque.
3. **Couleur de marque** : reteinte **les éléments d'interface** de la page publique
   (boutons « Réserver » / « Acheter le pack », liens, accents), pas seulement le header.
4. **Mise en page** : le pro choisit entre deux dispositions de header :
   - **Profil** (avatar + nom alignés à gauche, prolonge le header actuel) — défaut,
   - **Vitrine** (avatar + nom centrés, style landing).

## Non-objectifs (hors périmètre v1)

- Couleur secondaire / accent distincte (une seule `brandColor`). YAGNI, extensible plus tard.
- Thème complet (fonds de page, typographie personnalisée, dark mode par pro).
- Images par service / par pack.
- Recadrage / pipeline de redimensionnement d'images côté serveur (validation taille/type seulement).
- Branding du back-office (le dashboard reste sur le violet par défaut).
- Domaines personnalisés.

## Périmètre d'application

Le branding s'applique aux **pages publiques** du pro : `/[slug]` et son tunnel de
réservation/achat (tout ce qui est rendu sous le contexte public du pro). Le
back-office (`/dashboard/*`) garde le thème violet par défaut.

---

## 1. Modèle de données

Nouvelles colonnes sur la table `professional`
([schema.ts](../../../src/lib/db/schema.ts)) :

| colonne          | type   | défaut     | rôle |
|------------------|--------|------------|------|
| `bannerUrl`      | text   | null       | URL de la bannière (Blob). null ⇒ fallback dégradé. |
| `avatarKind`     | text   | null       | `'generated' \| 'pack' \| 'upload'`. null ⇒ fallback initiales. |
| `avatarStyle`    | text   | null       | si `generated` : `'fun-emoji' \| 'micah' \| 'lorelei' \| 'pixel-art'`. |
| `avatarSeed`     | text   | null       | si `generated` : graine déterministe de l'avatar. |
| `headerLayout`   | text   | `'profil'` | `'profil' \| 'vitrine'`. |
| `avatarUrl`      | text   | null *(existe déjà)* | si `pack` (chemin d'asset) ou `upload` (URL Blob). |
| `brandColor`     | text   | `#6366f1` *(existe déjà)* | couleur active résolue (depuis le preset ou le custom). |
| `themePreset`    | text   | `'violet'` | preset actif : `violet\|blue\|teal\|green\|amber\|red\|pink\|slate\|custom`. |
| `customColor`    | text   | null       | preset personnalisé du pro (persiste même si un preset nommé est actif). |

> On valide les valeurs énumérées au niveau de l'action serveur (Zod ou garde
> manuelle), pas via un type enum Postgres, pour rester souple (cohérent avec le
> reste du repo qui utilise des colonnes `text`).

Migration : `pnpm db:generate` puis `pnpm db:migrate` (cf. AGENTS.md).

### Résolution de l'avatar à l'affichage

Un helper `src/lib/avatar.ts` centralise la logique :

- `generated` → SVG rendu **côté serveur** via `@dicebear/core` +
  `@dicebear/collection` (`createAvatar(style, { seed }).toString()`), injecté
  inline. Aucun appel réseau externe au runtime, rien à stocker.
- `pack` → `<img src={avatarUrl}>` (chemin statique `public/avatars/3d/...`).
- `upload` → `<img src={avatarUrl}>` (URL Blob).
- `null` → composant `Avatar` actuel (initiales).

Un composant `BrandAvatar` encapsule ce switch et remplace l'usage direct de
`Avatar` dans le header public.

---

## 2. Stockage des uploads — Vercel Blob

- Dépendance `@vercel/blob`, upload via `put(pathname, file, { access: 'public' })`.
- Env ([env.ts](../../../src/lib/env.ts)) : ajouter `BLOB_READ_WRITE_TOKEN` (optionnel)
  et dériver `BLOB_ENABLED = !!BLOB_READ_WRITE_TOKEN`, **dans l'esprit des flags
  existants** `STRIPE_ENABLED` / `RESEND_ENABLED`.
- **Mode mock (token absent, ex. local/CI)** : l'onglet *Upload* est désactivé avec
  un message clair (« Stockage non configuré — choisis un avatar dans la galerie ou
  le pack 3D »). La galerie générée et le pack 3D fonctionnent sans aucun stockage,
  donc `pnpm build` reste vert sans secret.
- Route handler `src/app/api/upload/route.ts` (POST) :
  - auth : `requirePro()`,
  - validation : type ∈ {jpeg, png, webp}, taille (bannière ≤ 5 Mo, avatar ≤ 2 Mo),
  - `put()` sous un chemin namespacé par pro : `branding/{proId}/{banner|avatar}-{nanoid}`,
  - retourne `{ url }`.

---

## 3. Thème couleur : presets + preset personnalisé

> **Évolution (post-brainstorm) :** on ne se limite pas à teinter les boutons. Le pro
> choisit parmi des **presets nommés** (violet, bleu, turquoise, vert, ambre, rouge,
> rose, ardoise) **ou** définit **un preset personnalisé** (1 par pro, éditable). Le
> thème teinte boutons, liens, badges et surfaces d'accent — pas seulement les boutons.

Mécanisme : **surcharge de variables CSS Tailwind v4**. Les utilitaires `bg-primary`,
`text-primary`, `bg-accent`, `text-accent-foreground` compilent vers
`var(--color-*)` (cf. [globals.css](../../../src/app/globals.css)), donc surcharger ces
variables sur le shell public suffit à reteinter tout l'intérieur — **sans toucher au
composant `Button`**.

- `src/lib/color.ts` :
  - `THEME_PRESETS` : liste `{ id, label, color }` des presets nommés ; `presetColor(id)`.
  - `brandTheme(hex) → { primary, primaryForeground, primaryMuted, accent, accentForeground, ring }` —
    dérive un thème cohérent depuis **une** couleur :
    - `primaryForeground` / `accentForeground` calculés par **contraste WCAG** (texte
      lisible garanti sur le bouton et sur la surface d'accent claire) ;
    - `accent` = teinte très claire (mix 90 % blanc) pour badges / fonds doux ;
    - garde anti-couleur invalide (fallback violet).
  - `brandThemeVars(hex)` pose `--color-primary*`, `--color-accent*`, `--color-ring`.
- **Résolution** : `updateBranding` calcule `brandColor` actif = couleur du preset
  choisi, ou `customColor` si `themePreset === 'custom'`. La page publique lit
  `brandColor` → `brandThemeVars(brandColor)` (aucun changement de shell nécessaire).
- Le dégradé du header réutilise la couleur active.

---

## 4. Bannière + mise en page (page publique)

Refonte du header dans
[public-shell.tsx](../../../src/components/public/public-shell.tsx) :

- **Bannière** : si `bannerUrl` → `<img>` hero pleine largeur (hauteur ~ 160 px,
  `object-cover`). Sinon → dégradé actuel dérivé de `brandColor`.
- **Avatar** : `BrandAvatar` chevauchant le bas de la bannière (marge négative).
- **Disposition** selon `headerLayout` :
  - `profil` : avatar + nom + headline alignés à gauche.
  - `vitrine` : avatar + nom + headline centrés.
- Le corps (liste des event types, packs) reste inchangé structurellement ; seuls les
  boutons/accents héritent de la couleur via les variables CSS.

---

## 5. Back-office (réglages)

Extraire un composant dédié `src/components/dashboard/branding-form.tsx` (le
[profile-form.tsx](../../../src/components/dashboard/profile-form.tsx) actuel gère déjà
beaucoup de champs ; on garde l'identité « business » dans `profile-form` et on isole le
**branding** dans son propre bloc/section de la page réglages).

Contenu du bloc Branding :

1. **Bannière** : aperçu + bouton upload (désactivé si `!BLOB_ENABLED`) + bouton « Retirer ».
2. **Avatar** : sélecteur à onglets
   - **Galerie** : 4 styles ; pour le style choisi, une grille de N variantes générées
     (graines déterministes) + bouton « Régénérer » ; sélectionner une vignette fixe
     `avatarKind='generated'`, `avatarStyle`, `avatarSeed`.
   - **3D** : grille des images du pack ; sélectionner fixe `avatarKind='pack'`,
     `avatarUrl=chemin`.
   - **Upload** : input fichier → `/api/upload` → fixe `avatarKind='upload'`,
     `avatarUrl=URL Blob`.
3. **Couleur de marque** : color picker existant.
4. **Mise en page** : choix `profil` / `vitrine`.

Action serveur `updateBranding` dans [pro.ts](../../../src/server/pro.ts) :
`requirePro()` → `db.update(professional).set({...})` → `revalidatePath('/dashboard/settings')`
et `revalidatePath('/${pro.slug}')` (même pattern que `updateProfile`).

La query de lecture ([queries.ts](../../../src/server/queries.ts)) doit exposer les
nouveaux champs (vérifier qu'elle sélectionne bien la ligne complète).

---

## 6. Pack d'avatars 3D

- Embarqué en assets statiques : `public/avatars/3d/*.png` (~24–40 portraits,
  256×256, fond transparent), + un fichier `public/avatars/3d/LICENSE.md` avec la
  source et l'attribution.
- **Critère de licence (bloquant)** : uniquement CC0, MIT, ou explicitement
  « free for commercial use ». Candidats à évaluer en priorité : **Microsoft Fluent
  3D Emoji** (MIT), **Toy Faces** (offre gratuite), packs **CC0** type Polygonal Mind.
  → La sélection finale + vérification de licence est une **tâche d'implémentation**.
- Un manifeste `src/lib/avatar-pack.ts` (liste des entrées : id, chemin, alt) alimente
  la grille du sélecteur.

---

## Fichiers touchés / créés

**Modifiés**
- `src/lib/db/schema.ts` — nouvelles colonnes.
- `src/lib/env.ts` — `BLOB_READ_WRITE_TOKEN` + `BLOB_ENABLED`.
- `src/server/pro.ts` — action `updateBranding`.
- `src/server/queries.ts` — exposer les nouveaux champs (si nécessaire).
- `src/app/[slug]/page.tsx` — passer les nouveaux champs au shell.
- `src/components/public/public-shell.tsx` — bannière, layout, wrapper thémé, `BrandAvatar`.
- `src/app/dashboard/settings/page.tsx` — rendre le bloc Branding.
- `package.json` — `@vercel/blob`, `@dicebear/core`, `@dicebear/collection`.

**Créés**
- `src/lib/color.ts` — `brandTheme()`.
- `src/lib/avatar.ts` — résolution avatar + rendu SVG généré.
- `src/lib/avatar-pack.ts` — manifeste du pack 3D.
- `src/components/public/brand-avatar.tsx` — composant avatar polymorphe.
- `src/components/dashboard/branding-form.tsx` — UI back-office.
- `src/app/api/upload/route.ts` — upload Blob.
- `public/avatars/3d/*` + `LICENSE.md` — assets du pack 3D.
- Migration Drizzle générée.

---

## Tests / vérification

- `pnpm typecheck` et `pnpm build` verts (y compris sans `BLOB_READ_WRITE_TOKEN`).
- Test unitaire `color.ts` : foreground lisible pour brand clair **et** foncé ;
  fallback sur hex invalide.
- Test unitaire `avatar.ts` : chaque `avatarKind` se résout vers le bon mode de rendu ;
  `null` → initiales.
- Manuel : pour chaque source d'avatar + bannière + couleur + layout, la page publique
  reflète le choix ; en mode mock, l'onglet Upload est désactivé proprement.

## Risques / points ouverts

- **Licence du pack 3D** : à verrouiller avant d'embarquer les assets (critère ci-dessus).
- **Contraste couleur** : des couleurs de marque très claires peuvent rendre le texte
  blanc illisible → le calcul de `primaryForeground` doit être testé sur les cas limites.
- **Mode mock upload** : on désactive l'upload plutôt que de mocker un stockage local
  (choix assumé). À rediscuter si on veut tester l'upload en local sans token.
- **Poids des SVG générés** : rendus inline côté serveur, négligeable (quelques Ko).

## Décisions actées (brainstorming)

- Avatars générés rendus **côté serveur**, pas via l'API publique DiceBear au runtime.
- **Une seule** couleur de marque (pas d'accent séparé) pour la v1.
- Le pro **choisit** sa mise en page (Profil / Vitrine), défaut Profil.
- Stockage uploads = **Vercel Blob**, avec flag `BLOB_ENABLED` et fallback mock (upload désactivé).
