// API cartographique « Feux FR » (Lot 1) — deux lectures :
//   · /api/fire/map      : instantané complet d'une zone, avec meta.sources
//     (fraîcheur RÉELLE par source) et un paramètre `at` qui ne restitue que
//     ce qui était CONNU à cet instant (détections observées avant `at`,
//     périmètres EFFIS déjà PUBLIÉS à `at` — jamais rétro-datés) ;
//   · /api/fire/timeline : agrégats horaires (détections, FRP, publications
//     EFFIS, signalements citoyens) pour la frise de replay.
// Quadruple horodatage : observed/published + received + generatedAt ; la
// météo porte son modèle (AROME France HD, explicite). Quasi temps réel —
// jamais présenté comme « en direct ».
import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { isFiniteNum } from '../middleware/security.js';
import { ipRateLimit } from '../middleware/rateLimit.js';
import { requestCountry } from '../countries/index.js';
import { getWind, getHeat } from '../services/wind.js';
import { effisStatus } from '../services/effis.js';
import { msg } from '../i18n.js';

export const fireRouter = Router();

const enabledFor = (country) => country === 'FR' && getSetting('fire_situation_enabled_fr') !== '0';

function parseBbox(q) {
  if (!['minLat', 'maxLat', 'minLng', 'maxLng'].every((k) => isFiniteNum(q[k], -180, 180))) return null;
  return { minLat: +q.minLat, maxLat: +q.maxLat, minLng: +q.minLng, maxLng: +q.maxLng };
}
const iso = (v) => {
  const t = Date.parse(String(v || ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

// ── Instantané ───────────────────────────────────────────────────────────────
fireRouter.get('/map', ipRateLimit('firemap_ip', 60, 5), async (req, res) => {
  const country = requestCountry(req);
  if (!enabledFor(country)) return res.json({ enabled: false });
  const b = parseBbox(req.query);
  if (!b) return res.status(400).json({ error: msg(req, 'invalid_params') });
  const at = iso(req.query.at); // replay : « ce qui était connu à cet instant »
  const now = new Date().toISOString();
  const since = new Date(Date.parse(at || now) - 72 * 3600_000).toISOString();

  // Détections IMMUABLES des 72 h précédant `at` (500 max, plus récentes d'abord).
  const detections = db.prepare(
    `SELECT lat, lng, acquired_at AS observedAt, received_at AS receivedAt,
            satellite, instrument, confidence, frp, day_night AS dayNight
     FROM satellite_detections
     WHERE country_code = ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
       AND acquired_at > ? AND acquired_at <= ?
     ORDER BY acquired_at DESC LIMIT 500`
  ).all(country, b.minLat, b.maxLat, b.minLng, b.maxLng, since, at || now);

  // Périmètres EFFIS : à `at`, la DERNIÈRE version PUBLIÉE avant `at` de
  // chaque périmètre (un périmètre publié le 31 à 08:00 n'existe pas dans un
  // replay au 30 à 20:00, même si le feu avait commencé avant).
  const burnedAreas = db.prepare(
    `SELECT v.effis_feature_id AS featureId, v.geometry_display AS rings,
            v.area_ha_source AS areaHa, v.commune, v.province, v.fire_date AS fireDate,
            v.published_at AS publishedAt, v.received_at AS receivedAt
     FROM burned_area_versions v
     JOIN (SELECT effis_feature_id, MAX(published_at) AS mp
           FROM burned_area_versions WHERE published_at <= ?
           GROUP BY effis_feature_id) last
       ON last.effis_feature_id = v.effis_feature_id AND last.mp = v.published_at
     ORDER BY v.fire_date DESC LIMIT 80`
  ).all(at || now).map((r) => ({ ...r, rings: JSON.parse(r.rings) }))
    .filter((r) => Array.isArray(r.rings?.[0])
      && r.rings.some((ring) => ring.some(([lat, lng]) =>
        lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng)));

  // Signalements citoyens actifs (positions PUBLIQUES uniquement).
  const citizenReports = db.prepare(
    `SELECT public_id AS publicId, type, severity, public_lat AS lat, public_lng AS lng,
            public_area AS area, started_at AS startedAt, updated_at AS updatedAt
     FROM incidents WHERE status = 'active' AND COALESCE(country_code,'TN') = ?
       AND public_lat BETWEEN ? AND ? AND public_lng BETWEEN ? AND ?
     ORDER BY started_at DESC LIMIT 200`
  ).all(country, b.minLat, b.maxLat, b.minLng, b.maxLng);

  // Météo au centre (le replay météo arrive au Lot 3 — dit explicitement).
  const cLat = (b.minLat + b.maxLat) / 2, cLng = (b.minLng + b.maxLng) / 2;
  const [wind, heat] = at ? [null, null]
    : await Promise.all([getWind(cLat, cLng), getHeat(cLat, cLng)]);

  const g = (k) => getSetting(k) || null;
  const effis = effisStatus();
  res.json({
    enabled: true,
    meta: {
      generatedAt: now,
      replayAt: at, // null = présent
      replayLimited: Boolean(at), // météo/aérien non rejoués à ce lot
      sources: {
        firms: {
          latestObservation: detections[0]?.observedAt || null,
          lastSync: g('firms_last_sync_at'),
          status: g('firms_last_success_at') ? 'fresh' : 'unavailable',
          note: 'Observations satellite en quasi temps réel — jamais une caméra en direct.',
        },
        effis: {
          publishedAt: burnedAreas[0]?.publishedAt || null,
          lastCheck: effis.lastSuccess,
          status: effis.hasError ? 'delayed' : (effis.lastSuccess ? 'fresh' : 'unavailable'),
        },
        weather: {
          model: 'AROME France HD (Météo-France) via Open-Meteo',
          fetchedAt: wind?.fetchedAt || null,
          validAt: wind?.observedAt || null,
          status: wind ? 'fresh' : (at ? 'not_replayed' : 'unavailable'),
        },
      },
    },
    detections,
    burnedAreas,
    citizenReports,
    weather: wind || heat ? { wind, heat } : null,
  });
});

// ── Timeline (frise de replay) ───────────────────────────────────────────────
fireRouter.get('/timeline', ipRateLimit('firemap_ip', 60, 5), (req, res) => {
  const country = requestCountry(req);
  if (!enabledFor(country)) return res.json({ enabled: false });
  const b = parseBbox(req.query);
  if (!b) return res.status(400).json({ error: msg(req, 'invalid_params') });
  const to = iso(req.query.to) || new Date().toISOString();
  let from = iso(req.query.from) || new Date(Date.parse(to) - 72 * 3600_000).toISOString();
  // Fenêtre bornée à 10 jours (l'historique opérationnel).
  if (Date.parse(to) - Date.parse(from) > 10 * 24 * 3600_000) {
    from = new Date(Date.parse(to) - 10 * 24 * 3600_000).toISOString();
  }
  const hour = (col) => `strftime('%Y-%m-%dT%H:00:00Z', ${col})`;
  const detections = db.prepare(
    `SELECT ${hour('acquired_at')} AS h, COUNT(*) AS n, ROUND(SUM(COALESCE(frp,0)), 1) AS frpSum
     FROM satellite_detections
     WHERE country_code = ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
       AND acquired_at BETWEEN ? AND ?
     GROUP BY h ORDER BY h`
  ).all(country, b.minLat, b.maxLat, b.minLng, b.maxLng, from, to);
  const effisPubs = db.prepare(
    `SELECT ${hour('published_at')} AS h, COUNT(*) AS n
     FROM burned_area_versions WHERE published_at BETWEEN ? AND ?
     GROUP BY h ORDER BY h`
  ).all(from, to);
  const citizen = db.prepare(
    `SELECT ${hour('created_at')} AS h, COUNT(*) AS n
     FROM incidents WHERE COALESCE(country_code,'TN') = ? AND type = 'fire'
       AND public_lat BETWEEN ? AND ? AND public_lng BETWEEN ? AND ?
       AND created_at BETWEEN ? AND ?
     GROUP BY h ORDER BY h`
  ).all(country, b.minLat, b.maxLat, b.minLng, b.maxLng, from, to);
  res.json({
    enabled: true,
    from, to,
    note: 'FRP cumulée par heure d’observation — jamais une taille, une température ni une surface de feu.',
    detections, effisPublications: effisPubs, citizenFires: citizen,
  });
});
