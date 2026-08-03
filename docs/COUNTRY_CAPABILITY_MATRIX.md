# Matrice de disponibilité par territoire

> ⚠️ FICHIER GÉNÉRÉ — ne pas éditer à la main.
> Source de vérité : `src/countries/*.js` (profils versionnés).
> Régénérer : `node scripts/generate-capability-matrix.mjs`
> Le test `tests/platform-check.mjs` échoue si ce fichier diverge du registre.

Disponibilité DÉCLARÉE par territoire. Les drapeaux administrables et les
clés d’environnement s’appliquent en plus à l’exécution : l’état effectif
est servi par `/api/public/capabilities?country=XX`.

| Capacité | France | Tunisie |
|---|---|---|
| Signalements citoyens | Oui | Oui |
| Détections thermiques satellite | Oui (nasa-firms) | Oui (nasa-firms) |
| Contours de zones brûlées | Oui (copernicus-effis) | Non — couverture à vérifier |
| Modèle météo configuré | Oui (open-meteo) — modèle `meteofrance_arome_france_hd` | Non — à intégrer (candidat identifié) (candidat : open-meteo) |
| Qualité de l’air | Oui (open-meteo-air) | Non — pas encore ouvert (candidat : open-meteo-air) |
| Alertes officielles | Oui (meteofrance-vigilance) | Non — aucune source vérifiée |
| Routes barrées / entraves | Oui (bison-fute) | Non — aucune source vérifiée |
| Carroyage d’urgence | Oui (dfci-2km) | Non — sans objet sur ce territoire |
| Moyens aériens (ADS-B) | Oui (adsb-airplanes-live) | Oui (adsb-airplanes-live) |
| Simulation de fumée | Non — décision de charte en attente | Non — décision de charte en attente |
| Replay temporel | Oui | Oui |

## Langues, fuseaux et urgences

| | France | Tunisie |
|---|---|---|
| Langues | fr, ar | fr, ar |
| Fuseau | Europe/Paris | Africa/Tunis |
| Pompiers / Protection civile | 18 · 112 | 198 |
| Police | 17 · 112 | 197 |
| Urgences médicales | 15 · 112 | 190 |

## Fonds de carte

| | France | Tunisie |
|---|---|---|
| Par défaut | osm-raster | osm-raster |
| Repli | carto-voyager | carto-voyager |
| Satellite | — (candidat : ign-ortho, licence à relire — bloquant) | — (candidat : sentinel-2-cloudless, licence à relire — bloquant) |

Règle produit : aucune capacité n’est « héritée » d’un autre territoire ;
une page tunisienne ne mentionne jamais EFFIS, DFCI ni AROME. Les couches
absentes s’expliquent (« Cette source n’est pas encore disponible pour
cette zone. ») — jamais une erreur technique, jamais un repli silencieux.
