// API plateforme incidents/feux — MUTUALISÉE par territoire (addendum).
// Deux lectures :
//   · /api/fire/map      : instantané d'une zone, piloté par le REGISTRE DE
//     CAPACITÉS (jamais de `if country === 'FR'` : chaque couche n'est lue et
//     mentionnée QUE si le territoire la possède — une réponse tunisienne ne
//     contient ni EFFIS ni AROME). meta.sources porte la fraîcheur TYPÉE
//     (sourceFreshness) et le paramètre `at` ne restitue que ce qui était
//     CONNU à cet instant (détections observées avant `at`, périmètres déjà
//     PUBLIÉS à `at` — jamais rétro-datés) ;
//   · /api/fire/timeline : agrégats horaires pour la frise de replay.
// Quadruple horodatage : observed/published + received + generatedAt ; la
// météo porte son modèle (configuration territoriale). Quasi temps réel —
// jamais présenté comme « en direct ».
import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { isFiniteNum } from '../middleware/security.js';
import { ipRateLimit } from '../middleware/rateLimit.js';
import { requestCountry } from '../countries/index.js';
import { getCapabilities } from '../services/capabilityRegistry.js';
import { classifyFreshness, freshnessFromLastSuccess } from '../services/sourceFreshness.js';
import { getWind, getHeat } from '../services/wind.js';
import { getDailyForecast, forecastEnabled } from '../services/fireForecast.js';
import { summarizeConditions } from '../services/fireForecastSummary.js';
import { effisStatus } from '../services/effis.js';
import { aircraftInBbox } from '../services/aircraft.js';
import { getLang, msg } from '../i18n.js';
import { nsMsg } from '../services/i18nNamespaces.js';

export const fireRouter = Router();

// Dernier import FIRMS réussi, par pays (clé historique côté TN).
const firmsSuccessKey = (c) => (c === 'TN' ? 'firms_last_success_at' : `firms_last_success_at_${c.toLowerCase()}`);
const firmsSyncKey = (c) => (c === 'TN' ? 'firms_last_sync_at' : `firms_last_sync_at_${c.toLowerCase()}`);

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
  const caps = getCapabilities({ countryCode: country });
  if (!caps?.fireMode) return res.json({ enabled: false });
  const lang = getLang(req) === 'ar' ? 'ar' : 'fr';
  const b = parseBbox(req.query);
  if (!b) return res.status(400).json({ error: msg(req, 'invalid_params') });
  const at = iso(req.query.at); // replay : « ce qui était connu à cet instant »
  const now = new Date().toISOString();
  const since = new Date(Date.parse(at || now) - 72 * 3600_000).toISOString();

  // Détections IMMUABLES des 72 h précédant `at` (500 max, plus récentes d'abord).
  // datetime() DES DEUX CÔTÉS : les bornes arrivent en ISO « T…Z », les
  // détections sont stockées « YYYY-MM-DD HH:MM:SS » et les périmètres EFFIS
  // en ISO « T…Z » — sans normalisation des deux côtés, la comparaison TEXTE
  // se trompe autour des frontières de jour (l'espace trie avant le « T »).
  const detections = db.prepare(
    `SELECT lat, lng, acquired_at AS observedAt, received_at AS receivedAt,
            satellite, instrument, confidence, frp, day_night AS dayNight
     FROM satellite_detections
     WHERE country_code = ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
       AND datetime(acquired_at) > datetime(?) AND datetime(acquired_at) <= datetime(?)
     ORDER BY acquired_at DESC LIMIT 500`
  ).all(country, b.minLat, b.maxLat, b.minLng, b.maxLng, since, at || now);

  // Périmètres de zones brûlées — UNIQUEMENT si le territoire possède la
  // capacité (sinon la réponse n'en parle pas du tout). À `at` : la DERNIÈRE
  // version PUBLIÉE avant `at` de chaque périmètre (un périmètre publié le 31
  // à 08:00 n'existe pas dans un replay au 30 à 20:00).
  const hasBurned = caps.layers.burnedAreas?.enabled === true;
  const burnedAreas = !hasBurned ? null : db.prepare(
    `SELECT v.effis_feature_id AS featureId, v.geometry_display AS rings,
            v.area_ha_source AS areaHa, v.commune, v.province, v.fire_date AS fireDate,
            v.published_at AS publishedAt, v.received_at AS receivedAt
     FROM burned_area_versions v
     JOIN (SELECT effis_feature_id, MAX(published_at) AS mp
           FROM burned_area_versions WHERE datetime(published_at) <= datetime(?)
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

  // Météo au centre — uniquement si le territoire a un modèle CONFIGURÉ
  // (jamais de fournisseur hors de sa couverture, jamais de repli silencieux).
  const hasWeather = caps.layers.weatherModel?.enabled === true;
  const cLat = (b.minLat + b.maxLat) / 2, cLng = (b.minLng + b.maxLng) / 2;
  const [wind, heat] = (!hasWeather || at) ? [null, null]
    : await Promise.all([getWind(cLat, cLng), getHeat(cLat, cLng)]);

  const g = (k) => getSetting(k) || null;

  // meta.sources : une entrée PAR CAPACITÉ ACTIVE, avec fraîcheur typée.
  const sources = {
    firms: {
      latestObservation: detections[0]?.observedAt || null,
      lastSync: g(firmsSyncKey(country)) || g('firms_last_sync_at'),
      ...freshnessFromLastSuccess('thermalDetections',
        g(firmsSuccessKey(country)) || g('firms_last_success_at')),
      note: nsMsg(lang, 'fire', 'detection_note'),
    },
  };
  if (hasBurned) {
    const effis = effisStatus();
    sources.effis = {
      publishedAt: burnedAreas?.[0]?.publishedAt || null,
      lastCheck: effis.lastSuccess,
      ...freshnessFromLastSuccess('burnedAreas', effis.lastSuccess),
    };
  }
  if (hasWeather) {
    sources.weather = {
      model: caps.layers.weatherModel.label || caps.layers.weatherModel.model,
      fetchedAt: wind?.fetchedAt || null,
      validAt: wind?.observedAt || null,
      status: at ? 'not_replayed'
        : (wind ? classifyFreshness('weatherModel',
            Math.max(0, Math.round((Date.now() - Date.parse(wind.fetchedAt || now)) / 1000)))
          : 'unavailable'),
    };
  }

  const payload = {
    enabled: true,
    meta: {
      generatedAt: now,
      country,
      replayAt: at, // null = présent
      replayLimited: Boolean(at), // météo/aérien non rejoués à ce lot
      sources,
    },
    detections,
    citizenReports,
  };
  if (hasBurned) payload.burnedAreas = burnedAreas;
  if (hasWeather) payload.weather = wind || heat ? { wind, heat } : null;
  res.json(payload);
});

// ── Prévisions des conditions (drapeau par territoire, ÉTEINT par défaut) ───
fireRouter.get('/forecast', ipRateLimit('firemap_ip', 60, 5), async (req, res) => {
  const country = requestCountry(req);
  if (!forecastEnabled(country)) return res.json({ enabled: false });
  const lang = getLang(req) === 'ar' ? 'ar' : 'fr';
  if (!isFiniteNum(req.query.lat, -90, 90) || !isFiniteNum(req.query.lng, -180, 180)) {
    return res.status(400).json({ error: msg(req, 'invalid_params') });
  }
  const f = await getDailyForecast(Number(req.query.lat), Number(req.query.lng), country);
  if (!f) return res.json({ enabled: true, available: false });
  res.json({
    enabled: true, available: true, ...f,
    summary: summarizeConditions(f.days, lang),
    disclaimer: nsMsg(lang, 'fire', 'forecast_disclaimer'),
  });
});

// ── Moyens aériens observés (ADS-B, #82) ────────────────────────────────────
// Capacité du REGISTRE (drapeau territorial à chaud, éteint par défaut).
// Des aéronefs OBSERVÉS — jamais une confirmation d'intervention ni une
// classification inventée : le code constructeur est transmis BRUT.
fireRouter.get('/aircraft', ipRateLimit('firemap_ip', 60, 5), (req, res) => {
  const country = requestCountry(req);
  const caps = getCapabilities({ countryCode: country });
  if (!caps?.fireMode) return res.json({ enabled: false });
  const a = caps.layers.aircraft;
  if (a?.enabled !== true) return res.json({ enabled: false, reason: a?.reason || 'no_verified_source' });
  const lang = getLang(req) === 'ar' ? 'ar' : 'fr';
  const b = parseBbox(req.query);
  if (!b) return res.status(400).json({ error: msg(req, 'invalid_params') });
  const { aircraft, fetchedAt } = aircraftInBbox(country, b);
  const ageS = fetchedAt ? Math.max(0, Math.round((Date.now() - Date.parse(fetchedAt)) / 1000)) : null;
  res.json({
    enabled: true,
    meta: {
      generatedAt: new Date().toISOString(),
      country,
      sources: {
        aircraft: {
          provider: a.label || a.provider,
          fetchedAt,
          status: ageS === null ? 'unavailable' : classifyFreshness('aircraft', ageS),
        },
      },
    },
    aircraft,
    note: nsMsg(lang, 'fire', 'aircraft_note'),
  });
});

// ── Timeline (frise de replay) ───────────────────────────────────────────────
fireRouter.get('/timeline', ipRateLimit('firemap_ip', 60, 5), (req, res) => {
  const country = requestCountry(req);
  const caps = getCapabilities({ countryCode: country });
  if (!caps?.fireMode) return res.json({ enabled: false });
  const lang = getLang(req) === 'ar' ? 'ar' : 'fr';
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
       AND datetime(acquired_at) BETWEEN datetime(?) AND datetime(?)
     GROUP BY h ORDER BY h`
  ).all(country, b.minLat, b.maxLat, b.minLng, b.maxLng, from, to);
  const citizen = db.prepare(
    `SELECT ${hour('created_at')} AS h, COUNT(*) AS n
     FROM incidents WHERE COALESCE(country_code,'TN') = ? AND type = 'fire'
       AND public_lat BETWEEN ? AND ? AND public_lng BETWEEN ? AND ?
       AND datetime(created_at) BETWEEN datetime(?) AND datetime(?)
     GROUP BY h ORDER BY h`
  ).all(country, b.minLat, b.maxLat, b.minLng, b.maxLng, from, to);
  const payload = {
    enabled: true,
    from, to,
    note: nsMsg(lang, 'fire', 'frp_note'),
    detections, citizenFires: citizen,
  };
  // Publications de zones brûlées : uniquement là où la capacité existe.
  if (caps.layers.burnedAreas?.enabled === true) {
    payload.effisPublications = db.prepare(
      `SELECT ${hour('published_at')} AS h, COUNT(*) AS n
       FROM burned_area_versions WHERE datetime(published_at) BETWEEN datetime(?) AND datetime(?)
       GROUP BY h ORDER BY h`
    ).all(from, to);
  }
  res.json(payload);
});
