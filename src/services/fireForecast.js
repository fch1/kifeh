// Prévisions quotidiennes des CONDITIONS météo liées au danger de feu —
// socle générique par territoire (master prévisions, PR 2).
//
// Ce service ne prédit JAMAIS un incendie : il expose des FACTEURS
// (température max, humidité min, vent moyen max, rafales, pluie) et leur
// provenance. Aucun niveau de danger n'est inventé : un niveau ne s'affiche
// que s'il vient d'une source officielle/reconnue (adaptateur à venir après
// vérification EFFIS FWI — jamais de « score Kifeh »).
//
// Fournisseur par TERRITOIRE (capacités, jamais un modèle hors couverture) :
//   FR → API Open-Meteo « meteofrance » (AROME/ARPEGE enchaînés par le
//        fournisseur, 7 jours servis — sondé le 31/07) ;
//   TN → API Open-Meteo générale (meilleur modèle global disponible).
// Résilience identique à la météo carte : dernière réponse CONNUE (≤12 h)
// servie horodatée + stale:true pendant une panne — jamais un trou sec.
import { getSetting } from '../db.js';
import { getProfile } from '../countries/index.js';

const BASE = () => process.env.FORECAST_URL || 'https://api.open-meteo.com';

const DAILY = 'temperature_2m_max,relative_humidity_2m_min,wind_speed_10m_max,wind_gusts_10m_max,precipitation_sum';

// Par territoire : chemin d'API + libellé HONNÊTE du modèle.
const PROVIDERS = {
  FR: {
    path: '/v1/meteofrance',
    provider: 'open-meteo:meteofrance',
    label: 'Météo-France (AROME/ARPEGE) via Open-Meteo',
    // Au-delà de l'horizon AROME/ARPEGE fin, la précision décroît : les
    // 2 derniers jours servis sont marqués « tendance » (confiance moindre).
    trendFromDay: 5,
  },
  TN: {
    path: '/v1/forecast',
    provider: 'open-meteo:best_match',
    label: 'Modèle global via Open-Meteo',
    trendFromDay: 4,
  },
};

const cache = new Map(); // key → { at, data }
const failAt = new Map();
const pending = new Map();
const TTL_MS = 3 * 3600_000; // les quotidiennes bougent lentement
const KEEP_MS = 12 * 3600_000;

export function forecastEnabled(countryCode) {
  return getSetting(`fire_forecast_enabled_${String(countryCode || '').toLowerCase()}`) === '1';
}

// Prévision quotidienne pour un point du territoire. null si aucune donnée
// (jamais de valeurs inventées).
export async function getDailyForecast(lat, lng, countryCode) {
  const p = getProfile(countryCode);
  const conf = PROVIDERS[p?.code];
  if (!conf) return null;
  const key = `${p.code}:${(+lat).toFixed(2)}:${(+lng).toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const lastKnown = hit && Date.now() - hit.at < KEEP_MS
    ? { ...hit.data, stale: true } : null;
  if (failAt.has(key) && Date.now() - failAt.get(key) < 5 * 60_000) return lastKnown;
  if (pending.has(key)) return pending.get(key);
  const inflight = (async () => {
    try {
      const url = `${BASE()}${conf.path}?latitude=${(+lat).toFixed(3)}&longitude=${(+lng).toFixed(3)}`
        + `&daily=${DAILY}&forecast_days=7&timezone=UTC`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`forecast ${res.status}`);
      const j = await res.json();
      const d = j?.daily;
      if (!Array.isArray(d?.time) || !d.time.length) throw new Error('forecast empty');
      const days = d.time.map((date, i) => ({
        date,
        tMaxC: numOrNull(d.temperature_2m_max?.[i]),
        rhMinPct: numOrNull(d.relative_humidity_2m_min?.[i]),
        windMaxKmh: numOrNull(d.wind_speed_10m_max?.[i]),
        gustsMaxKmh: numOrNull(d.wind_gusts_10m_max?.[i]),
        precipMm: numOrNull(d.precipitation_sum?.[i]),
        // Fin de fenêtre = TENDANCE (confiance moindre), jamais présentée
        // comme aussi précise que demain.
        confidence: i >= conf.trendFromDay ? 'trend' : (i <= 2 ? 'high' : 'medium'),
      }));
      const data = {
        days,
        provider: conf.provider,
        modelLabel: conf.label,
        fetchedAt: new Date().toISOString(),
        stale: false,
        note: 'Conditions météorologiques — jamais une prévision d’incendie.',
      };
      cache.set(key, { at: Date.now(), data });
      if (cache.size > 300) cache.delete(cache.keys().next().value);
      failAt.delete(key);
      return data;
    } catch {
      failAt.set(key, Date.now());
      return lastKnown;
    } finally { pending.delete(key); }
  })();
  pending.set(key, inflight);
  return inflight;
}

const numOrNull = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : null);
