# Benchmark produit — applications feux, crise et prévision

Réalisé le 31/07/2026 (master prévisions §2). Objet : identifier comment les
meilleures applications SIMPLIFIENT une information complexe — jamais
conclure que Kifeh doit devenir un outil SIG. Chaque benchmark est lu selon
quatre dimensions : à reprendre · à éviter · incompatible avec la marque ·
mutualisable multi-pays.

## Synthèse comparative

| | Première info visible | Temps → compréhension | Incertitude | Jargon |
|---|---|---|---|---|
| Flamap | carte + foyers | rapide (carto-centré) | peu traitée | moyen |
| Watch Duty | fiche d'incident vérifiée | très rapide | éditorialisée | faible |
| Google Crisis | fiche contextuelle | très rapide | déléguée à l'officiel | nul |
| Windy | carte animée + frise | moyen | par comparaison de modèles | élevé |
| Météo des forêts | 4 niveaux J+1/J+2 | immédiat | formulation prudente | nul |
| EFFIS/GWIS | indices scientifiques | lent (experts) | percentiles/anomalies | très élevé |
| NASA FIRMS | points bruts | lent (experts) | limites documentées | élevé |
| AirNow Fire & Smoke | carte + états séparés | rapide | explicitée grand public | faible |
| **Kifeh (cible)** | **situation locale humaine** | **< 10 s** | **texte déterministe + confiance** | **niveau 1 : zéro** |

## Par benchmark

**Flamap** — Reprendre : la carte comme surface principale, le chargement
progressif, la représentation temporelle des observations, le replay, la
lisibilité des foyers par ancienneté (✔ livré : classes d'âge satellite),
le détail accessible sans surcharger la vue. Éviter : l'expérience
carto-analytique dès l'arrivée, la timeline permanente, l'empilement de
données expertes. Incompatible marque : l'esthétique d'outil d'analyse.
Mutualisable : tout ce qui est repris (générique par territoire).

**Watch Duty** — Reprendre : une fiche principale par situation, « ce qui a
changé » depuis la dernière visite (✔ livré), le suivi multi-zones (✔),
des notifications rares mais importantes (✔ plafonds stricts), l'association
données automatisées + informations vérifiées. Éviter : en dépendre pour se
différencier — Kifeh garde ses signalements citoyens, le multi-incident,
l'absence de compte et l'ancrage franco-tunisien. Incompatible marque : le
modèle « salle de veille » ; Kifeh reste un compagnon local. Mutualisable :
fiche-situation générique, alertes responsables.

**Google Maps Crisis** — Reprendre : n'afficher une alerte QUE si elle est
pertinente pour la zone (✔ vigilance locale d'abord), une fiche de crise
unique, l'officiel mis en avant, le partage simple (✔ /i/:id), le retour à
la carte normale en fermant. Éviter : rien de notable. Incompatible marque :
rien. Mutualisable : contextualisation par zone.

**Windy** — Reprendre : déplacement simple entre les jours, animation
FACULTATIVE, lecture immédiate des changements de vent, comparaison des
journées, détails en second niveau (✔ bande 3 j → dépliant 7 j). Éviter :
le catalogue massif de couches, le jargon météo dominant, l'animation
permanente. Incompatible marque : l'interface d'expert météo. Mutualisable :
la navigation temporelle (carte prévisionnelle, PR 5).

**Météo des forêts (Météo-France)** — Reprendre : 4 niveaux compréhensibles,
J+1/J+2 officiels clairement identifiés, consignes associées, formulation
prudente (« n'est pas une carte des incendies actuels ou futurs » — notre
disclaimer en est le jumeau). Limite FACTUELLE vérifiée : aucun flux de
données public exploitable identifié à ce jour → PAS d'intégration promise ;
si un flux apparaît, l'adaptateur official-danger est prêt à l'accueillir.
Mutualisable : le concept « niveau officiel quand il existe ».

**EFFIS / GWIS** — Reprendre : prévision territoriale moyen terme, FWI,
comparaison au niveau habituel, distinction valeur/percentile/anomalie,
couverture Europe + Afrique du Nord (pertinente pour la Tunisie).
VÉRIFIÉ le 31/07 : les couches WMS FWI (mf010.fwi, ecmwf007.fwi,
danger_index) existent mais ne sont PAS interrogeables par point
(GetFeatureInfo refusé, y compris fwi_nuts5 ; pas d'API REST point). Pistes
restantes : décodage GetMap 1 px (fragile — écarté), export quotidien à
importer (à sonder). Éviter : présenter des indices sans pédagogie.
Incompatible marque : ISI/BUI/DC/DMC au premier niveau. Mutualisable : oui,
si un accès données propre est trouvé.

**NASA FIRMS** — Reprendre : historique, légende par ancienneté (✔), passages
satellite, capteur + heure affichés (✔), limites toujours visibles (✔).
Éviter : en faire une source de prévision — JAMAIS. Mutualisable : déjà le
socle FR + TN de Kifeh.

**AirNow Fire & Smoke** — Reprendre : séparation STRICTE des concepts
(fumée observée ≠ fumée simulée ≠ qualité de l'air — notre règle pour la
future fumée, si décision), vues simples par lieu, explications grand
public. Éviter : la densité de la carte experte. Mutualisable : la
sémantique de séparation, préparée dans le registre de capacités.

## Politique de sources par horizon (VÉRIFIÉE, implémentée)

| Horizon | France | Tunisie | Confiance affichée |
|---|---|---|---|
| J0-J+2 | Météo-France via Open-Meteo (7 j servis, sondé) + vigilance officielle | modèle global Open-Meteo (7 j, sondé) | `high` |
| J+3-J+4 | idem (enchaînement AROME→ARPEGE côté fournisseur, étiqueté) | idem | `medium` |
| J+5-J+6 | idem, marqué TENDANCE | idem dès J+4 | `trend` (en toutes lettres) |
| Niveau officiel | vigilance MF (✔ en prod) ; Météo des forêts : pas de flux ; FWI EFFIS : accès point fermé | aucune source officielle vérifiée | affiché SEULEMENT s'il existe |

Règles : jamais de fusion silencieuse de modèles ; transition affichée si
plusieurs modèles se succèdent ; absence de donnée = dite ; aucun score
maison ; le disclaimer (« ne prédit pas l'apparition ni la trajectoire d'un
incendie ») est porté par l'API elle-même.

## Conclusion

La cible n'est pas « une carte plus technique » : c'est Kifeh comme
compagnon local — ce qui se passe maintenant, ce qui pourrait favoriser les
risques dans les prochains jours, ce qui a changé, et ce que l'utilisateur
peut faire. Chaque emprunt ci-dessus passe les trois questions du master :
aide-t-il à agir ? distingue-t-il observation, prévision et confirmation ?
ressemble-t-il toujours à Kifeh ?
