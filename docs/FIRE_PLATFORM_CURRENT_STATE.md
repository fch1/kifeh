# Plateforme Feux — état RÉEL de l'existant (Lot 0)

Établi le 31/07/2026, vérifié contre la production (kifeh.app/healthz) et le
dépôt. Règle de lecture : chaque élément est classé selon son état réel —
jamais une hypothèse présentée comme un fait.

## Socle technique

Node 22 + Express 5, SQLite (better-sqlite3, WAL) sur disque persistant
Render, frontend vanilla JS + Leaflet vendorisé (scripts classiques ordonnés,
aucun bundler), SSE, Playwright pour les tests navigateur, déploiement par
push (autodeploy Render, healthz zéro-coupure). i18n FR/AR (RTL) double
obligatoire. CI GitHub (suites API + navigateur), surveillance production
30 min (healthz toutes sources) + parcours navigateur lecture seule 6 h.

## Disponible EN PRODUCTION (vérifié)

- Signalements citoyens 4 types, confirmations communautaires, corrections
  de localisation, fins d'incident, capsule de confiance, multi-pays TN/FR.
- NASA FIRMS : synchro 15 min, VIIRS ×3 + MODIS, observations IMMUABLES
  (INSERT OR IGNORE + empreinte unique + brut conservé + received_at +
  source_batch_id), regroupement en événements, corroboration citoyenne
  (< 2 km), fusion visuelle feux/satellite.
- Copernicus EFFIS : synchro 6 h sans clé, contours simplifiés serveur,
  VERSIONNEMENT des publications (burned_area_versions : published_at +
  received_at + is_latest, surface = valeur source), couche carte + fiche.
- Vigilance Météo-France (clé serveur, expire 2026-10-27) : bulletins
  orange/rouge → informations officielles + marqueurs.
- Météo : AROME France HD EXPLICITE via Open-Meteo (un seul appel par point,
  anti-martèlement, dédoublonnage — après la panne de quota du 28/07),
  voile température + flèches de vent, grille clipée aux frontières.
- Qualité de l'air PM2.5 (Open-Meteo Air Quality, sans clé).
- Routes barrées Bison Futé (DATEX II, sans clé) : ~500-700 entraves,
  couche opt-in.
- DFCI : référentiel officiel local (339 264 carreaux, checksum vérifié),
  calcul serveur ACTIF en prod, prévisualisation + copie au signalement ;
  AFFICHAGE PUBLIC ÉTEINT (dfci_public_display_enabled=0) en attente de
  validation opérationnelle (docs/DFCI.md).
- API « Feux FR » Lot 1 : /api/fire/map (instantané, meta.sources par
  source, paramètre `at` restituant UNIQUEMENT ce qui était connu — EFFIS à
  sa date de publication) et /api/fire/timeline (agrégats horaires bornés
  10 j). SSE typé reprenable (id croissants, Last-Event-ID, tampon 500,
  battement 20 s, filtre pays ; événements fire.batch / burned-area.batch).
- Alertes : push VAPID + e-mail Resend (double consentement, chiffré) +
  brief quotidien opt-in ; suivis de zones nommées ; statut de sécurité
  privé ; PWA (cache shell réseau-d'abord, /api jamais en cache, hors
  ligne honnête) ; navigation fixe 5 destinations ; onboarding 2 écrans.
- Wording « quasi temps réel » appliqué (métas, titres, llms.txt, API).

## Présent dans le code mais DÉSACTIVÉ

- Affichage public DFCI (drapeau) ; connecteur STEG (préparé, éteint) ;
  OTP (verification_required=0 le temps d'un fournisseur SMS/e-mail).

## Partiellement implémenté

- Replay : le SERVEUR sait déjà restituer « l'état connu à T » (détections
  observées ≤ T, versions EFFIS publiées ≤ T) — il n'existe NI interface de
  frise, NI relecture météo historique, NI regroupement par passage.
- Timeline : agrégats détections/FRP/EFFIS/citoyens — pas encore de
  déduplication multi-satellites des agrégats (les bruts, eux, sont tous
  conservés).
- Statuts de fraîcheur : healthz expose lastSuccess/ageSeconds/hasError par
  source ; les seuils typés fresh/delayed/stale/unavailable ne sont pas
  encore centralisés (service sourceFreshness à créer).

## ABSENT (à construire)

- Route /fr/incendies et l'expérience MapLibre (MapLibre non vendorisé à ce
  jour) ; chargement par cellules ; panneau bas 3 positions ; URL
  partageable avec temps et calques.
- Interface de replay (frise, lecture, passages).
- Grille AROME fine autour des foyers + interpolation + archivage des runs
  (Open-Meteo n'expose pas model_run_at — limite documentée à contourner
  par l'horodatage de récupération + heure valide).
- Simulation de fumée — ⚠️ TENSION DE CHARTE consignée (le vent n'est
  jamais une prévision de propagation) : NE PAS construire sans décision
  explicite de Farah, drapeau dédié prévu.
- Moyens aériens Airplanes.live (accès sondé 200 le 31/07 ; conditions
  d'utilisation/licence NON encore relues — bloquant avant intégration).
- Fonds IGN orthophoto / Sentinel-2 cloudless (accès WMTS sondé 200 ;
  conditions d'usage à relire), géocodage BAN.
- Pages SEO rendues serveur (/fr/incendies/*, méthodologies, données
  ouvertes, situation-textuelle), Dataset schema.org, sitemaps dédiés.
- Module éditorial « Situation vérifiée » (les informations officielles
  vigilance existent ; le module presse/préfectures n'existe pas).
- Métriques SRE détaillées (compteurs d'ingestion, durée des snapshots,
  connexions SSE).

## Obsolète / à corriger avant réutilisation

- Rien d'identifié de bloquant ; dettes connues : Firefox/WebKit absents du
  conteneur de CI locale (documenté), quota Open-Meteo partagé par IP
  (protections en place, à surveiller via healthz).

## Correspondance avec l'ordre d'implémentation

Lot 0 ✓ (ce document) · Lot 1 ✓ (historisation + API + SSE, tests 119) ·
Lots 2-3 : MapLibre /fr/incendies · Lot 4 : replay UI · Lot 5 : AROME fin
(+ fumée SI décision) · Lot 6 : DFCI calque + aérien (licences d'abord) ·
Lot 7 : SEO serveur · Lot 8 : croissance. Chaque lot = déploiement séparé,
testé, réversible.
