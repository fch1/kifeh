# Plateforme Feux + Refonte UX — architecture cible, écarts, décisions, plan

Établi le 04/08/2026 en réponse aux DEUX masters (« Refonte temps réel,
replay, cartographie, données, SEO, croissance » + « Refonte produit, UX/UI,
cartographique, prévisionnelle et responsive »). Ce document suit le format
demandé : 1. Audit · 2. Architecture cible · 3. Écarts · 4. Décisions ·
5. Plan des PR · 6. Risques.

## 1. Audit de l'existant

→ docs/FIRE_PLATFORM_CURRENT_STATE.md (mis à jour le 04/08). Synthèse : les
deux masters sont DÉJÀ construits à ~80 % — historisation FIRMS/EFFIS/
fraîcheur typée, /api/fire/map+timeline+SSE reprenable, replay 72 h honnête,
Calques v2, panneau contextuel unique, navigation 5 destinations, DFCI
serveur actif, SEO serveur 54 URLs + IndexNow accepté, API ouverte. Découverte
majeure de l'audit du 04/08 : le moteur MapLibre n'avait JAMAIS réellement
dessiné (CSP worker + typage d'expressions + absence de garde) — corrigé,
testé (gl-check exige désormais le RENDU), déployé éteint.
Audits UX chiffrés : docs/MAP_UX_CURRENT_AUDIT.md (9 largeurs × 4 contextes,
% de carte couverte) + docs/PRODUCT_BENCHMARK_FIRE_AND_CRISIS_APPS.md +
docs/KIFEH_DESIGN_SYSTEM.md (tokens --kifeh-*).

## 2. Architecture cible

Trois temps intégrés à la MÊME interface (jamais une app séparée) :
**Maintenant** (incidents citoyens, observations satellite, officiel,
périmètres, conditions, état des sources) · **Prévisions** (conditions
favorisantes J0→J+6, confiance en toutes lettres, jamais un futur incendie) ·
**Évolution passée** (replay 24 h/72 h/10 j, versions EFFIS à leur date).

URLs : la convention /{langue}/{territoire}/… RESTE canonique (4 variantes
langue×territoire, ar-FR et fr-TN réels) ; la famille /fr/incendies/* du
master vit en ALIAS 301 — zéro duplication. L'app reste la carte vivante ;
les pages serveur restent l'entrée indexable.

Mobile cible (master UX §7-8, débloque la maquette bandeau 4× refusée) :
header léger (logo + pays + langue + Déclarer — la confiance reste VISIBLE),
recherche/localisation, chips de types (l'invitation reste VISIBLE), carte
pleine, la carte Situation devient le PREMIER NIVEAU d'un bottom sheet à
3 positions (« Situation · N observations · il y a X min »), navigation
inférieure conservée. Desktop : panneau latéral 360-420 px (existant),
variantes de barre à tester SANS dénaturer.

Données nouvelles : fumée = simulation indicative (FRP dédupliquée × vent
AROME, dispersion simple, 6 h max, disclaimers permanents) ; fonds IGN
ortho/Géoplateforme (FR) + Sentinel-2 cloudless (hors FR) en OPTION de fond ;
traces aéronefs limitées aux dernières minutes ; informations officielles
curatées à la main (jamais générées d'un hotspot).

## 3. Écarts (le delta réel à construire)

D1 Fumée indicative (décision reçue) — grille vent u/v + tests 5 directions,
   modèle §6.4, canvas dédié, mode performance réduite, drapeau éteint.
D2 Bottom sheet 3 positions + header léger mobile (flag mobile_shell_v2) —
   chips et pays/langue TOUJOURS visibles (leçon des 4 refus).
D3 Prévisions par jour dans Situation (#111) + 7 j second niveau + carte
   prévisionnelle avec bannière obligatoire (#98).
D4 Replay : fenêtres 24 h/10 j, partage d'instant (#time=…), regroupement
   par passage.
D5 Fonds IGN/EOX opt-in + attributions (licences relues d'abord).
D6 Aérien : traces courtes + activation FR progressive.
D7 SSE filtres bbox/layers + métriques SRE (compteurs, durées, connexions).
D8 Pages méthodologie dédiées (firms/effis/arome/fumée) de pleine qualité.
D9 Activation progressive du moteur GL (maintenant qu'il dessine) :
   sandbox → % de sessions → défaut, rollback drapeau immédiat.
D10 Croissance : diffusion widget/presse (#120), lecture funnel GA4 (10/08),
   expériences CTA jamais anxiogènes (#91), SEA UNIQUEMENT sur accord.

## 4. Décisions (avec leurs raisons)

- **URLs** : canoniques inchangées + alias 301 — préserve l'existant indexé
  et sert les URLs du master sans dupliquer (redirections propres §20).
- **MapLibre** : moteur du mode feux derrière drapeau, PAS de migration
  globale — Leaflet reste le socle multi-incident (§5 master : migration
  progressive permise).
- **SSE conservé** (socle fiable, Last-Event-ID) — pas de WebSocket sans
  nécessité démontrée (§8).
- **Fumée** : décision de charte actée par le master §6.4 — construction en
  lot dédié, drapeau éteint, JAMAIS de donnée sanitaire, disclaimers
  permanents, déterminisme testé.
- **Informations officielles** : curation manuelle validée (admin), pas de
  scraping préfectures non fiable, pas d'article auto depuis un hotspot
  (§6.8/§23).
- **Identité** : un seul design system, pas de « Kifeh Fire », le bouton
  central Signaler et la navigation 5 restent (master UX §2/§9).
- **Analytics** : événements produits existants + nouveaux du master §24 au
  fur et à mesure des écrans — jamais de coordonnées exactes.
- **Bac à sable de test** : les tuiles raster sont coupées dans les tests
  navigateur (déterminisme) ; la vérité du rendu GL est assurée par
  queryRenderedFeatures, pas par la présence du fond.

## 5. Plan des PR (chaque PR : testée, déployée séparément, réversible)

PR A ✓ (04/08) API ouverte + alias /fr/incendies/* + donnees-ouvertes +
     llms.txt + option capture GL.
PR B ✓ (04/08) Moteur GL : 3 corrections racines + tests de RENDU + captures.
PR C  Activation progressive GL (D9) : sandbox, puis % (réglage), mesure
     réelle, rollback documenté.
PR D  Fumée (D1) : service vent u/v (5 tests de direction) → modèle → couche
     → disclaimers → performance réduite → drapeau.
PR E  Mobile shell v2 (D2) : bottom sheet 3 positions + header léger derrière
     drapeau, captures réelles AVANT bascule, aucun retrait de chips.
PR F  Prévisions J0→J+6 (D3) : Situation → détail jour → 7 j → carte
     prévisionnelle bannière obligatoire.
PR G  Replay fenêtres + partage d'instant (D4).
PR H  Fonds IGN/EOX (D5) + attributions visibles.
PR I  Aérien traces + activation FR (D6).
PR J  SSE filtres + métriques SRE (D7).
PR K  Pages méthodologie dédiées (D8) + Dataset complets.
PR L  Croissance (D10) : messages de diffusion prêts (Farah), funnel 10/08,
     CTA expériences.

## 6. Risques et parades

- Régression visuelle pendant la refonte mobile → drapeau + captures de
  référence (npm run test:brand) + les 4 contextes pays×langue.
- Moteur GL sur appareils faibles → fallback Leaflet automatique testé,
  activation par % réversible.
- Fumée mal interprétée → libellé « Simulation indicative » permanent,
  disclaimer complet, jamais de PM2.5 dérivé, revue avant activation.
- Quota Open-Meteo (grille vent) → cache + grille grossière nationale,
  affinée UNIQUEMENT autour de foyers récents, healthz surveille.
- Dépendances fonds de carte → multi-fournisseurs + fond neutre honnête.
- SEO : alias mal canonisés → tests 301 dans platform-check (faits) ;
  pages pauvres interdites (noindex sinon).
- Sécurité : CSP élargie STRICTEMENT (worker-src blob: même-origine,
  connect-src = mêmes hôtes de tuiles que img-src) — revue OWASP au fil des
  lots ; secrets scannés avant chaque push.
