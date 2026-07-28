# Repère DFCI — carreau de 2 km (feux français)

Quand on signale un incendie aux sapeurs-pompiers, le carroyage DFCI est un
langage géographique qu'ils pratiquent : « KD42F7 » désigne un carreau de
2 km × 2 km. Kifeh calcule automatiquement ce repère pour chaque feu français
et l'affiche pour qu'il puisse être COMMUNIQUÉ EN COMPLÉMENT de l'adresse et
du GPS — jamais à leur place, et jamais à la place du 18/112.

## Provenance et construction (reproductible)

1. Source officielle : data.gouv.fr « Carroyage DFCI (2 km) », Licence
   Ouverte, version 2016-06-07, archive `CARRO_DFCI_2x2_L93.7z`
   (sha1 `8fa7aed2a7a0be51c28dc4565ab459c879fd968e`), Lambert 93.
2. Prétraitement (hors dépôt, documenté) : reprojection WGS84, validation
   des 339 264 codes (`^[A-Z]{2}[02468]{2}[A-HK-L][0-9]$`, unicité totale)
   → artefact versionné `src/data/dfci-2km-wgs84.ndjson.gz`
   (sha1 `2cdad27ea3e70b36eb7ab909395bae22d674478b`).
3. À l'installation (`postinstall`, jamais au démarrage) :
   `scripts/build-dfci-reference.mjs` reconstruit
   `data/reference/dfci-france.sqlite` (RTree + métadonnées) — AUCUN réseau,
   empreinte vérifiée, base séparée d'`incidents.db` et en lecture seule.

## Règles non négociables

- Calcul serveur depuis la position EXACTE (`lat`/`lng`), jamais
  `public_lat`/`public_lng` (anonymisées), jamais une valeur du navigateur
  (`dfciCode` reçu = ignoré).
- Uniquement `country=FR` et `type=fire` ; recalcul à chaque correction de
  localisation (atomique, journalisé sans coordonnées).
- L'indisponibilité du calcul ne bloque JAMAIS une déclaration.
- Frontière de carreaux : centroïde le plus proche puis ordre alphabétique
  (déterministe) ; le repère est alors marqué « indicatif ».
- Journaux : raison + pays + type, JAMAIS de coordonnées.

## Drapeaux (déploiement progressif)

`DFCI_ENABLED_FR` (calcul) et `DFCI_PUBLIC_DISPLAY_ENABLED` (affichage
public) — ou réglages `dfci_enabled_fr` / `dfci_public_display_enabled`.
Par défaut : TOUT ÉTEINT. Séquence recommandée : activer le calcul →
contrôler `/healthz` (`dfci{enabled, referenceLoaded, version}`) et quelques
codes → `node scripts/backfill-dfci.mjs --country FR --type fire --dry-run`
puis sans `--dry-run` → faire valider 3-4 codes par un acteur opérationnel
(SDIS, pompier) → activer l'affichage public.

## Tests

`tests/dfci-check.mjs` (dans `npm test`) : 40 fixtures tirées du fichier
officiel (centroïde → code exact, Corse incluse), Tunisie/non-feu/invalides,
point de frontière déterministe, API de prévisualisation sans persistance,
valeur client ignorée de bout en bout, détail public sans coordonnée exacte,
healthz sans chemin local.

## Hors périmètre v1 (volontairement)

Subdivision `.1`-`.5` (sans validation opérationnelle), repère des
observations NASA, calque DFCI sur la carte, itinéraires secours,
toute forme de prédiction.
