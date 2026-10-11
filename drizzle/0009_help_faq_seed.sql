-- Starter FAQ (5 categories, 10 published articles). Runs once in every
-- environment; afterwards the FAQ is edited from /admin/support/faq.
-- Skipped entirely when the admin already created categories.
INSERT INTO "help_category" ("id", "title", "slug", "icon", "position")
SELECT * FROM (VALUES
  ('hc_demarrer', 'Bien démarrer', 'bien-demarrer', 'rocket', 0),
  ('hc_reservations', 'Réservations et planning', 'reservations-et-planning', 'calendar', 1),
  ('hc_packs', 'Packs prépayés', 'packs-prepayes', 'ticket', 2),
  ('hc_compte', 'Compte et connexion', 'compte-et-connexion', 'user', 3),
  ('hc_support', 'Vos demandes', 'vos-demandes', 'help', 4)
) AS v("id", "title", "slug", "icon", "position")
WHERE NOT EXISTS (SELECT 1 FROM "help_category");
--> statement-breakpoint
INSERT INTO "help_article" ("id", "category_id", "question", "answer", "position", "published")
SELECT * FROM (VALUES
  ('ha_creer_page', 'hc_demarrer', 'Comment créer ma page de réservation ?',
   E'Créez votre compte sur /sign-up, puis indiquez le nom de votre activité : Skedul génère votre page publique et son adresse.\n\nAjoutez ensuite depuis votre espace :\n- Prestations : la durée, le prix et la description de chaque rendez-vous\n- Disponibilités : vos horaires de la semaine\n\nVos clients peuvent réserver dès qu''une prestation a des horaires.', 0, true),
  ('ha_lien_page', 'hc_demarrer', 'Où trouver le lien de ma page publique ?',
   E'Le lien est affiché sur la vue d''ensemble de votre espace, avec un bouton pour le copier. Le menu propose aussi « Voir ma page publique ».\n\nPartagez-le sur vos réseaux, dans votre bio ou par message : vos clients réservent sans créer de compte.', 1, true),
  ('ha_conges', 'hc_reservations', 'Comment bloquer des jours de congé ?',
   E'Ouvrez Indisponibilités dans votre espace et ajoutez une journée entière ou une plage horaire. Ces créneaux disparaissent de votre page publique.\n\nVos horaires habituels ne changent pas : l''indisponibilité ne s''applique qu''aux dates choisies.', 0, true),
  ('ha_planning', 'hc_reservations', 'Où voir mes rendez-vous de la semaine ?',
   E'Le Planning affiche vos séances et rendez-vous semaine par semaine. Cliquez sur une séance pour voir ses participants et ses détails.', 1, true),
  ('ha_google', 'hc_reservations', 'Puis-je synchroniser Skedul avec Google Agenda ?',
   E'Oui. Dans Réglages, la carte Google Agenda permet de connecter votre compte Google et de synchroniser vos rendez-vous avec votre agenda.', 2, true),
  ('ha_packs', 'hc_packs', 'Comment fonctionnent les packs prépayés ?',
   E'Un pack est un lot de crédits (par exemple 4 séances) que vos clients achètent en une fois. Chaque réservation utilise ensuite un crédit, sans nouveau paiement.\n\nVous créez vos packs depuis la page Packs prépayés : nombre de crédits, prix, et prestation concernée si le pack ne vaut que pour l''une d''elles.', 0, true),
  ('ha_credits', 'hc_packs', 'Comment un client utilise-t-il ses crédits ?',
   E'Au moment de réserver sur votre page, un client qui a des crédits restants peut utiliser un crédit au lieu de payer le créneau. Il peut aussi retrouver son solde depuis votre page publique.', 1, true),
  ('ha_mot_de_passe', 'hc_compte', 'J''ai oublié mon mot de passe',
   E'Sur la page de connexion, cliquez sur « Mot de passe oublié ? » et saisissez votre e-mail. Vous recevez un lien valable 1 heure pour choisir un nouveau mot de passe.\n\nPar sécurité, toutes vos sessions ouvertes sont déconnectées après le changement.', 0, true),
  ('ha_google_connexion', 'hc_compte', 'Puis-je me connecter avec Google ?',
   E'Oui, avec « Continuer avec Google » sur la page de connexion. Si un compte Skedul existe déjà avec la même adresse e-mail, Skedul vous demande d''abord son mot de passe pour relier les deux.', 1, true),
  ('ha_suivi_demande', 'hc_support', 'Comment suivre une demande envoyée à l''équipe ?',
   E'Chaque demande a sa page dans le Centre d''aide, rubrique Mes demandes : la barre de progression montre où elle en est et l''équipe vous répond dans le fil de messages.\n\nVous recevez aussi un e-mail à chaque réponse ou changement d''étape.', 0, true)
) AS v("id", "category_id", "question", "answer", "position", "published")
WHERE EXISTS (SELECT 1 FROM "help_category" WHERE "id" = 'hc_demarrer')
  AND NOT EXISTS (SELECT 1 FROM "help_article");
