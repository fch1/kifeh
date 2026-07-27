// Vent contextuel « Situation incendie » — adaptateur météo CÔTÉ SERVEUR.
// Source par défaut : modèle Météo-France (AROME/ARPEGE) servi par l'API
// libre Open-Meteo — aucun fichier GRIB côté navigateur, aucun secret requis.
// Fournisseur configurable (réglage wind_provider, URL surchargeable WIND_URL
// pour les tests). Cache mémoire aligné sur la cadence réelle du modèle.
//
// Le vent est une INFORMATION DE CONTEXTE : jamais une prévision de
// propagation du feu, jamais une consigne d'évacuation.
import { getSetting, getSettingNum } from '../db.js';

const BASE = () => process.env.WIND_URL || 'https://api.open-meteo.com';
const cache = new Map(); // clé : cellule ~10 km — valeur : { at, data }

function cacheKey(lat, lng) {
  return `${Math.round(lat * 10) / 10}:${Math.round(lng * 10) / 10}`;
}

// Vent à un point (France) : { speedKmh, gustsKmh, directionFromDeg,
// directionToDeg, observedAt, provider, fetchedAt } ou null si indisponible.
export async function getWind(lat, lng) {
  const key = cacheKey(lat, lng);
  const cfgMin = getSettingNum('wind_cache_min');
  const ttlMs = (Number.isFinite(cfgMin) && cfgMin >= 0 ? cfgMin : 15) * 60_000; // 0 = sans cache (tests)
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  try {
    const url = `${BASE()}/v1/meteofrance?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}`
      + `&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=UTC`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`meteo ${res.status}`);
    const j = await res.json();
    const c = j.current || {};
    if (!Number.isFinite(c.wind_speed_10m) || !Number.isFinite(c.wind_direction_10m)) return null;
    const data = {
      speedKmh: Math.round(c.wind_speed_10m),
      gustsKmh: Number.isFinite(c.wind_gusts_10m) ? Math.round(c.wind_gusts_10m) : null,
      directionFromDeg: Math.round(c.wind_direction_10m),          // convention météo : d'où vient le vent
      directionToDeg: (Math.round(c.wind_direction_10m) + 180) % 360, // vers où il souffle
      observedAt: c.time ? `${c.time}:00Z`.replace(/:00Z$/, ':00Z').replace('::', ':') : new Date().toISOString(),
      provider: getSetting('wind_provider') || 'open_meteo_meteofrance',
      fetchedAt: new Date().toISOString(),
    };
    // Normalise l'horodatage Open-Meteo (« 2026-07-27T16:00 » → ISO complet).
    if (c.time && !/Z$/.test(c.time)) data.observedAt = `${c.time}:00Z`;
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return data;
  } catch {
    return null; // chaque source tombe en panne indépendamment
  }
}

export function windIsStale(wind) {
  const staleMin = getSettingNum('wind_stale_min') || 90;
  return !wind || Date.now() - Date.parse(wind.observedAt) > staleMin * 60_000;
}

// Cap géodésique approximatif (degrés) du point A vers le point B.
export function bearingDeg(latA, lngA, latB, lngB) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLng = rad(lngB - lngA);
  const y = Math.sin(dLng) * Math.cos(rad(latB));
  const x = Math.cos(rad(latA)) * Math.sin(rad(latB))
    - Math.sin(rad(latA)) * Math.cos(rad(latB)) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Contexte « sous le vent » — CONSERVATEUR, jamais un score de risque :
// 'downwind' | 'crosswind' | 'upwind' | 'unknown'. Données absentes,
// périmées ou lieu trop lointain → 'unknown' (on n'infère jamais).
export function downwindContext(fire, user, wind) {
  if (!fire || !user || !wind || windIsStale(wind)) return 'unknown';
  const maxKm = getSettingNum('downwind_max_km') || 30;
  if (distanceKm(fire.lat, fire.lng, user.lat, user.lng) > maxKm) return 'unknown';
  const halfAngle = getSettingNum('downwind_angle_deg') || 45;
  const toUser = bearingDeg(fire.lat, fire.lng, user.lat, user.lng);
  let diff = Math.abs(toUser - wind.directionToDeg);
  if (diff > 180) diff = 360 - diff;
  if (diff <= halfAngle) return 'downwind';
  if (diff >= 180 - halfAngle) return 'upwind';
  return 'crosswind';
}
