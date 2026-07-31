# Plan de mesure GA4 — Kifeh

Fondé sur les données réelles du 3-31/07/2026 (352 utilisateurs, 40 s
d'engagement, 0 événement clé, organique ≈ 0). Priorité n° 1 de l'addendum
growth : FIABILISER LA MESURE avant toute dépense d'acquisition.

Propriété : G-B33KFSSPSG · Consent Mode v2 (refus par défaut, bannière fr/ar,
signaux publicitaires coupés) · sandbox exclue.

## 1. Architecture technique

`public/js/analytics.js` porte : le journal local `window.__trackLog`
(toujours rempli, aucun envoi sans consentement — c'est la surface de test),
la CANONISATION des noms (les appels historiques sont traduits vers la
taxonomie ci-dessous à l'envoi — un seul vocabulaire côté GA4), et les
paramètres globaux attachés à chaque événement : `selected_country`,
`interface_language`, `entry_page`.

## 2. Taxonomie des événements (implémentés)

| Événement canonique | Déclencheur | Paramètres spécifiques |
|---|---|---|
| `local_situation_displayed` | carte héro rendue avec données (1×/chargement) | — |
| `incident_detail_opened` | ouverture d'une fiche | — |
| `country_selected` | choix explicite d'un pays | `selected_country` |
| `language_changed` | bascule fr/ar (point unique i18n) | `interface_language` |
| `location_requested` / `location_resolved` / `location_failed` | bouton « Ma position » | — |
| `fire_map_opened` | filtre feux activé | — |
| `layer_enabled` / `layer_disabled` | calques satellite, météo, zones brûlées, routes | `layer_name` |
| `source_panel_opened` | panneau Calques & sources | — |
| `official_update_opened` | feuille vigilance officielle | `alerts`, `monitored` |
| `zone_follow_started` | ouverture du parcours de suivi | — |
| `zone_follow_completed` | zone réellement suivie | `notif` |
| `alert_channel_selected` | canal choisi (push/e-mail) | `alert_channel`, `radius_km` |
| `push_permission_requested` / `_granted` / `_refused` | permission navigateur | — |
| `incident_report_started` | parcours de signalement entamé | `incident_type` |
| `incident_location_selected` | étape localisation validée | `location_source` |
| `incident_report_submitted` | signalement publié | `incident_type`, `status` |
| `dfci_displayed` / `dfci_copied` | aperçu du repère / copie (JAMAIS le code envoyé) | `context` |
| `emergency_call_clicked` | tout lien `tel:` — CRITIQUE d'utilité, jamais une conversion commerciale | — |
| `map_shared` + `share_channel_selected` | partage d'une fiche | `share_channel` |
| `pwa_install_prompted` / `pwa_installed` | invite (2ᵉ visite) / installation réelle | `via` |
| `return_after_alert` | arrivée via `src=push\|email\|digest` | `alert_channel` |
| `return_after_share` | arrivée via `from=share` | — |

Planifiés avec leurs lots : `replay_started/paused/time_changed`,
`back_to_live_clicked` (Lot replay UI) · `methodology_opened` (Lot SEO) ·
`email_alert_confirmed` (page de confirmation serveur, à baliser).

## 3. Événements CLÉS — action console GA4 (Farah, ~5 min)

Admin → Événements → marquer comme événements clés :

    zone_follow_completed
    alert_channel_selected
    push_permission_granted
    incident_report_submitted
    map_shared
    pwa_installed
    return_after_alert

`emergency_call_clicked` reste un événement d'utilité SUIVI mais jamais
« conversion ». Vérifier ensuite dans DebugView (des événements arrivent dès
ce déploiement).

## 4. Vie privée — interdits ABSOLUS (testés par revue de code)

Jamais envoyés à GA4 : coordonnées GPS exactes, adresse, téléphone, e-mail,
contenu d'un signalement, code DFCI, statut personnel de sécurité,
identifiant précis d'une zone suivie, tout ce qui permet de reconstruire une
localisation privée. Les paramètres autorisés sont des CATÉGORIES
(`selected_country`, `layer_name`, `incident_type`, tranches de rayon).

## 5. Convention UTM (obligatoire pour toute publication)

    utm_source   : instagram | facebook | linkedin | whatsapp | <nom_média> | kifeh_alert | share
    utm_medium   : organic_social | referral | push | email
    utm_campaign : kifeh_<sujet>_<territoire>   (ex. kifeh_fire_launch_fr, kifeh_fire_safety_tn)
    utm_content  : <format>_<variante>          (ex. story_map_replay, founder_post)

Exemples prêts à l'emploi :

    Instagram organique : ?utm_source=instagram&utm_medium=organic_social&utm_campaign=kifeh_fire_launch_fr&utm_content=story_map_replay
    LinkedIn           : ?utm_source=linkedin&utm_medium=organic_social&utm_campaign=kifeh_open_source_fr&utm_content=founder_post
    Facebook Tunisie   : ?utm_source=facebook&utm_medium=organic_social&utm_campaign=kifeh_fire_safety_tn&utm_content=community_post
    Presse             : ?utm_source=<nom_média>&utm_medium=referral&utm_campaign=kifeh_fire_map&utm_content=article_link

Déjà automatique : notifications push et e-mails (`kifeh_alert`), partages
(`share / referral / user_share`). Règles : jamais de lien social nu vers la
homepage (toujours une page précise + UTM) ; vérifier que les redirections
(lien Instagram bio, raccourcisseurs) CONSERVENT les paramètres ; objectif
`(not set)` < 3 % ; Facebook/Instagram se regroupent par `utm_source`
explicite plutôt que par domaine référent (m.facebook, lm.facebook…).

## 6. Validation

DebugView (ajouter `?debug_mode=1`), `window.__trackLog` en console (rempli
même consentement refusé — RIEN ne part sans accord), test navigateur
automatisé `tests/analytics-browser.mjs` (canonisation + funnel + absence de
données sensibles), contrôle des doublons, contrôle fr/ar et FR/TN (les
paramètres globaux portent langue et pays séparément — jamais fusionnés).

## 7. Funnel d'activation de référence

    Arrivée page territoriale → local_situation_displayed
    → incident_detail_opened → zone_follow_started → zone_follow_completed
    → alert_channel_selected / push_permission_granted → return_after_alert

Objectifs (à réévaluer selon saisonnalité) : 30 j — engagement > 60 s,
sessions/utilisateur > 1,4, récurrents ≥ 10 %, suivi de zone ≥ 5 %,
`not set` < 3 % · 60 j — récurrents ≥ 15 %, partage ≥ 2 %, organique ≥ 10 % ·
90 j — récurrents ≥ 20-25 %, retour après alerte ≥ 25 %, organique ≥ 15-20 %.
Aucune dépense SEA tant que : événements clés configurés, attribution
corrigée, funnel observable, boucles de rétention actives, landing pages
optimisées. Jamais de tactique exploitant la peur.
