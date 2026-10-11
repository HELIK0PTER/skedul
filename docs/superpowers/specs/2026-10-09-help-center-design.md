# Centre d'aide — Design

> Un centre d'aide public (`/aide`) avec une FAQ éditable depuis l'admin, et un espace de
> **demandes** (questions, problèmes, idées) suivies dans un fil de messages. Quand une demande
> nécessite un développement, elle bascule sur un parcours en 6 étapes affiché par une **barre
> de progression**. Côté admin : boîte de réception, kanban des développements, édition FAQ.
>
> Date : 2026-10-09. Branche : `feat/help-center` (worktree `.claude/worktrees/help-center`).

## Problème

Un pro qui bloque sur Skedul n'a aucun endroit où chercher une réponse ni aucun canal pour
écrire à l'équipe. Les idées de fonctionnalités et les bugs remontent (quand ils remontent) par
des canaux externes, sans suivi : l'utilisateur ne sait jamais si sa demande a été lue, retenue
ou livrée.

## Décisions validées

1. **Approche** : tout en natif (tables Drizzle, Server Actions, pages Next). Aucun service
   tiers, aucune nouvelle dépendance.
2. **Public** : `/aide` (FAQ + recherche) est accessible sans compte. Créer et suivre une
   demande demande un compte (n'importe quel utilisateur connecté).
3. **FAQ éditable dans l'admin** : catégories + articles en base, publiés/dépubliés,
   réordonnables.
4. **Échanges** : un **fil de messages** par demande ; l'admin et l'auteur peuvent répondre ;
   e-mail à chaque nouvelle réponse.
5. **Progression à étapes fixes** : une demande classique suit Reçue → Prise en charge →
   Résolue ; une demande **acceptée en développement** suit Reçue → Acceptée → Planifiée → En
   développement → En test → Livrée. Chaque passage est daté dans le fil.
6. **Visibilité** : chaque utilisateur ne voit **que ses propres demandes**. Pas de roadmap
   publique.
7. **Pièces jointes** : images uniquement (png/jpg/webp), 3 par message, 5 Mo chacune, stockées
   en **privé** sur Vercel Blob.

## Hors périmètre

- Roadmap publique, votes « moi aussi », fusion de doublons.
- Chat temps réel, indicateur « en train d'écrire », notifications push.
- Réponses types (macros), assignation entre plusieurs admins, SLA.
- Suppression d'une demande (l'admin peut la **fermer**).
- Aide destinée aux clients finaux des pros sur les pages `/[slug]`.
- Multilingue (l'app entière est en français).

## Contraintes structurantes

- **Next.js 16** : `params`/`searchParams` asynchrones. Lire `node_modules/next/dist/docs/`
  avant d'écrire du code Next.
- **Neon HTTP** : pas de transaction interactive. Chaque écriture est une requête autonome ;
  l'ordre des écritures est choisi pour qu'un échec partiel laisse un état cohérent (§ 5).
- **Better Auth** : le cookie de session met en cache le rôle 5 min → toute autorisation admin
  passe par `getAdminUser()` (relit la base).
- **Suppression de compte** (`deleteUser`) = un seul `DELETE FROM "user"` : les nouvelles tables
  doivent cascader depuis `user` ou passer à `NULL`.
- **Migrations** : `pnpm db:generate` puis `pnpm db:apply drizzle/<fichier>.sql` en local
  (Windows) ; preview/prod migrent au déploiement (`pnpm db:migrate && pnpm build`).
- **Slugs** : `/aide` devient une route de l'app → `aide` rejoint `RESERVED_SEGMENTS`.
- **Rendu** : passage du skill `design-taste-frontend` avant d'écrire l'UI ; primitives
  `src/components/ui/`, thème violet de `globals.css`, icônes `lucide-react`.

## 1. Modèle de données (migration 0008, uniquement des ajouts)

### Enums

| Enum | Valeurs |
|---|---|
| `support_type` | `question`, `bug`, `feature`, `other` |
| `support_track` | `support`, `development` |
| `support_stage` | `received`, `in_progress`, `resolved`, `accepted`, `planned`, `in_development`, `testing`, `delivered` |
| `support_resolution` | `declined`, `closed` |
| `support_author_role` | `user`, `admin`, `system` |
| `support_message_kind` | `message`, `stage_change`, `resolution` |

### Tables

**`help_category`** — `id` text PK · `title` text · `slug` text unique · `icon` text (nom
d'icône lucide parmi une liste fermée) · `position` int · `created_at`.

**`help_article`** — `id` text PK · `category_id` → `help_category` **ON DELETE CASCADE** ·
`question` text · `answer` text · `position` int · `published` bool (défaut `false`) ·
`created_at` · `updated_at`. Index `(category_id, position)`.

**`support_request`** — `id` text PK · `number` serial unique (affiché « #42 ») · `user_id` →
`user` **ON DELETE CASCADE** · `type` support_type · `subject` text · `track` support_track
(défaut `support`) · `stage` support_stage (défaut `received`) · `resolution`
support_resolution nullable · `eta` date nullable (livraison estimée, parcours dev seulement) ·
`unread_by_user` bool (défaut `false`) · `unread_by_admin` bool (défaut `true`) ·
`last_activity_at` timestamptz · `created_at`. Index `(user_id, last_activity_at desc)` et
`(unread_by_admin)`.

**`support_message`** — `id` text PK · `request_id` → `support_request` **ON DELETE CASCADE** ·
`author_id` → `user` **ON DELETE SET NULL** · `author_role` support_author_role · `kind`
support_message_kind · `body` text (vide pour un pur changement d'étape) · `stage`
support_stage nullable (étape atteinte, `kind = stage_change`) · `resolution`
support_resolution nullable (`kind = resolution`) · `created_at`. Index
`(request_id, created_at)`.

**`support_attachment`** — `id` text PK · `message_id` → `support_message` **ON DELETE
CASCADE** · `pathname` text (chemin Blob privé) · `content_type` text · `size` int ·
`created_at`.

### Modèle d'état

- `stage` est **toujours une étape du parcours courant** (`track`).
- `resolution` est `NULL` tant que la demande vit. `declined` (« Non retenue ») ou `closed`
  (« Fermée ») figent la barre sur `stage` et l'affichent en gris.
- Une demande est **ouverte** si `resolution IS NULL` et `stage` n'est pas la dernière étape
  du parcours (`resolved` / `delivered`).
- Les dates sous chaque étape viennent des messages `stage_change` ; « Reçue » prend
  `created_at`.

### Contenu FAQ initial

Une migration SQL **custom** (`drizzle-kit generate --custom`, 0009) insère 5 catégories et
~8 articles **publiés**, rédigés à partir des vraies fonctionnalités (créer son compte et sa
page, prestations et disponibilités, packs prépayés et crédits, paiements, Google Agenda,
mot de passe oublié…). Elle s'applique dans les 3 environnements via le flux de migration
existant ; ensuite tout s'édite dans l'admin. Elle n'insère rien si `help_category` contient
déjà des lignes (`INSERT … WHERE NOT EXISTS`).

## 2. Logique pure — `src/lib/support.ts` (testée)

Aucune dépendance serveur ; partagée entre composants client et serveur.

- `TRACK_STEPS: Record<Track, Stage[]>` — `support: [received, in_progress, resolved]`,
  `development: [received, accepted, planned, in_development, testing, delivered]`.
- `stepIndex(track, stage)` → position dans la barre ; `progressRatio(track, stage)` → 0..1.
- `isOpen(request)` ; `isFinalStage(track, stage)`.
- `canSetStage(track, stage)` → l'admin peut placer la demande sur **n'importe quelle étape
  de son parcours** (y compris revenir en arrière, ex. En test → En développement).
- `canAcceptForDevelopment(request)` → `track = support`, `resolution = null`,
  `stage ≠ resolved`.
- `stageAfterUserReply(request)` → `resolved` → `in_progress` (réouverture) ; sinon inchangé.
  `canUserReply(request)` → faux si `resolution = closed`.
- Libellés FR, icônes et teintes par `type`, `stage`, `resolution` (une seule source pour les
  pages, les e-mails et l'admin).
- `normalizeSearch(text)` (minuscules, accents retirés via NFD) et
  `matchArticles(articles, query)` — tous les mots de la requête doivent apparaître dans la
  question ou la réponse ; question avant réponse dans le tri.
- `parseAnswer(text)` → blocs `{ paragraph | list }` avec segments `{ text | link }` :
  paragraphes séparés par une ligne vide, lignes `- ` en liste, URLs `https://…` et chemins
  `/…` en liens. Rendu en React, **jamais** de `dangerouslySetInnerHTML`.
- Constantes : `MAX_REQUESTS_PER_DAY = 5`, `MAX_MESSAGES_PER_DAY = 30`,
  `MAX_BODY = 20_000`, `MAX_SUBJECT = 140`, `MAX_ATTACHMENTS = 3`,
  `MAX_ATTACHMENT_BYTES = 5_000_000`, `ATTACHMENT_TYPES = [png, jpeg, webp]`.

## 3. Serveur

### Lectures — `src/server/support-queries.ts` (`server-only`)

- `getPublishedFaq()` → catégories (ordonnées) avec leurs articles publiés.
- `getMyRequests(userId)` → demandes de l'utilisateur, `last_activity_at desc`.
- `getMyRequest(userId, id)` → demande + messages + pièces jointes, ou `null` si elle n'est pas
  à lui (la page fait `notFound()`).
- `hasUnreadSupport(userId)` → pastille de la sidebar du dashboard.
- Admin : `getSupportInbox(filters, page)` (filtres : `à traiter` = `unread_by_admin` ou
  `stage = received` sans résolution ; `en cours` ; `résolues` ; par type), `getDevBoard()`
  (demandes `track = development`, `resolution IS NULL`, groupées par étape),
  `getSupportRequestForAdmin(id)` (+ auteur : nom, e-mail, pro éventuel),
  `countSupportToHandle()` (badge sidebar admin), `getFaqForAdmin()` (tout, publié ou non).

### Actions utilisateur — `src/server/support.ts` (`"use server"`)

Toutes : session obligatoire, validation zod, retour `{ ok: true, … } | { ok: false, error }`
en français. **Refusées pendant une impersonation** (`session.session.impersonatedBy`) pour
qu'un admin n'écrive jamais au nom d'un pro.

- `createSupportRequest(formData)` — type, sujet, description, images. Vérifie la limite
  journalière. Écrit la demande, puis le premier message, puis les images (§ 5). E-mail aux
  admins. Redirige vers `/aide/demandes/<id>`.
- `replyToSupportRequest(formData)` — propriétaire uniquement, `canUserReply`, limite de
  messages. Insère le message, applique `stageAfterUserReply` (avec un message `stage_change`
  système si la demande est rouverte), met `unread_by_admin = true`,
  `last_activity_at = now()`. E-mail aux admins.
- `markSupportRequestRead(id)` — appelé à l'ouverture de la page : `unread_by_user = false`.

### Actions admin — `src/server/support-admin.ts` (`"use server"`)

Toutes gardées par `getAdminUser()`.

- `adminReply(formData)` — message + images ; `unread_by_user = true` ; e-mail à l'auteur.
- `setSupportStage({ id, stage })` — `canSetStage` ; message `stage_change` ;
  `unread_by_user = true` ; e-mail à l'auteur.
- `acceptForDevelopment({ id, eta? })` — `canAcceptForDevelopment` ; `track = development`,
  `stage = accepted` ; message `stage_change` ; e-mail.
- `setSupportEta({ id, eta | null })` — parcours dev uniquement ; pas d'e-mail.
- `resolveSupportRequest({ id, resolution, reason })` — `declined` exige une raison (affichée
  dans le fil) ; `closed` raison facultative ; message `resolution` ; e-mail.
- `reopenSupportRequest(id)` — remet `resolution = NULL` ; message système.
- `markSupportRequestReadByAdmin(id)` — à l'ouverture : `unread_by_admin = false`.
- FAQ : `saveHelpCategory`, `deleteHelpCategory` (refusé si elle contient des articles),
  `moveHelpCategory(id, up|down)`, `saveHelpArticle`, `deleteHelpArticle`,
  `setHelpArticlePublished`, `moveHelpArticle(id, up|down)`. Chacune revalide `/aide`.

### Pièces jointes

- **Envoi** : les images voyagent dans le `FormData` de l'action (création, réponse, réponse
  admin). `next.config.ts` passe `experimental.serverActions.bodySizeLimit` à `"16mb"`
  (3 × 5 Mo + texte). Type et taille revérifiés côté serveur.
- **Stockage** : `put("support/<userId>/<nanoid>.<ext>", file, { access: "private" })`, où
  `userId` est l'**auteur de la demande** (même pour les images d'un admin), pour que la
  suppression du compte emporte tout le dossier.
- **Lecture** : `GET /api/support/attachments/[id]` — session requise ; autorisé si la demande
  appartient à l'utilisateur ou s'il est admin (`getAdminUser()`), sinon 404. Stream via
  `get(pathname, { access: "private" })`, `Cache-Control: private, max-age=3600`,
  `X-Content-Type-Options: nosniff`, `Content-Type` = type stocké.
- **Store dédié** (décidé le 2026-10-11) : le store existant `skedul` est public et refuse
  `access: "private"`. Les captures vont dans un second store **privé** `skedul-support`,
  relié au projet (production, preview, development) avec le préfixe `SUPPORT_BLOB` →
  variable `SUPPORT_BLOB_READ_WRITE_TOKEN` (`env.SUPPORT_BLOB_ENABLED`). Le store public
  reste réservé aux images de marque.
- **Sans store support** (`env.SUPPORT_BLOB_ENABLED` faux, dev sans jeton) : le champ image est
  masqué ; le reste fonctionne.
- **Suppression de compte** : `deleteUser` supprime aussi le préfixe `support/<userId>/`
  (best effort, même boucle `list`/`del` que `branding/`).

### E-mails — `src/lib/email.ts`

Nouveaux gabarits sur le `layout()` existant, envoyés via `sendEmail` (best effort, jamais
bloquant) :

- `supportNewRequestEmail` / `supportUserReplyEmail` → **tous les admins actifs** (rôle
  `admin`, non suspendus), lien `/admin/support/<id>`.
- `supportAdminReplyEmail` / `supportStageEmail` / `supportResolutionEmail` → l'auteur, lien
  `/aide/demandes/<id>`, avec l'étape atteinte et la barre en texte (« Étape 4 sur 6 : En
  développement »).
- Le contenu utilisateur inséré dans le HTML est échappé.

## 4. Pages et composants

### Public / utilisateur (header + footer du site)

- **`/aide`** — hero avec recherche (filtre en direct côté client sur la FAQ publiée), cartes
  de catégories (icône, titre, nombre d'articles ; clic = filtre), FAQ en accordéon (ancre
  `#a-<id>` qui ouvre l'article), encart « Tu n'as pas trouvé ta réponse ? » → créer une
  demande. Connecté : bandeau « Mes demandes » (demandes ouvertes, mini-barre). La page est
  **dynamique** (lit la session) ; les articles viennent de la base à chaque requête.
- **`/aide/demandes`** — connexion requise (sinon `/sign-in?next=/aide/demandes`). Liste de
  cartes : icône du type, `#numéro`, sujet, mini-barre, statut, dernière activité, point
  « nouveau » si `unread_by_user`. État vide engageant avec CTA.
- **`/aide/demandes/nouvelle`** — étape 1 : choix du type parmi 4 grandes cartes. Étape 2 :
  sujet, description, images (vignettes avec retrait). Suggestions d'articles FAQ sous le
  sujet pendant la frappe (`matchArticles`). Bouton « Envoyer ma demande ».
- **`/aide/demandes/[id]`** — barre d'étapes (dates, étape courante animée, livraison
  estimée), puis le fil : bulles utilisateur / admin, événements d'étape centrés, images en
  vignettes cliquables. Composeur en bas (désactivé avec explication si `closed` ou pendant une
  impersonation). Marque la demande lue à l'ouverture.
- **Connexion** : `/sign-in` et `/sign-up` acceptent `?next=<chemin>` (chemin relatif commençant
  par `/` et pas par `//`, sinon ignoré) ; après connexion — e-mail ou Google (`callbackURL`) —
  on y va directement (le choix
  Admin/Client des admins est sauté quand `next` est présent).
- **Liens d'entrée** : « Centre d'aide » dans la sidebar du dashboard (pastille si non lu) et
  dans le footer du site.

### Admin (`/admin/support`, onglet « Support » + badge « à traiter »)

- **Boîte de réception** (`/admin/support`) — puces de filtre (À traiter · En cours · Résolues ·
  Toutes) + type ; lignes : point non lu, `#numéro`, type, sujet, auteur, mini-barre,
  dernière activité. Pagination existante (`components/admin/pagination.tsx`).
- **Développements** (`/admin/support/developpements`) — kanban 5 colonnes (Acceptée ·
  Planifiée · En développement · En test · Livrée) ; carte = sujet, auteur, ancienneté,
  livraison estimée ; boutons ← / → pour changer de colonne. « Livrée » n'affiche que les 30
  derniers jours.
- **Détail** (`/admin/support/[id]`) — fil + composeur à gauche ; panneau à droite : auteur
  (lien `/admin/users/[id]`), barre d'étapes **cliquable**, « Accepter en développement »,
  livraison estimée, « Ne pas retenir » (raison obligatoire, dialog), « Fermer », « Rouvrir ».
- **FAQ** (`/admin/support/faq`) — catégories (titre, icône parmi une liste, ordre) et leurs
  articles (question, réponse avec aperçu du rendu, publié, ordre) ; création/édition en
  dialog.

### Composants — `src/components/support/`

`stage-progress.tsx` (barre complète **et** mini, un seul composant avec `size`),
`request-type-picker.tsx`, `request-card.tsx`, `message-thread.tsx`, `message-composer.tsx`
(texte + images, partagé user/admin via une prop d'action), `attachment-grid.tsx`,
`faq-browser.tsx` (recherche + catégories + accordéon), `faq-answer.tsx` (rendu de
`parseAnswer`). Admin : `src/components/admin/support-*.tsx` (inbox, kanban, panneau,
éditeur FAQ).

### Analytics et routes

- `aide` ajouté à `RESERVED_SEGMENTS` ; `/aide/demandes` ajouté aux `UNTRACKED_PREFIXES`
  (pages privées). `/aide` reste comptée comme page publique.
- Avant le déploiement prod : vérifier qu'aucun pro n'a déjà le slug `aide` (requête Neon en
  lecture). Si c'est le cas, on s'arrête et on demande.

## 5. Ordre des écritures (sans transaction)

- **Création** : demande → premier message → upload des images → lignes `support_attachment`.
  Si un upload échoue, la demande et le message restent ; l'action renvoie `ok` avec un
  avertissement (« 1 image n'a pas pu être envoyée »).
- **Changement d'étape** : `UPDATE support_request … WHERE id = ? AND track = ?` (garde contre
  un changement concurrent de parcours), puis insertion du message `stage_change`. Si l'UPDATE
  ne touche aucune ligne, rien n'est inséré et l'action renvoie une erreur.
- **Limites** (5 demandes, 30 messages par 24 h) : comptées par `SELECT count(*)` avant
  insertion. Une course peut laisser passer une demande de trop : acceptable.

## 6. Erreurs

- Messages FR courts, sans jargon : « Tu as atteint la limite de 5 demandes par jour. Réessaie
  demain. », « Cette demande est fermée. », « Image trop lourde (5 Mo max). ».
- Demande inexistante ou d'un autre utilisateur → `notFound()`.
- Un e-mail en échec est journalisé, jamais remonté (comportement de `sendEmail`).

## 7. Tests

`tsx --test`, fichiers `*.test.ts` à côté du code, comme le reste du projet :

- `support.test.ts` : étapes par parcours, `stepIndex`/`progressRatio`, `canSetStage` (refuse
  une étape d'un autre parcours), `canAcceptForDevelopment`, `stageAfterUserReply`,
  `canUserReply`, `isOpen`, `normalizeSearch` (accents, casse), `matchArticles` (tous les mots,
  tri), `parseAnswer` (paragraphes, listes, liens, pas de HTML interprété).
- `analytics.test.ts` : `aide` réservé ; `/aide/demandes/x` non suivi ; `/aide` suivi.
- Validation de `next` (fonction pure `safeNextPath` dans `src/lib/`, testée : `/aide` ok,
  `//evil.com`, `https://…`, `javascript:` refusés).
- Vérification manuelle dans le navigateur (worktree, port 3100) : parcours complet pro démo
  (créer, joindre une image, répondre) et admin (répondre, accepter en dév, avancer sur le
  kanban, ne pas retenir, éditer la FAQ), en clair et en sombre si le thème le permet, et en
  mobile.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` verts.

## 8. Livraison

1. Migrations 0008 (schéma) et 0009 (contenu FAQ) appliquées sur la branche Neon
   `development` via `pnpm db:apply`.
2. Commits par unité (schéma, logique pure, actions, pages user, pages admin, e-mails, FAQ),
   PR vers `main`.
3. Preview puis prod au moment choisi par l'utilisateur (`pnpm deploy:preview` /
   `pnpm deploy:prod`), qui appliquent 0008–0009 au build.
4. AGENTS.md : une puce « Centre d'aide » (tables, parcours, Blob privé, `next`, segments
   réservés).
