# Simulation indicative de fumée — modèle, bornes, honnêteté

Décision de charte actée le 04/08/2026 (master feux §6.4). Drapeau serveur
`smoke_simulation_enabled` (ÉTEINT par défaut, activation/rollback à chaud).
Capacité territoriale : France uniquement (la Tunisie attend un modèle de
vent fin déclaré — `model_to_integrate`, #82).

## Ce que c'est / ce que ce n'est pas

C'EST une construction visuelle simple : où la fumée POURRAIT se trouver,
d'après les foyers observés et le vent du modèle météo du territoire.
CE N'EST PAS : une observation de fumée, une mesure de qualité de l'air
(jamais de PM2.5 dérivé), une prévision sanitaire, une heure d'arrivée, une
trajectoire d'incendie. Le libellé « Simulation indicative de fumée » et le
disclaimer accompagnent CHAQUE réponse d'API et restent affichés EN
PERMANENCE à l'écran tant que la couche est active.

## Modèle (src/services/smoke.js — pur, déterministe)

- Sources : détections satellite < 6 h dans la vue, DÉDUPLIQUÉES par cellule
  ~1 km (FRP max de la cellule — jamais une somme naïve), 40 sources max.
- Vent : ≤ 4 échantillons par requête (grappes de 0,5°), AROME France HD via
  Open-Meteo (modèle explicite). Conversion u = −V·sin(θ), v = −V·cos(θ)
  (θ = direction d'OÙ VIENT le vent) — testée sur N/S/E/O + intermédiaire.
  Pas de vent connu → PAS de panache inventé.
- Advection : position(t+Δt) = position + vent×Δt, pas de 20 min,
  latitude respectée (dLng ∝ 1/cos(lat)).
- Élargissement : σ(t) = √(σ₀² + 2Kt), σ₀ = 250 m, K = 45 m²/s.
- Atténuation : opacité(t) = 0,34 × force × exp(−t/τ), τ = 2,5 h ;
  force ∈ [0,35..1] selon FRP plafonnée à 300 MW par détection.
- Étalement latéral : ±12° déterministes (graine = hachage de l'id de la
  détection — jamais Math.random).
- Bornes dures : 18 bouffées max par détection, 400 au total (140 en mode
  performance réduite `lite=1`), coupure sous 2 % d'opacité, troncature
  TOUJOURS annoncée (`meta.truncated`).

## API

GET `/api/fire/smoke?minLat&maxLat&minLng&maxLng&country[&lite=1]`
→ `{ enabled, meta: { model, name, disclaimer, windModel, sources,
windSamples, truncated, generatedAt }, puffs: [{ lat, lng, rM, op }] }`.
Éteint ou hors territoire → `{ enabled: false, reason }` (raison du registre
de capacités). Cache HTTP 120 s, rate-limit partagé du mode feux.

## Interface

Calques → groupe « Conditions » : ligne opt-in (JAMAIS active d'office,
choix mémorisé `kifeh_smoke_layer`), gris neutre — jamais un rouge danger,
rien sous le zoom 7 (défauts calmes), masquée pendant le replay (rien du
présent dans le passé), disclaimer permanent (#smokeNote) tant que la couche
est active. La ligne n'apparaît QUE si le serveur sert la couche (sonde) —
jamais un interrupteur mort.

## Tests (fire-situation-check, section fumée — 23 assertions)

u/v 5 directions ; croissance monotone de σ ; décroissance de l'opacité ;
cap 6 h ; déterminisme octet à octet ; plafond FRP ; latitude ; troncature
lite ; « pas de vent → pas de panache » ; drapeau éteint par défaut ;
Tunisie honnête ; direction VÉRIFIÉE DE BOUT EN BOUT (vent simulé du
sud-ouest → bouffées au nord-est) ; disclaimer dans chaque réponse ;
rollback à chaud.
