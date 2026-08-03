# Plateforme Feux — état RÉEL de l'existant

Établi le 31/07/2026, **mis à jour le 04/08/2026** après audit complet contre
la production (kifeh.app/healthz + parcours navigateur) et le dépôt. Règle de
lecture : chaque élément est classé selon son état réel — jamais une hypothèse
présentée comme un fait.

## Socle technique

Node 22 + Express 5, SQLite (better-sqlite3, WAL) sur disque persistant
Render, frontend vanilla JS + Leaflet vendorisé + MapLibre GL 5 vendorisé
(scripts classiques ordonnés, aucun bundler), SSE, Playwright pour les tests
navigateur, déploiement par push (autodeploy Render, healthz zéro-coupure).
i18n FR/AR (RTL) par espaces de noms. CI GitHub (suites API + navigateur),
surveillance production 30 min + parcours navigateur 6 h.
**Cache honnête (leçon du 04/08)** : CSS/JS applicatifs en `no-cache`
(revalidation à chaque déploiement — fin des états hybrides), vendor/images
30 j, service worker `kifeh-shell-v3` réseau-d'abord.

## Disponible EN PRODUCTION (vérifié le 04/08)

- Signalements citoyens 4 types, confirmations communautaires, corrections de
  localisation, fins d'incident, capsule de confiance, multi-pays TN/FR,
  navigation fixe Carte · Situation · Signaler · Suivis · Aide.
- NASA FIRMS : synchro 15 min, VIIRS ×3 + MODIS, observations IMMUABLES
  (empreinte unique + brut conservé + received_at + source_batch_id),
  regroupement en événements, corroboration citoyenne (< 2 km).
- Copernicus EFFIS : synchro 6 h, VERSIONNEMENT des publications
  (published_at + received_at + is_latest, surface = valeur source),
  géométrie originale préservée, simplification uniquement pour le rendu.
- Vigilance Météo-France (clé serveur, expire 2026-10-27) : bulletins
  orange/rouge → informations officielles + marqueurs carte (zoom ≥ 7).
- Météo : AROME France HD EXPLICITE via Open-Meteo (`models=
  meteofrance_arome_france_hd` — jamais le mode auto), voile température +
  flèches de vent ; qualité de l'air PM2.5 ; routes barrées Bison Futé.
- DFCI : référentiel officiel local (339 264 carreaux), calcul serveur,
  prévisualisation + copie au signalement, AFFICHAGE PUBLIC ACTIF (précision
  « indicative »), événement analytics dfci_copied.
- API « Feux » : /api/fire/map (bbox+zoom+at+layers+country, meta.sources
  avec fraîcheur TYPÉE par source, `at` restituant UNIQUEMENT ce qui était
  connu à T — datetime() des deux côtés depuis le correctif 04/08) ;
  /api/fire/timeline (agrégats horaires bornés 10 j) ; SSE typé reprenable
  (id croissants, Last-Event-ID, tampon 500, battement 20 s, filtre pays).
- **Replay 72 h VISIBLE** (04/08) : frise + lecture ×1/×4/×12, opacité par
  ancienneté-à-T, restitution honnête (jamais une info publiée plus tard),
  couches annexes masquées à l'entrée et restaurées à la sortie.
- **Calques v2 VISIBLE** (04/08) : 4 groupes (observé/publié/conditions/
  contexte), source · heure · pastille de fraîcheur PAR couche
  (vert/ambre/rouge), raisons des couches absentes par territoire.
- **Défauts calmes** (04/08) : météo opt-in (kifeh_weather_layer_v2), zones
  brûlées rien < zoom 7, vigilance ≥ 7, routes ≥ 9, légendes en coin,
  FABs zoom masqués < 768 px, héro replié quand rien d'actif.
- Fraîcheur typée CENTRALISÉE (sourceFreshness.js : seuils par cadence
  réelle, documentés, servis par /healthz, /api/fire/map, Calques v2).
- SEO serveur : /{langue}/{territoire}/incendies (4 variantes, contenu VIVANT
  de la base, canonical + hreflang), 7 zones FR + 5 TN, pages « comprendre »,
  prévisions (previsions/danger-feu/methodologie-previsions), sitemap GÉNÉRÉ
  (54 URLs), IndexNow quotidien (ACCEPTÉ 202, healthz.indexnow), llms.txt,
  plomberie Search Console (fichier google* par réglage), /presse, widget
  encapsulable zéro-JS, JSON-LD Dataset sur les pages de zones.
- **API OUVERTE** (04/08) : /api/open/fire-situation.json + fire-sources.json
  + fire-methodology.json (bilingues, attributions amont, seuils documentés,
  version d'API, cache 5 min) + page /fr|ar/donnees-ouvertes/incendies.
- **Alias produits** (04/08) : /fr/incendies/{carte,replay,en-cours,sources,
  methodologie,situation-textuelle,<zone>,<sujet>,comprendre/*} → 301 vers
  les canoniques (zéro duplication, inconnu → 404).
- Alertes push VAPID + e-mail Resend (double consentement) + brief quotidien ;
  suivis multi-zones multi-pays ; PWA ; GA4 (événements canoniques, jamais de
  coordonnées ; pwa_installed ⭐ ; passage hebdo automatisé lundi 10/08).
- Wording « quasi temps réel » partout ; une réponse tunisienne ne mentionne
  JAMAIS EFFIS/DFCI/AROME (testé).

## Présent dans le code mais DÉSACTIVÉ (drapeaux)

- **Moteur MapLibre GL du mode feux** (fire_maplibre_enabled=0) : chargement
  par cellules (LRU 48, TTL 150 s, annulation, max 4 en vol), 5 classes
  d'ancienneté couleur+opacité, FRP = rayon secondaire borné, fallback
  Leaflet honnête. ⚠️ Trois DÉFAUTS RACINES corrigés le 04/08 — le moteur
  n'avait JAMAIS dessiné une détection jusqu'ici : (1) CSP sans worker-src
  blob: → worker MapLibre bloqué → zéro traitement de données, sans
  exception ; (2) expressions de style mal typées (at exige to-number,
  circle-color exige to-color) rejetées par ÉVÉNEMENT silencieux ;
  (3) aucune garde → état « actif » zombie. Corrections déployées, gl-check
  exige désormais le style COMPLET **et** des détections réellement RENDUES.
- Moyens aériens ADS-B Airplanes.live (fire_aircraft_enabled_fr/tn=0) :
  licence relue le 31/07 (non commercial, 1 req/s), collecte mutualisée
  serveur, zones actives uniquement, types d'appareils BRUTS (jamais
  « bombardier d'eau »), User-Agent ASCII (leçon undici).
- Connecteur STEG (préparé, éteint) ; OTP (verification_required=0).

## Partiellement implémenté

- Prévisions : socle + pages SEO ✓, mais le détail par jour J0→J+6 tappable
  dans la carte Situation reste à livrer (#111) ; 7 jours en second niveau.
- Replay : 72 h ✓ — fenêtres 24 h / 10 jours et partage d'un instant précis
  (hash #time=…) restent à faire ; regroupement par passage satellite absent.
- Mobile : recouvrement carte 390 px réduit 39 → 35 % (320 px : 52 %) — la
  structure « bottom sheet 3 positions + header léger » du master UX reste
  le grand chantier (#112/#114).
- Déduplication multi-satellites : bruts tous conservés ✓, agrégats
  regroupés par événement ✓ — mais pas encore d'affichage séparé
  « observations vs activités regroupées vs FRP cumulée du passage ».

## ABSENT (à construire)

- Simulation indicative de fumée — décision de charte REÇUE le 04/08
  (master feux §6.4 : modèle minimal FRP dédupliquée × vent, σ(t), plafonds,
  6 h max, graine déterministe, disclaimers permanents, drapeau
  SMOKE_SIMULATION_ENABLED éteint par défaut).
- Fonds IGN orthophoto / Géoplateforme + Sentinel-2 cloudless EOX (accès
  sondés 200 ; conditions à relire avant intégration) ; géocodage BAN.
- Module éditorial « informations officielles » v2 (préfectures/SDIS
  curatées main avec validation admin — AUCUNE création automatique depuis
  un hotspot) ; la vigilance officielle existe déjà.
- Grille AROME nationale + affinée autour des foyers, interpolation
  spatio-temporelle, u/v (tests 5 directions) — prérequis fumée.
- Traces aéronefs (dernières minutes, jamais d'extrapolation) au-delà des
  positions ; activation du calque FR.
- SSE : filtres bbox/layers/since par abonnement ; métriques SRE détaillées
  (sse_connections, durée snapshots, compteurs d'ingestion).
- Pages /fr/methodologie/{firms,effis,arome,simulation-fumee} de PLEINE
  qualité (les alias 301 existent ; les pages dédiées viendront avec leurs
  lots — jamais de pages pauvres).
- Bottom sheet 3 positions, header léger mobile, FAB « Ma position ».

## Obsolète / à corriger avant réutilisation

- Rien de bloquant identifié. Dettes connues : Firefox/WebKit absents de la
  CI locale (documenté) ; quota Open-Meteo partagé par IP (surveillé via
  healthz) ; tuiles raster OSM/Carto = dépendance externe sans SLA (fallback
  multi-fournisseurs en place).

## Correspondance avec l'ordre d'implémentation (master feux §30)

Lot 0 ✓ (ce document) · Lot 1 ✓ historisation · Lot 2 ✓ API+SSE (filtres
bbox restants) · Lot 3 ✓ moteur GL (corrigé 04/08, activation progressive à
mener) · Lot 4 ✓ replay 72 h (fenêtres 24 h/10 j + partage d'instant
restants) · Lot 5 fumée+AROME fin : À FAIRE (décision reçue) · Lot 6 DFCI ✓
+ aérien construit (traces + activation restantes) · Lot 7 SEO ✓ (+ pages
méthodologie dédiées) · Lot 8 croissance : IndexNow ✓, API ouverte ✓,
kit presse ✓ — diffusion et SEA (jamais sans accord) restants.
