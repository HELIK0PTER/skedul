# TODO — Besoins produit

Gap analysis entre les besoins d'un client type (cours d'altinha en petits groupes à
Paris, communication PT/FR) et l'état actuel de Skedul (outil de réservation **1:1**).

> Cas d'usage de référence : cours d'1h en **petits groupes par niveau**, offres
> Essai 15 € / Individuel 30 € / Groupe 25 €/pers / Pack 4 cours 85 €, créneaux fixes
> matin (10h/11h/12h) et soir (17h30/18h30/19h30) du lun. au sam., entre Nation et
> Tuileries, questionnaire d'inscription (niveau, expérience), business multilingue.

---

## ✅ Déjà couvert (rien à faire)

- [x] **Pack 4 cours / 85 €** — modèle `pack` (credits=4, prix, scopable à un service). `src/lib/db/schema.ts`
- [x] **Devise EUR + fuseau Europe/Paris** — valeurs par défaut.
- [x] **Créneaux fixes** (10/11/12 et 17h30/18h30/19h30) — faisable **sans dev** via 2 règles de dispo/jour (10:00–13:00 et 17:30–20:30, durée 1h). Config, pas un manque.
- [x] **Paiement (Stripe + mock) + e-mail de confirmation** — en place.

---

## 🔴 P0 — Bloquants

- [ ] **1. Cours de groupe / capacité par créneau**
  Aujourd'hui : 1 créneau = 1 seul client (1:1 strict, aucune capacité). Tout le métier
  repose sur des petits groupes.
  Besoin : champ *capacité*, réservations multiples sur un même slot, « X places
  restantes », blocage quand plein, gestion de la dispo qui ne se ferme plus à la 1re résa.
  → Plus gros chantier (schéma + logique de slots + booking + UI publique).

- [ ] **2. App multilingue (i18n)**
  Aujourd'hui : UI codée en dur en français (`lang="fr"`, libellés, e-mails). Aucune lib i18n.
  Besoin : FR/PT/EN minimum, sélecteur de langue sur la page publique, idéalement contenu
  pro multilingue (titres/descriptions de services).

- [ ] **3. Plusieurs offres tarifaires (essai / individuel / groupe)**
  Contournable en partie via 3 *services* (1 prix chacun, déjà supporté), **mais** :
  - le **groupe à 25 €/pers** dépend du P0 #1 (capacité) ;
  - le **cours d'essai** devrait être *limité à 1 par client* — notion inexistante.

---

## 🟠 P1 — Importants

- [ ] **4. Lieux multiples** — aucune notion de lieu/adresse. « Nation ↔ Tuileries ».
  Besoin : champ lieu par service ou par créneau, affiché au client (idéalement point de RDV/carte).

- [ ] **5. Questions d'inscription personnalisées** — on ne collecte que nom/e-mail/tél/notes.
  Besoin : questions par service (niveau débutant/inter/avancé, « déjà touché un ballon ? »),
  affichées au booking et transmises au pro pour composer les groupes.

- [ ] **6. Rappels automatiques** — seul l'e-mail de confirmation existe.
  Besoin : rappels (J-1 / H-2), idéalement **WhatsApp/SMS** vu l'usage actuel.

- [ ] **7. Notification au pro des nouvelles résas** — le pro n'est pas notifié aujourd'hui.
  Besoin : alerte e-mail (a minima) à chaque réservation pour organiser les groupes.

- [ ] **8. Espace client (côté réservant)** — aujourd'hui le client réserve/achète sans
  espace dédié : pas d'écran pour suivre ses résas, voir ses crédits de pack restants ou son
  historique. Le modèle a déjà les amorces (rôle `client` sur `user`, `customer.userId` qui
  relie un customer à un compte auth), mais aucune UI.
  Besoin : un espace client connecté (mes réservations à venir/passées, crédits de pack
  restants + expiration, achats, annulation, infos perso/questionnaire).
  Note : un **pro peut aussi être client** s'il réserve chez un autre pro → le même compte
  doit pouvoir basculer entre son back-office pro et son espace client.

---

## 🟡 P2 — Confort / différenciants

- [ ] **9. Niveau comme attribut structurant** — taguer un créneau « groupe intermédiaire », filtrer côté client.
- [ ] **10. Liste d'attente** — les petits groupes se remplissent vite.
- [ ] **11. Réservation récurrente / abonnement** — les élèves reviennent chaque semaine.
- [ ] **12. Expiration des crédits de pack** — aujourd'hui valables à vie.
- [ ] **13. E-mail d'annulation + UI de remboursement** — statut en base, pas d'envoi ni d'écran.
- [x] **14. Vue calendrier du planning (back-office)** — page **Planning** : vue semaine
  (séances de groupe X/N, RDV 1:1, indispos grisées), navigation par semaine, détail de séance
  (roster + réponses + capacité), déplacement d'inscrit, annulation, inscription manuelle.
  Spec `docs/superpowers/specs/2026-06-29-planning-back-office-design.md`.

---

**En une phrase :** Skedul est aujourd'hui un outil de réservation **1:1** ; ce client a
besoin d'un outil de **cours collectifs multilingue avec lieux et questionnaire**. Les deux
vrais virages structurels sont le **P0 #1 (capacité de groupe)** et le **P0 #2 (i18n)** ;
le reste s'empile dessus.
