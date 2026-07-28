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
import { getWind, getHeat, getWeatherGrid, windIsStale, downwindContext, distanceKm } from '../services/wind.js';
import { requestCountry, inCountry } from '../countries/index.js';
import { publicConfidenceList } from '../services/firms.js';
import { burntAreasInBbox } from '../services/effis.js';
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

  // Vent et chaleur au centre de la zone visible — pannes indépendantes.
  const [wind, heat] = await Promise.all([
    getWind(centerLat, centerLng), getHeat(centerLat, centerLng)]);
  const official = officialUpdatesFor(country, centerLat, centerLng, 3);
  const safetyActive = official.some((u) =>
    ['safety_instruction', 'evacuation', 'shelter_in_place'].includes(u.infoType));

  // État de la veille Vigilance Météo-France : rendu VISIBLE même quand tout
  // est calme (« rien à signaler » est une information en soi). activeDepartments
  // compte les bulletins orange/rouge en cours sur TOUTE la France — le détail
  // localisé reste porté par la section « informations officielles ».
  let vigilance = null;
  const vigilanceMonitored = Boolean(process.env.METEOFRANCE_API_KEY)
    && getSetting('vigilance_enabled') !== '0';
  if (vigilanceMonitored) {
    const activeDepartments = db.prepare(
      `SELECT COUNT(*) n FROM official_updates
       WHERE authority_id = 'mf_vigilance' AND status = 'current' AND is_published = 1
         AND (valid_until IS NULL OR valid_until > strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    ).get().n;
    vigilance = { activeDepartments, checkedAt: getSetting('vigilance_last_success_at') || null };
  }

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
    vigilance, // null si la veille Météo-France n'est pas configurée
    heat,      // chaleur locale (température ≠ danger ≠ feu) — null si indisponible
  });
});

// ── Vigilance Météo-France : liste des alertes en cours (fiche dédiée) ───────
// Alimenté par la veille automatique (services/vigilance.js). En période calme
// la liste est vide — l'interface l'affiche comme « rien à signaler », jamais
// comme une absence d'information. Charge utile compacte, aucune clé exposée.
fireSituationRouter.get('/vigilance', ipRateLimit('firesit_ip', 60, 5), (req, res) => {
  const country = requestCountry(req);
  if (!enabledFor(country)) return res.json({ enabled: false });
  const monitored = Boolean(process.env.METEOFRANCE_API_KEY)
    && getSetting('vigilance_enabled') !== '0';
  if (!monitored) return res.json({ enabled: true, monitored: false, alerts: [] });
  const rows = db.prepare(
    `SELECT id, source_title, summary_fr, summary_ar, severity, affected_dept_codes,
            centroid_lat, centroid_lng, valid_until, published_at, source_url
     FROM official_updates
     WHERE authority_id = 'mf_vigilance' AND status = 'current' AND is_published = 1
       AND (valid_until IS NULL OR valid_until > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ORDER BY CASE severity WHEN 'urgent' THEN 0 ELSE 1 END, published_at DESC LIMIT 120`
  ).all();
  res.json({
    enabled: true,
    monitored: true,
    checkedAt: getSetting('vigilance_last_success_at') || null,
    alerts: rows.map((r) => ({
      id: r.id,
      title: r.source_title,                       // « Vigilance orange — Gironde »
      deptCode: r.affected_dept_codes,
      color: r.severity === 'urgent' ? 'rouge' : 'orange',
      summaryFr: r.summary_fr,
      summaryAr: r.summary_ar,
      lat: r.centroid_lat, lng: r.centroid_lng,
      validUntil: r.valid_until,
      publishedAt: r.published_at,
      sourceUrl: r.source_url,
    })),
  });
});

// ── Grille météo de la zone visible : « nuage de couleur » + flèches ─────────
// Valeurs prêtes à dessiner (température par cellule, vent par point) —
// charge minuscule, cache serveur, panne indépendante. France uniquement.
fireSituationRouter.get('/weather-grid', ipRateLimit('firesit_ip', 60, 5), async (req, res) => {
  const country = requestCountry(req);
  if (!enabledFor(country)) return res.json({ enabled: false });
  const q = req.query;
  const hasBbox = ['minLat', 'maxLat', 'minLng', 'maxLng'].every((k) => isFiniteNum(q[k], -180, 180));
  if (!hasBbox) return res.status(400).json({ error: msg(req, 'invalid_params') });
  const grid = await getWeatherGrid(+q.minLat, +q.maxLat, +q.minLng, +q.maxLng, 4);
  // Le voile météo ne se peint QUE sur la France : les cellules hors des
  // frontières du pays consulté sont écartées (jamais de météo « française »
  // affichée sur l'Algérie ou l'Italie).
  if (grid?.cells) grid.cells = grid.cells.filter((c) => inCountry(c.lat, c.lng, country));
  res.json({ enabled: true, grid }); // grid null = météo indisponible (honnête)
});

// ── Zones brûlées récentes — Copernicus EFFIS (France) ───────────────────────
// Contours APPROXIMATIFS estimés par satellite du périmètre déjà brûlé,
// simplifiés côté serveur (services/effis.js). Jamais un périmètre officiel,
// jamais une prévision. Cache serveur : EFFIS n'est JAMAIS appelé ici.
fireSituationRouter.get('/burnt-areas', ipRateLimit('firesit_ip', 60, 5), (req, res) => {
  const country = requestCountry(req);
  if (!enabledFor(country)) return res.json({ enabled: false });
  const q = req.query;
  const hasBbox = ['minLat', 'maxLat', 'minLng', 'maxLng'].every((k) => isFiniteNum(q[k], -180, 180));
  if (!hasBbox) return res.status(400).json({ error: msg(req, 'invalid_params') });
  const { updatedAt, areas } = burntAreasInBbox({
    minLat: +q.minLat, maxLat: +q.maxLat, minLng: +q.minLng, maxLng: +q.maxLng,
  });
  // updatedAt null = cache pas encore constitué (première synchro à venir) —
  // l'interface n'affiche simplement rien, jamais une erreur.
  res.json({ enabled: true, source: 'Copernicus EFFIS', updatedAt, areas });
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
  const [wind, heat] = await Promise.all([getWind(fire.lat, fire.lng), getHeat(fire.lat, fire.lng)]);
  if (!wind) return res.json({ enabled: true, wind: null, heat }); // pannes indépendantes
  const user = isFiniteNum(q.userLat, -90, 90) && isFiniteNum(q.userLng, -180, 180)
    ? { lat: +q.userLat, lng: +q.userLng } : null;
  res.json({
    enabled: true,
    wind: {
      speedKmh: wind.speedKmh, gustsKmh: wind.gustsKmh,
      directionFromDeg: wind.directionFromDeg, directionToDeg: wind.directionToDeg,
      observedAt: wind.observedAt, stale: windIsStale(wind), provider: wind.provider,
    },
    heat, // chaleur au foyer (tuiles météo complètes même via lien profond)
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
