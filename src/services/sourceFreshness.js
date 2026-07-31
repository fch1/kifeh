// Fraîcheur typée des sources — LE point unique des seuils (addendum).
// Chaque source de données est classée fresh / delayed / stale / unavailable
// selon l'âge de sa dernière réussite. Les seuils dépendent de la CADENCE
// réelle de chaque source (une publication EFFIS quotidienne n'est pas « en
// retard » au bout de 3 h — une synchro FIRMS de 15 min, si).
//
// Consommé par : /healthz (surveillance), /api/fire/map (meta.sources),
// et à terme le panneau « Sources & fraîcheur » (Lot 6).
// Les clés sont des CONCEPTS génériques ; les alias historiques (firms,
// effis, vigilance, roads) sont acceptés pour ne rien casser.

const H = 3600; // secondes

// Seuils en secondes : [fresh <, delayed <] — au-delà : stale.
// Cadences réelles : FIRMS synchro 15 min (spec produit : <3 h frais,
// 3-8 h retardé, >8 h périmé) ; EFFIS publication ~quotidienne, synchro 6 h ;
// météo : cache 15 min, périmée à 90 min (wind_stale_min) ; vigilance
// synchro 60 min ; routes synchro 30 min ; air qualité horaire.
const THRESHOLDS = {
  thermalDetections: [3 * H, 8 * H],
  burnedAreas: [26 * H, 50 * H],
  weatherModel: [1.5 * H, 3 * H],
  officialAlerts: [2 * H, 6 * H],
  roadEvents: [2 * H, 6 * H],
  airQuality: [3 * H, 8 * H],
};

const ALIASES = {
  firms: 'thermalDetections',
  effis: 'burnedAreas',
  weather: 'weatherModel',
  wind: 'weatherModel',
  vigilance: 'officialAlerts',
  roads: 'roadEvents',
  air: 'airQuality',
};

export const FRESHNESS_LEVELS = ['fresh', 'delayed', 'stale', 'unavailable'];

// Classe un âge (secondes) pour une source. null/undefined → unavailable.
export function classifyFreshness(source, ageSeconds) {
  const key = THRESHOLDS[source] ? source : ALIASES[source];
  const t = THRESHOLDS[key];
  if (!t) return null; // source inconnue : pas d'invention de seuil
  if (ageSeconds == null || !Number.isFinite(ageSeconds) || ageSeconds < 0) return 'unavailable';
  if (ageSeconds < t[0]) return 'fresh';
  if (ageSeconds < t[1]) return 'delayed';
  return 'stale';
}

// Commodité : depuis un horodatage ISO de dernière réussite.
export function freshnessFromLastSuccess(source, lastSuccessIso, nowMs = Date.now()) {
  const t = Date.parse(String(lastSuccessIso || ''));
  const age = Number.isFinite(t) ? Math.max(0, Math.round((nowMs - t) / 1000)) : null;
  return { ageSeconds: age, status: classifyFreshness(source, age) };
}

// Seuils exposés (documentation, matrice, tests) — copie défensive.
export function freshnessThresholds() {
  return Object.fromEntries(Object.entries(THRESHOLDS).map(([k, v]) => [k, [...v]]));
}
