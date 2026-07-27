// « Situation incendie » — API compactes de l'expérience feu française :
// résumé local, vent contextuel, informations officielles locales.
// Quatre principes non négociables :
//   1. chaque source tombe en panne INDÉPENDAMMENT (jamais de blocage global) ;
//   2. jamais de prévision de propagation ni de score de risque ;
//   3. chaque donnée porte sa source et son horodatage ;
//   4. charges utiles compactes (le frontend n'interroge que Kifeh).
import { Router } from 'express';
import { db, getSetting, getSettingNum } from '../db.js';
import { isFiniteNum, cleanText } from '../middleware/security.js';
import { ipRateLimit } from '../middleware/rateLimit.js';
import { getWind, windIsStale, downwindContext, distanceKm } from '../services/wind.js';
import { requestCountry } from '../countries/index.js';
import { publicConfidenceList } from '../services/firms.js';
import { msg } from '../i18n.js';

export const fireSituationRouter = Router();

// L'expérience est aujourd'hui ACTIVÉE POUR LA FRANCE ; la Tunisie garde son
// comportement actuel (drapeau distinct possible plus tard).
function enabledFor(country) {
  return country === 'FR' && getSetting('fire_situation_enabled_fr') !== '0';
}

// Mises à jour officielles pertinentes pour un point : zone du message
// (centre + rayon) sinon portée nationale — les plus spécifiques d'abord.
const COVERAGE_RANK = { commune: 0, intercommunalite: 1, departement: 2, region: 3, national: 4 };
function officialUpdatesFor(country, lat, lng, limit = 5) {
  const rows = db.prepare(
    `SELECT u.*, a.name AS authority_name, a.authority_type, a.coverage_level
     FROM official_updates u JOIN official_authorities a ON a.id = u.authority_id
     WHERE u.country_code = ? AND u.is_published = 1 AND u.status = 'current'
       AND a.is_active = 1
       AND (u.valid_until IS NULL OR u.valid_until > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ORDER BY u.published_at DESC LIMIT 100`
  ).all(country);
  const relevant = rows.filter((u) => {
    if (u.centroid_lat != null && u.centroid_lng != null && u.radius_km != null) {
      if (lat == null) return u.coverage_level === 'national';
      return distanceKm(lat, lng, u.centroid_lat, u.centroid_lng) <= u.radius_km;
    }
    return u.coverage_level === 'national' || lat == null;
  });
  relevant.sort((a, b) =>
    (COVERAGE_RANK[a.coverage_level] ?? 9) - (COVERAGE_RANK[b.coverage_level] ?? 9)
    || Date.parse(b.published_at) - Date.parse(a.published_at));
  // Charge utile publique compacte — le texte original s'obtient au détail.
  return relevant.slice(0, limit).map(publicUpdate);
}

function publicUpdate(u) {
  return {
    id: u.id,
    authority: u.authority_name,
    authorityType: u.authority_type,
    coverageLevel: u.coverage_level,
    infoType: u.info_type,
    severity: u.severity,
    summaryFr: u.summary_fr,
    summaryAr: u.summary_ar,        // résumé Kifeh, étiqueté comme tel côté client
    publishedAt: u.published_at,
    updatedAtSource: u.updated_at_source,
    sourceUrl: u.source_url,
    isFrAlert: u.authority_type === 'fr_alert',
    hasGeometry: Boolean(u.geometry_json),
    geometrySource: u.geometry_source || null,
    centroid: u.centroid_lat != null ? { lat: u.centroid_lat, lng: u.centroid_lng, radiusKm: u.radius_km } : null,
  };
}

// ── Résumé local (« Autour de … ») — < 20 Ko, zone visible uniquement ────────
fireSituationRouter.get('/summary', ipRateLimit('firesit_ip', 60, 5), async (req, res) => {
  const country = requestCountry(req);
  if (!enabledFor(country)) return res.json({ enabled: false });
  const q = req.query;
  const hasBbox = ['minLat', 'maxLat', 'minLng', 'maxLng'].every((k) => isFiniteNum(q[k], -180, 180));
  if (!hasBbox) return res.status(400).json({ error: msg(req, 'invalid_params') });
  const b = { minLat: +q.minLat, maxLat: +q.maxLat, minLng: +q.minLng, maxLng: +q.maxLng };
  const centerLat = (b.minLat + b.maxLat) / 2, centerLng = (b.minLng + b.maxLng) / 2;

  const fires = db.prepare(
    `SELECT COUNT(*) n FROM incidents WHERE type = 'fire' AND status = 'active'
     AND COALESCE(country_code,'TN') = ? AND public_lat BETWEEN ? AND ? AND public_lng BETWEEN ? AND ?`
  ).get(country, b.minLat, b.maxLat, b.minLng, b.maxLng).n;
  const conf = publicConfidenceList();
  const sats = db.prepare(
    `SELECT COUNT(*) n FROM satellite_events WHERE status IN ('active','no_new_detection')
     AND COALESCE(country_code,'TN') = ? AND max_confidence IN (${conf.map(() => '?').join(',')})
     AND centroid_lat BETWEEN ? AND ? AND centroid_lng BETWEEN ? AND ?
     AND last_detected_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours')`
  ).get(country, ...conf, b.minLat, b.maxLat, b.minLng, b.maxLng).n;

  // Vent au centre de la zone visible — panne indépendante (null accepté).
  const wind = await getWind(centerLat, centerLng);
  const official = officialUpdatesFor(country, centerLat, centerLng, 3);
  const safetyActive = official.some((u) =>
    ['safety_instruction', 'evacuation', 'shelter_in_place'].includes(u.infoType));

  res.json({
    enabled: true,
    communityFires: fires,
    satelliteEvents: sats,
    wind: wind ? {
      speedKmh: wind.speedKmh, gustsKmh: wind.gustsKmh,
      directionToDeg: wind.directionToDeg, observedAt: wind.observedAt,
      stale: windIsStale(wind), provider: wind.provider,
    } : null,
    latestOfficialAt: official[0]?.publishedAt || null,
    safetyActive,
    official,
  });
});

// ── Vent contextuel d'un foyer + contexte « sous le vent » ───────────────────
// fireLat/fireLng : position (publique) du foyer ; userLat/userLng facultatifs.
fireSituationRouter.get('/wind', ipRateLimit('firesit_ip', 60, 5), async (req, res) => {
  const country = requestCountry(req);
  if (!enabledFor(country)) return res.json({ enabled: false });
  const q = req.query;
  if (!isFiniteNum(q.fireLat, -90, 90) || !isFiniteNum(q.fireLng, -180, 180)) {
    return res.status(400).json({ error: msg(req, 'invalid_params') });
  }
  const fire = { lat: +q.fireLat, lng: +q.fireLng };
  const wind = await getWind(fire.lat, fire.lng);
  if (!wind) return res.json({ enabled: true, wind: null }); // panne indépendante
  const user = isFiniteNum(q.userLat, -90, 90) && isFiniteNum(q.userLng, -180, 180)
    ? { lat: +q.userLat, lng: +q.userLng } : null;
  res.json({
    enabled: true,
    wind: {
      speedKmh: wind.speedKmh, gustsKmh: wind.gustsKmh,
      directionFromDeg: wind.directionFromDeg, directionToDeg: wind.directionToDeg,
      observedAt: wind.observedAt, stale: windIsStale(wind), provider: wind.provider,
    },
    // Contexte conservateur — jamais une prévision de propagation.
    downwind: user ? downwindContext(fire, user, wind) : null,
    distanceKm: user ? Math.round(distanceKm(fire.lat, fire.lng, user.lat, user.lng) * 10) / 10 : null,
  });
});

// ── Informations officielles pour un point (commune la plus spécifique d'abord)
fireSituationRouter.get('/official', ipRateLimit('firesit_ip', 60, 5), (req, res) => {
  const country = requestCountry(req);
  if (!enabledFor(country)) return res.json({ enabled: false, updates: [] });
  const q = req.query;
  const lat = isFiniteNum(q.lat, -90, 90) ? +q.lat : null;
  const lng = isFiniteNum(q.lng, -180, 180) ? +q.lng : null;
  res.json({ enabled: true, updates: officialUpdatesFor(country, lat, lng, 5) });
});

// ── Détail d'un message officiel (texte original préservé + périmètre) ───────
fireSituationRouter.get('/official/:id', ipRateLimit('firesit_ip', 60, 5), (req, res) => {
  const u = db.prepare(
    `SELECT u.*, a.name AS authority_name, a.authority_type, a.coverage_level
     FROM official_updates u JOIN official_authorities a ON a.id = u.authority_id
     WHERE u.id = ? AND u.is_published = 1`
  ).get(String(req.params.id));
  if (!u) return res.status(404).json({ error: msg(req, 'incident_not_found') });
  let geometry = null;
  try { geometry = u.geometry_json ? JSON.parse(u.geometry_json) : null; } catch {}
  res.json({
    ...publicUpdate(u),
    rawContent: cleanText(u.raw_content, 4000),
    geometry,
  });
});
