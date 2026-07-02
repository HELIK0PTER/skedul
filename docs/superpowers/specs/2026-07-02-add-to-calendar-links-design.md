# « Ajouter à mon calendrier » pour les clients finaux — Design

**Date :** 2026-07-02
**Statut :** validé

## Objectif

Après avoir réservé un créneau, le client final (le particulier qui réserve chez un
pro) doit pouvoir ajouter son rendez-vous à son propre calendrier — Google
Calendar, Outlook.com, ou Apple Calendar / tout client iCalendar via un fichier
`.ics`. Les liens apparaissent à deux endroits : la page de confirmation
`/[slug]/merci` et l'email de confirmation.

Ceci est indépendant de la synchronisation Google du **pro** (agenda « Skedul »
dédié, OAuth) : ici, aucun compte connecté — uniquement des liens web publics et
un fichier `.ics` généré à la volée.

## Non-objectifs

- Pas de bouton calendrier pour les achats de pack (`type === "pack"`) : pas d'horaire.
- Pas de mise à jour/annulation poussée vers le calendrier du client (le lien est
  un ajout ponctuel, pas une synchronisation).
- Pas de librairie tierce (type `add-to-calendar-button`).
- Pas de champ « lieu » : le schéma n'a pas de notion de lieu aujourd'hui.

## Architecture

### 1. Module pur `src/lib/calendar-links.ts`

Fonctions pures, testables sans réseau ni DB :

```ts
export interface CalendarLinkInput {
  title: string;        // eventType.title
  description: string;  // "Rendez-vous avec {businessName}"
  startAt: Date;        // booking.startAt (instant UTC)
  endAt: Date;          // booking.endAt
}

/** Lien "ajouter" Google Calendar (calendar.google.com/calendar/render). */
export function googleCalendarUrl(input: CalendarLinkInput): string;

/** Lien "ajouter" Outlook.com (outlook.live.com deeplink/compose). */
export function outlookCalendarUrl(input: CalendarLinkInput): string;

/** Contenu d'un fichier iCalendar (RFC 5545) pour l'événement. */
export function buildIcs(input: CalendarLinkInput & { uid: string }): string;
```

Détails :
- Dates au format `YYYYMMDDTHHMMSSZ` (UTC) partout — aucun besoin du fuseau du
  pro, les clients calendrier convertissent localement.
- `buildIcs` produit un `VCALENDAR`/`VEVENT` minimal : `UID` (id de réservation
  + domaine), `DTSTAMP`, `DTSTART`, `DTEND`, `SUMMARY`, `DESCRIPTION`, avec
  échappement iCalendar (`\n`, `,`, `;`, `\\`) et lignes CRLF.
- Tests unitaires colocalisés `src/lib/calendar-links.test.ts` (`node:test`).

### 2. Route `GET /api/bookings/[id]/calendar.ics`

- Route handler public (non authentifié) : l'id de réservation (cuid) sert de
  token de capacité, même modèle que `/merci?ref=`.
- Charge la réservation + titre de prestation + nom du pro ; 404 si introuvable
  ou statut `cancelled`.
- Répond `text/calendar; charset=utf-8` +
  `Content-Disposition: attachment; filename="rendez-vous.ics"`.
- Next.js 16 : `params` est async (`await params`).

### 3. Page `/[slug]/merci` (modif)

Dans le bloc `detail` du cas `type === "booking"`, sous les infos existantes :
trois liens rendus côté serveur (pas de `"use client"`) avec `Button asChild`
variant secondaire — « Google Agenda », « Outlook », « Apple / .ics ».
Les deux premiers sont des `<a href>` externes (nouvel onglet), le troisième
pointe vers la route `.ics`.

### 4. Email de confirmation (modif)

- `bookingConfirmationEmail` (`src/lib/email.ts`) accepte un paramètre
  optionnel `calendarLinks?: { google: string; outlook: string; ics: string }`
  et affiche « Ajouter à mon calendrier : Google · Outlook · Apple (.ics) »
  sous le tableau récapitulatif.
- `fulfillBooking` (`src/lib/payments.ts`) construit les liens avec les données
  déjà chargées (aucune requête supplémentaire) ; le lien `.ics` est absolu :
  `${env.APP_URL}/api/bookings/${bookingId}/calendar.ics`.

## Contenu de l'événement

- **Titre :** le titre de la prestation (`eventType.title`).
- **Description :** `Rendez-vous avec {businessName}`.
- **Horaires :** `booking.startAt` / `booking.endAt`.
- **Vie privée :** aucune donnée client (nom/email) dans les liens ni dans le
  fichier `.ics`, puisque la route est non authentifiée.

## Gestion d'erreurs

- Route `.ics` : 404 (réservation inconnue ou annulée) ; aucune autre surface
  d'erreur — la génération est pure.
- Liens Google/Outlook : simples URLs ; pas de mode dégradé nécessaire.

## Tests

- Unitaires (`calendar-links.test.ts`) : format des dates UTC, encodage des
  paramètres d'URL Google/Outlook, échappement + structure du `.ics`.
- Manuels : réserver un créneau en dev, vérifier les trois liens depuis la page
  `/merci` et l'email (mode mock console), ouvrir le `.ics` téléchargé.
