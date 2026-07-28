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
      + `&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m`
      + `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&forecast_days=1&timezone=UTC`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`meteo ${res.status}`);
    const j = await res.json();
    const c = j.current || {};
    if (!Number.isFinite(c.wind_speed_10m) || !Number.isFinite(c.wind_direction_10m)) return null;
    // Vent À VENIR (+3 h, +6 h) : prévision météo honnête — jamais un cône de
    // « trajectoire du feu » (le vent prévu n'est pas une propagation prédite).
    const forecast = [];
    try {
      const hrs = j.hourly?.time || [];
      const now = Date.parse(`${c.time}:00Z`);
      for (const offsetH of [3, 6]) {
        const target = now + offsetH * 3600_000;
        const k = hrs.findIndex((h) => Date.parse(`${h}:00Z`) >= target);
        if (k >= 0 && Number.isFinite(j.hourly.wind_speed_10m?.[k])) {
          forecast.push({
            inHours: offsetH,
            speedKmh: Math.round(j.hourly.wind_speed_10m[k]),
            directionToDeg: (Math.round(j.hourly.wind_direction_10m?.[k] ?? 0) + 180) % 360,
            gustsKmh: Number.isFinite(j.hourly.wind_gusts_10m?.[k]) ? Math.round(j.hourly.wind_gusts_10m[k]) : null,
          });
        }
      }
    } catch { /* prévision absente : le vent actuel reste servi */ }
    const data = {
      speedKmh: Math.round(c.wind_speed_10m),
      gustsKmh: Number.isFinite(c.wind_gusts_10m) ? Math.round(c.wind_gusts_10m) : null,
      directionFromDeg: Math.round(c.wind_direction_10m),          // convention météo : d'où vient le vent
      directionToDeg: (Math.round(c.wind_direction_10m) + 180) % 360, // vers où il souffle
      observedAt: c.time ? `${c.time}:00Z`.replace(/:00Z$/, ':00Z').replace('::', ':') : new Date().toISOString(),
      provider: getSetting('wind_provider') || 'open_meteo_meteofrance',
      fetchedAt: new Date().toISOString(),
      forecast, // [{inHours, speedKmh, directionToDeg, gustsKmh}] — +3 h / +6 h
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

// ── Chaleur locale (« Autour de moi », France) ───────────────────────────────
// Température actuelle, ressenti et maximum attendu aujourd'hui — même modèle
// Météo-France servi par Open-Meteo, même surcharge WIND_URL pour les tests.
// La chaleur est une INFORMATION LOCALE : jamais un niveau officiel de danger,
// jamais fusionnée avec la vigilance ni avec les feux.
const heatCache = new Map();

export async function getHeat(lat, lng) {
  const key = cacheKey(lat, lng);
  const cfgMin = getSettingNum('wind_cache_min');
  const ttlMs = (Number.isFinite(cfgMin) && cfgMin >= 0 ? cfgMin : 15) * 60_000;
  const hit = heatCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  try {
    const url = `${BASE()}/v1/meteofrance?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}`
      + `&current=temperature_2m,apparent_temperature,cloud_cover`
      + `&hourly=temperature_2m,visibility`
      + `&forecast_days=1&timezone=UTC`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`meteo ${res.status}`);
    const j = await res.json();
    const c = j.current || {};
    if (!Number.isFinite(c.temperature_2m)) return null;
    // Maximum du jour et son heure (UTC → le client affiche en heure locale) ;
    // visibilité de l'heure courante (m) si le modèle la fournit.
    let maxC = null, maxAt = null, visibilityM = null;
    const hours = j.hourly?.time || [], temps = j.hourly?.temperature_2m || [];
    const vis = j.hourly?.visibility || [];
    for (let k = 0; k < hours.length; k++) {
      if (Number.isFinite(temps[k]) && (maxC === null || temps[k] > maxC)) {
        maxC = temps[k]; maxAt = hours[k];
      }
      if (c.time && hours[k] === c.time.slice(0, 13) + ':00' && Number.isFinite(vis[k])) {
        visibilityM = vis[k];
      }
    }
    if (visibilityM === null && vis.length && Number.isFinite(vis[0])) visibilityM = vis[0];
    const data = {
      tempC: Math.round(c.temperature_2m),
      feelsC: Number.isFinite(c.apparent_temperature) ? Math.round(c.apparent_temperature) : null,
      maxC: maxC !== null ? Math.round(maxC) : null,
      maxAt: maxAt ? (/Z$/.test(maxAt) ? maxAt : `${maxAt}:00Z`) : null,
      cloudPct: Number.isFinite(c.cloud_cover) ? Math.round(c.cloud_cover) : null,
      visibilityKm: visibilityM !== null ? Math.round(visibilityM / 100) / 10 : null,
      observedAt: c.time ? (/Z$/.test(c.time) ? c.time : `${c.time}:00Z`) : new Date().toISOString(),
      provider: getSetting('wind_provider') || 'open_meteo_meteofrance',
    };
    heatCache.set(key, { at: Date.now(), data });
    if (heatCache.size > 500) heatCache.delete(heatCache.keys().next().value);
    return data;
  } catch {
    return null; // panne indépendante : la chaleur manquante ne bloque rien
  }
}

// ── Grille météo pour la CARTE (« nuage de couleur » + flèches de vent) ─────
// Une grille de points sur la zone visible, récupérée en UN SEUL appel
// Open-Meteo (listes de coordonnées) et mise en cache par zone arrondie.
// Le navigateur ne reçoit que des valeurs prêtes à dessiner — jamais de GRIB.
const gridCache = new Map();

export async function getWeatherGrid(minLat, maxLat, minLng, maxLng, n = 4) {
  const key = `${Math.round(minLat * 4) / 4}:${Math.round(maxLat * 4) / 4}:${Math.round(minLng * 4) / 4}:${Math.round(maxLng * 4) / 4}:${n}`;
  const cfgMin = getSettingNum('wind_cache_min');
  const ttlMs = (Number.isFinite(cfgMin) && cfgMin >= 0 ? cfgMin : 15) * 60_000;
  const hit = gridCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  try {
    const lats = [], lngs = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        lats.push((minLat + ((i + 0.5) / n) * (maxLat - minLat)).toFixed(3));
        lngs.push((minLng + ((j + 0.5) / n) * (maxLng - minLng)).toFixed(3));
      }
    }
    const url = `${BASE()}/v1/meteofrance?latitude=${lats.join(',')}&longitude=${lngs.join(',')}`
      + `&current=temperature_2m,wind_speed_10m,wind_direction_10m&timezone=UTC`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`meteo ${res.status}`);
    const j = await res.json();
    const list = Array.isArray(j) ? j : [j]; // 1 point (tests) ou n×n points
    const cells = [];
    for (let k = 0; k < lats.length; k++) {
      const c = (list[k] || list[0] || {}).current || {};
      if (!Number.isFinite(c.temperature_2m)) continue;
      cells.push({
        lat: Number(lats[k]), lng: Number(lngs[k]),
        tempC: Math.round(c.temperature_2m),
        windKmh: Number.isFinite(c.wind_speed_10m) ? Math.round(c.wind_speed_10m) : null,
        windToDeg: Number.isFinite(c.wind_direction_10m) ? (Math.round(c.wind_direction_10m) + 180) % 360 : null,
      });
    }
    const data = {
      cells, n,
      stepLat: (maxLat - minLat) / n, stepLng: (maxLng - minLng) / n,
      updatedAt: new Date().toISOString(),
      provider: getSetting('wind_provider') || 'open_meteo_meteofrance',
    };
    gridCache.set(key, { at: Date.now(), data });
    if (gridCache.size > 200) gridCache.delete(gridCache.keys().next().value);
    return data;
  } catch {
    return null; // panne indépendante
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
