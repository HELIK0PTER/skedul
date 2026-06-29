# Cours de groupe / capacité par créneau — Design

> Spec du **P0 #1** de [TODO.md](../../../TODO.md). Périmètre validé : le **bloc groupe
> complet** — moteur de capacité + questionnaire d'inscription (#5) + roster pro + notif
> pro (#7), en un seul spec, structuré en unités indépendantes pour rester découpable au
> moment du plan d'implémentation.
>
> Date : 2026-06-20. Numérotation TODO au moment de l'écriture : questionnaire = #5,
> notif pro = #7, vue calendrier = #14.

## Problème

Skedul est aujourd'hui un outil de réservation **1:1 strict** :

- `eventType` n'a aucune notion de capacité (implicitement 1).
- Une réservation **bloque tout le créneau** : `loadBookableSlots`
  ([slots.ts](../../../src/lib/slots.ts)) charge chaque booking `pending|confirmed` comme
  `BusyInterval`, et `computeSlots` ([availability.ts](../../../src/lib/availability.ts))
  retire tout créneau qui chevauche. La 1re résa fait disparaître le créneau.
- La création de booking est un **check-then-insert sans garde atomique**
  ([public.ts](../../../src/server/public.ts)) : `isSlotAvailable` est une *lecture* des
  créneaux calculés, puis on insère. Aucun verrou par créneau → course latente même à
  capacité 1, et survente garantie à capacité N.

Le métier cible (cours d'altinha en **petits groupes par niveau**) repose entièrement sur
des séances collectives. Il faut une capacité N, des réservations multiples sur un même
créneau, « X places restantes », un blocage à plein, et une dispo qui **ne se ferme plus à
la 1re résa**.

### Contrainte structurante

Neon HTTP (`drizzle-orm/neon-http`) **n'a pas de transactions interactives**. Le seul
pattern de concurrence sûr utilisé dans le codebase est l'**UPDATE gardé atomique** de la
dépense de crédit ([public.ts L279](../../../src/server/public.ts)) :
`credits_remaining = credits_remaining - 1 WHERE credits_remaining > 0`, avec `RETURNING`
pour détecter le succès. Or aujourd'hui un créneau **n'est pas une ligne en base** (il est
calculé à la volée) — il n'y a donc rien à mettre à jour atomiquement. C'est le cœur du
design.

## Décisions validées

1. **Périmètre** : bloc groupe complet (capacité + questionnaire + roster + notif).
2. **Niveau de capacité** : **par prestation, surchargeable par séance**. L'`eventType`
   porte une capacité par défaut ; la séance, créée à la 1re résa, en hérite ; le pro peut
   ajuster une séance précise.
3. **Questionnaire** : **builder léger par prestation** (libellé + type texte court / choix
   unique / oui-non), réponses attachées à la résa et visibles dans le roster.
4. **Approche concurrence** : **séance matérialisée + compteur de sièges en upsert gardé**
   (voir Alternatives). Unifie 1:1 et groupe (1:1 = séance de capacité 1).
5. **« Un cours à la fois »** : une séance occupe le pro pour les *autres* prestations à
   cet instant, mais ses propres sièges sont partagés.

## Alternatives considérées

- **A — Séance matérialisée + compteur en upsert gardé (RETENU).** Une table `session`
  porte `seatsRemaining`, décrémenté par un `INSERT … ON CONFLICT DO UPDATE … WHERE
  seats_remaining > 0`. Atomique, sans transaction, calque l'idiome de la dépense de
  crédit. Unifie 1:1 et groupe.
- **B — `capacity` sur `eventType` + comptage des bookings (REJETÉ).** Pas de table
  séance ; dispo = `capacity − count(bookings)`. Schéma plus léger, mais l'insert
  conditionnel `WHERE (SELECT count…) < cap` **n'est pas sûr en concurrence** sous READ
  COMMITTED (deux inserts simultanés voient `cap−1` et dépassent). Corrigeable seulement
  par index de siège + retry — bricolage. Écarté pour la correction.
- **C — `SELECT FOR UPDATE` / advisory lock (IMPOSSIBLE).** Nécessite une transaction
  tenue ; le driver `neon-http` ne le permet pas.

## Architecture — 4 unités sur un socle

| Unité | Rôle | Dépend de |
|---|---|---|
| **Moteur de capacité** | Séances, claim/release atomique, dispo « séance-aware » | socle |
| **Questionnaire (#5)** | Questions par prestation, réponses par résa | socle |
| **Roster pro** | « Qui est dans chaque séance » + réponses | capacité + questionnaire |
| **Notif pro (#7)** | E-mail au pro à chaque résa confirmée | capacité |

Le **socle** = changements de schéma + refactor du flux de booking. Chaque unité est
testable et livrable indépendamment.

## Modèle de données

### Nouvelle table `session`

Support de la séance et du compteur atomique.

```
session(
  id              text pk,
  professionalId  text -> professional.id  (cascade),
  eventTypeId     text -> event_type.id    (cascade),
  startAt         timestamptz,
  endAt           timestamptz,
  capacity        int,
  seatsRemaining  int,
  createdAt, updatedAt
)
unique(eventTypeId, startAt)        -- clé du upsert atomique
index(professionalId, startAt)      -- roster / dispo
```

`seatsRemaining` est le compteur autoritaire. `capacity` est snapshotée à la création
(défaut = `eventType.capacity`) et modifiable par le pro (surcharge par séance) ; le
`ON CONFLICT` ne touche jamais `capacity`, donc une surcharge persiste.

### `eventType` — colonne ajoutée

```
+ capacity int NOT NULL DEFAULT 1
```

**1 = 1:1** : les prestations existantes restent 1:1 tant que le pro ne monte pas la
valeur. Modèle unifié, l'ancien comportement est le cas particulier capacité 1.

### `booking` — colonne ajoutée

```
+ sessionId text REFERENCES session(id) ON DELETE restrict   -- nullable, toujours peuplé par le nouveau code
```

### Questionnaire — deux tables

```
question(
  id            text pk,
  eventTypeId   text -> event_type.id (cascade),
  label         text,
  type          enum question_type [text | choice | boolean],
  options       text[],            -- pour type=choice
  required      boolean default false,
  position      int,               -- ordre d'affichage
  createdAt, updatedAt
)

booking_answer(
  id            text pk,
  bookingId     text -> booking.id  (cascade),
  questionId    text -> question.id (set null),
  questionLabel text,               -- snapshot, roster lisible même après édition/suppression
  value         text                -- 'Débutant' | 'true' | texte libre
)
unique(bookingId, questionId)
```

`questionLabel` + `value` sont snapshotés pour que le roster survive aux éditions de
questions.

## Moteur de capacité

### Claim d'un siège (atomique)

```ts
const claimed = await db.insert(session)
  .values({
    professionalId, eventTypeId, startAt, endAt,
    capacity: evt.capacity,
    seatsRemaining: evt.capacity - 1,
  })
  .onConflictDoUpdate({
    target:   [session.eventTypeId, session.startAt],
    set:      { seatsRemaining: sql`${session.seatsRemaining} - 1` },
    setWhere: sql`${session.seatsRemaining} > 0`,
  })
  .returning({ id: session.id, seatsRemaining: session.seatsRemaining });

if (claimed.length === 0) return { ok: false, error: "Cette séance est complète." };
```

- Pas de séance → insert avec `cap−1`, renvoie la ligne (1er inscrit).
- Séance, sièges > 0 → décrémente, renvoie la ligne.
- Séance pleine → `setWhere` faux → 0 ligne → refus « complet ».

Atomique, sans transaction. Vérifier que Drizzle expose `setWhere` sur
`onConflictDoUpdate` ; sinon, passer par `db.execute(sql\`…\`)` brut.

### Release d'un siège (annulation)

```sql
UPDATE session SET seats_remaining = seats_remaining + 1
WHERE id = :sessionId AND seats_remaining < capacity;
```

Gardé pour ne jamais dépasser `capacity`.

### Surcharge / baisse de capacité

Surcharge = `UPDATE session.capacity` + recalcul `seatsRemaining = newCapacity − booked`.
Baisser sous le nombre d'inscrits est permis (ferme des sièges, `seatsRemaining` clampé à
≥ 0) mais **n'annule jamais** d'inscrit existant.

### Dispo « séance-aware » (`slots.ts` + `availability.ts`)

Règle « un cours à la fois ». Pour un créneau candidat `(E, T)` de fin `T+durée` :

1. **Bloqué** si une séance d'un **autre** `(eventTypeId, startAt)` chevauche
   `[T − bufferBefore, fin + bufferAfter]` (autres cours, y compris la même prestation à un
   autre horaire).
2. S'il existe une séance **exactement** à `(E, T)` : bookable **ssi** `seatsRemaining > 0`.
3. `timeOff` bloque comme aujourd'hui.

`loadBookableSlots` charge donc les `session` (au lieu des `booking`) et fournit à
`computeSlots` : `busy` = séances des **autres** prestations + timeOff (intervalles), et une
map `start → seatsRemaining` pour la prestation courante. Chaque `Slot` porte désormais
`seatsRemaining` et `capacity`.

## Flux de réservation (refactor)

Ordre impératif dans [public.ts](../../../src/server/public.ts) : **valider le créneau →
claim siège → reste**. La validation (`loadBookableSlots`, désormais séance-aware) empêche
de booker un horaire hors planning ; le **claim atomique est l'autorité anti-survente** et
tranche la course concurrente (deux clients voient le dernier siège, passent la
validation, claiment → un obtient le siège, l'autre reçoit 0 ligne → « complet »).

- **Gratuit** : valider → claim → insert booking `confirmed` (+`sessionId`) → réponses →
  `fulfillBooking`.
- **Crédit** : valider → **claim siège** → décrément crédit (gardé). Si le décrément
  échoue → **release siège** + erreur, on s'arrête. Sinon → insert booking
  (+`sessionId` +`packPurchaseId`) → réponses → `fulfillBooking`.
- **Payant (Stripe/mock)** : valider → claim → insert booking `pending` (+`sessionId`) →
  réponses → checkout. Le siège est tenu pendant le `pending` — **même sémantique
  qu'aujourd'hui** (un `pending` bloque déjà le créneau).

Les réponses au questionnaire sont insérées en `booking_answer` juste après la création du
booking, avec validation serveur des questions `required`.

## Questionnaire (#5)

- **Builder pro** : sur l'écran prestation
  ([dashboard/event-types](../../../src/app/dashboard/event-types/page.tsx)), gestion d'une
  liste de questions (libellé + type + requis ; `options` pour `choice` ; `position` pour
  l'ordre). Actions CRUD dans [pro.ts](../../../src/server/pro.ts).
- **Public** : le formulaire de booking
  ([\[slug\]/book/\[eventTypeId\]](../../../src/app/[slug]/book/[eventTypeId]/page.tsx))
  rend les questions de la prestation ; validation des `required` côté serveur.
- **Stockage** : `booking_answer`, snapshot du libellé.

## Roster pro

- Query `getProSessions(proId)` dans [queries.ts](../../../src/server/queries.ts) :
  séances à venir, avec `capacity / filled / remaining`, et par séance la liste des
  inscrits + leurs réponses.
- UI : **groupement par séance** dans
  [dashboard/bookings](../../../src/app/dashboard/bookings/page.tsx) pour les prestations de
  capacité > 1 (les 1:1 restent une ligne par résa). La vraie vue agenda est le **#14**,
  hors périmètre.

## Notif pro (#7)

- Template `proNewBookingEmail` dans [email.ts](../../../src/lib/email.ts), envoyé dans
  `fulfillBooking` ([payments.ts](../../../src/lib/payments.ts)) — donc **une seule fois**,
  `fulfillBooking` étant déjà idempotent — à l'e-mail du compte pro
  (`professional.userId → user.email`, jointure à ajouter). Contenu : client, prestation,
  horaire, remplissage `X/N`, réponses clés. Respecte `env.RESEND_ENABLED` (live/mock)
  comme les autres envois.

## UI publique

- « **X places restantes** » par créneau quand `capacity > 1` ; créneau plein →
  désactivé / « Complet ». Pour capacité 1, pas de compteur (comportement actuel).
- Libellé prix « **/ personne** » quand `capacity > 1` (le prix par résa existe déjà ; pur
  copy).

## Migration / backfill

1. `pnpm db:generate` puis `pnpm db:migrate` (cible `DATABASE_URL`).
2. Backfill : pour chaque booking futur `pending|confirmed`, créer une séance
   (`capacity = 1`, `seatsRemaining = 0`) et renseigner `booking.sessionId`.
3. `eventType.capacity` défaut 1 → aucune prestation existante ne change de comportement.

## Tests

- [availability.test.ts](../../../src/lib/availability.test.ts) étendu : séance pleine
  exclue, séance partielle encore bookable, séance d'une autre prestation qui bloque,
  buffers respectés.
- Nouveau test du claim : N+1 claims sur la même séance → exactement N réussissent, le
  surnuméraire reçoit « complet » ; le release rend le siège. Logique testée en unitaire ;
  le `ON CONFLICT` réel vérifié en intégration sur une branche Neon.
- `pnpm typecheck` et `pnpm build` restent verts.

## Hors périmètre (YAGNI)

Liste d'attente (#10), niveau-filtre (#9), récurrence (#11), lieux (#4), rappels (#6),
espace client (#8), vue calendrier (#14), e-mail d'annulation / remboursement (#13),
i18n (#2). Nouveaux libellés en **français**, cohérents avec l'existant.

**Dette préexistante notée, non traitée ici** : nettoyage des bookings `pending` abandonnés
(siège fantôme tenu jusqu'à expiration). Le comportement n'est pas aggravé par ce spec —
un `pending` bloque déjà le créneau aujourd'hui. À traiter en follow-up (expiration /
release sur annulation de checkout).
