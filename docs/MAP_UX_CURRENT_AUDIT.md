# Audit UX carte — état RÉEL avant refonte (PR 1)

Mesuré le 31/07/2026 par outillage automatisé (tests/ux-audit-tool.mjs) sur
le code déployé en production ce jour — 9 largeurs × FR + 3 × AR, captures
dans `docs/audit/`, mesures brutes dans `docs/audit/metrics.json`.
Méthode « % de carte recouverte » : échantillonnage 40×30 points de la zone
carte, un point est « recouvert » si l'élément au sommet n'appartient pas à
la carte.

## Mesures

| Vue | Carte recouverte | Surfaces visibles | Débord. horizontal |
|---|---|---|---|
| fr 320×568 | **56 %** | 4 | non |
| fr 360×640 | **49 %** | 4 | non |
| fr 375×667 | **50 %** | 4 | non |
| fr 390×844 | **47 %** | 4 | non |
| fr 768×1024 | 25 % | 15 | non |
| fr 1024×768 | 29 % | 15 | non |
| fr 1280×800 | 26 % | 17 | non |
| fr 1440×900 | 22 % | 17 | non |
| fr 1920×1080 | 14 % | 17 | non |
| ar 375×667 | 48 % | 4 | non |
| ar 768×1024 | 24 % | 15 | non |
| ar 1440×900 | 21 % | 17 | non |

RTL : symétrique du LTR aux mêmes largeurs (±1 pt) — aucune anomalie propre
à l'arabe détectée par ces mesures.

## Constats principaux

1. **Mobile : la moitié de la carte est recouverte** (47-56 %). L'empilement
   en cause : en-tête (logo + pays + langue) + barre de recherche pleine
   largeur + rangée de puces de filtres + carte de situation + navigation
   basse. La carte de situation est repliable depuis le 31/07 (chevron) mais
   l'état PAR DÉFAUT reste déplié — le premier écran ne respire pas.
2. **Desktop 1280 : 74 % de carte visible** — sous la cible master (≥78 %
   sans panneau). 1440 : 78 % (limite). 1920 : 86 % ✓. Cause : les surfaces
   mobiles (recherche pleine largeur, puces, carte héro) restent affichées
   telles quelles — le desktop est un mobile agrandi, ce que le master
   demande de corriger (rail + header compact + héro → bouton).
3. **17 surfaces flottantes simultanées à 1440 px** (en-tête, recherche,
   puces ×6, héro, légende, FABs ×4, nav, bannières éventuelles) : la
   concurrence visuelle dénoncée par le diagnostic du master est confirmée.
4. **Aucun débordement horizontal** sur les 12 vues ✓ (acquis à préserver).
5. **Aucune timeline** : le mode replay n'a pas encore de surface (PR 6).

## Écarts vs cibles de la refonte

| Cible master | État mesuré | PR |
|---|---|---|
| Rail vertical desktop 64-76 px | absent (pilule basse) | PR 2 |
| Header 56-64 px, recherche 420-520 px | recherche pleine largeur | PR 2 |
| Héro desktop → bouton compact | carte héro permanente | PR 2 |
| Carte ≥78 % (desktop sans panneau) | 74-78 % à 1280-1440 | PR 2 |
| Panneau ≤35 % viewport | 400 px = 31 % à 1280 ✓ (déjà conforme) | — |
| Un seul panneau ouvert | ✓ (openSheet exclusif) | — |
| Feuilles mobiles 3 positions | ✓ (livré 31/07) | — |
| Timeline persistante mode feux | absente | PR 6 |
| 5 classes d'ancienneté FIRMS | 3 classes (livré 31/07) | PR 5 |
| Clustering faible zoom | ✓ GridCluster (60 px, historique) | — |

## Analytics réellement émis (vérifié 31/07 par tests navigateur)

local_situation_displayed · incident_detail_opened · zone_follow_started ·
zone_follow_completed · alert_channel_selected · push_permission_* ·
incident_report_started/location_selected/submitted · fire_map_opened ·
layer_enabled/disabled · source_panel_opened · official_update_opened ·
country_selected · language_changed · location_* · dfci_displayed/copied ·
emergency_call_clicked · map_shared + share_channel_selected ·
pwa_install_prompted/installed · return_after_alert/share ·
since_last_visit_displayed · fire_forecast_opened/7d_opened ·
hero_card_toggled. (replay_* arriveront avec PR 6.)

## Écarts production / dépôt

Aucun : la production du 31/07 correspond au dépôt (déploiements continus le
jour même, healthz vérifié après chaque push, 37 incidents constants).

## Décision de sortie de PR 1

Aucun changement fonctionnel dans cette PR (conformément au master). Les
chiffres ci-dessus deviennent la BASELINE : chaque PR de refonte (2, 3, 5, 6)
doit re-mesurer les mêmes 12 vues et améliorer « carte recouverte » sans
créer de débordement ni casser l'existant. Cible immédiate de PR 2 : desktop
≥78 % partout, mobile premier écran ≤35 % recouvert (héro replié par défaut
au premier chargement + recherche compacte).
