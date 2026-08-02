# Kifeh — Rapport de performance cartographique (chantier #103)

*01/08/2026 — première version. Moteur MapLibre GL du mode feux livré DERRIÈRE
DRAPEAU (`fire_maplibre_enabled`, éteint par défaut). Conformément à la règle
du plan validé par Farah, ce moteur ne remplacera l'affichage Leaflet
qu'après des captures avant/après validées — ce rapport documente ce qui est
construit, mesuré et prouvé, pas un basculement.*

## Architecture livrée

Le module `public/js/fire-map-gl.js` (script classique ordonné, aucun
bundler) implémente :

**Chargement strictement paresseux.** Drapeau éteint → zéro octet : la
librairie vendorisée (`public/vendor/maplibre/`, v5.24, jamais de CDN) n'est
injectée qu'à la première entrée en mode feux d'une session armée. Le HTML
initial ne la référence nulle part (testé).

**Chargement par cellules + cache LRU + annulation.** Grille fixe (1° au
niveau national, 0,5° dès le zoom 8), clés stables indépendantes du viewport ;
cache LRU de 48 cellules (TTL 150 s) ; `AbortController` par requête — les
cellules sorties de l'écran voient leur requête ANNULÉE ; au-delà de 12
cellules visibles, une seule requête englobante remplace la tempête (respect
du rate-limit serveur : max 4 requêtes en vol, file d'attente au-delà).
Source de données : l'API mutualisée `/api/fire/map` (bbox natif, 500
détections max, capacités par territoire).

**Sémantique visuelle honnête.** 5 classes d'ancienneté FIRMS (<3 h, 3-6,
6-12, 12-24, ≥24 h) portées par la COULEUR et l'opacité — du rouge Kifeh au
gris-brun ; la FRP n'est qu'un rayon SECONDAIRE borné (`0,35·√min(frp,300)`),
jamais une surface ni le canal principal. Zones brûlées dans le même brun
assumé que Leaflet ; signalements citoyens = les MÊMES pins DOM
(`.marker-pin`) pour une identité visuelle continue. La fiche de détection
répète l'honnêteté : « une intensité observée, jamais une taille ni une
surface ».

**Fallback Leaflet OBLIGATOIRE.** La carte Leaflet reste VIVANTE sous le
moteur. WebGL absent → repli avant tout chargement ; échec de librairie ou
d'initialisation → repli ; rafale d'erreurs moteur (≥5 en 10 s) → repli
définitif pour la session, tracké (`fire_gl_fallback {reason}`). Les échecs
de TUILES, eux, ne tuent JAMAIS le moteur (fond neutre, les données restent
— philosophie identique au fond Leaflet). Sortie du mode feux → moteur masqué
(pas détruit), vue miroir maintenue des deux côtés (garde anti-boucle).

## Budgets et mesures

Budgets du master (rappel) : texte utile < 2,5 s, carte < 4 s, interaction
< 200 ms.

Mesures réelles (`npm run test:gl`, Chromium + SwiftShader — GPU LOGICIEL,
conteneur CPU seul, tuiles volontairement coupées, base sans détections) :

| Métrique | Mesure | Lecture honnête |
|---|---|---|
| Initialisation moteur (`initMs`) | **374 ms** | création carte + sources + couches |
| Premier rendu (`firstRenderMs`) | **570 ms** | première frame après activation |
| Activation bout-en-bout | ~3,4 s | inclut l'éval de la librairie (~800 Ko) et la première frame en GL LOGICIEL — un GPU réel fait bien mieux ; reste sous le budget « carte < 4 s » même dans ce pire cas |
| Cellules en cache | 1 (vue nationale → requête englobante) | le mécanisme anti-tempête fonctionne |
| Poids différé | ~800 Ko JS + 60 Ko CSS | payés UNIQUEMENT à l'activation du mode feux, jamais au premier chargement |

Limites de la mesure, assumées : GL logiciel (pas de GPU dans le conteneur),
pas de réseau réel (tuiles coupées exprès pour le déterminisme), base vide
(le coût de rendu de 500 points GL est marginal, mais il sera re-mesuré avec
données réelles avant tout basculement). L'interaction (< 200 ms) sera
mesurée sur appareil réel lors de la validation des captures.

## Preuves (tests)

`tests/fire-situation-check.mjs` (chaîne CI, 131 ✓) : drapeau éteint par
défaut, bascule/coupure à chaud admin, module servi, librairie absente du
HTML initial, cellules+LRU+annulation présents, fallback + 5 classes.
`tests/gl-check.mjs` (14 ✓, hors chaîne — WebGL requis, `npm run test:gl`) :
zéro trace drapeau éteint ; armé sans mode feux → toujours rien ; activation
réelle (librairie chargée à ce moment seulement, cellules → `/api/fire/map`,
premier rendu mesuré) ; tuiles en échec → le moteur tient ; sortie → Leaflet
reprend, conteneur caché prêt à la ré-entrée. Captures de marque : 10/10
inchangées (drapeau éteint = zéro delta visuel, vérifié avant déploiement).

## Ce qui reste avant tout basculement (dans l'ordre)

1. Re-mesure avec données réelles (FR, saison) et sur appareil réel.
2. Captures avant/après → validation Farah (règle du plan — aucune
   exception).
3. Parité d'interaction avec Leaflet (fiches satellite/citoyens, replay #104
   pourra s'appuyer sur ce moteur ou sur Leaflet, au choix du design validé).
4. Activation PROGRESSIVE par drapeau à chaud, réversible en un réglage —
   jamais un big-bang.
