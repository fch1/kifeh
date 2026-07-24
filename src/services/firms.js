// NASA FIRMS — Fire Information for Resource Management System.
// Import serveur des détections satellitaires d'anomalies thermiques (Tunisie),
// regroupement en « événements incendie satellite », corroboration des
// signalements citoyens. La clé API ne quitte JAMAIS le serveur et n'apparaît
// JAMAIS dans les journaux.
//
// Principe : une détection FIRMS est un point chaud observé par satellite —
// jamais présentée comme une confirmation officielle d'incendie.
import { db, getSetting, getSettingNum, setSetting } from '../db.js';
import { uuid, sha256 } from './crypto.js';
import { broadcast } from '../routes/events.js';
import { audit } from './audit.js';
import { config } from '../config.js';

// Zone rectangulaire couvrant la Tunisie (ouest,sud,est,nord) pour l'API,
// puis filtrage fin par polygone simplifié des frontières tunisiennes.
const TUNISIA_BBOX = '7.5,30.2,11.6,37.6';
const TUNISIA_POLYGON = [
  [37.35, 9.75], [37.28, 10.20], [36.95, 10.35], [36.85, 10.65], [37.05, 11.05],
  [36.75, 11.10], [36.45, 10.80], [36.05, 10.60], [35.70, 10.85], [35.25, 11.05],
  [34.75, 11.15], [34.35, 10.35], [33.90, 10.15], [33.65, 10.95], [33.20, 11.40],
  [32.95, 11.60], [32.40, 11.55], [31.95, 10.75], [31.45, 10.30], [30.85, 10.05],
  [30.20, 9.90], [30.20, 9.30], [30.90, 9.05], [31.60, 9.10], [32.20, 8.60],
  [32.75, 8.35], [33.30, 8.15], [33.90, 7.75], [34.45, 7.85], [34.95, 8.30],
  [35.55, 8.35], [36.10, 8.25], [36.60, 8.30], [36.95, 8.65], [37.10, 9.10],
  [37.35, 9.75],
];

function inTunisia(lat, lng) {
  // Point dans polygone (ray casting) — suffisant pour écarter mer et voisins.
  let inside = false;
  for (let i = 0, j = TUNISIA_POLYGON.length - 1; i < TUNISIA_POLYGON.length; j = i++) {
    const [yi, xi] = TUNISIA_POLYGON[i], [yj, xj] = TUNISIA_POLYGON[j];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const CONF_RANK = { low: 0, nominal: 1, high: 2 };

// Normalise la confiance : VIIRS l/n/h — MODIS 0–100.
function normalizeConfidence(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['l', 'low'].includes(s)) return 'low';
  if (['n', 'nominal'].includes(s)) return 'nominal';
  if (['h', 'high'].includes(s)) return 'high';
  const n = Number(s);
  if (Number.isFinite(n)) return n < 30 ? 'low' : n < 80 ? 'nominal' : 'high';
  return null; // valeur inattendue → ligne rejetée
}

// Parse une réponse CSV FIRMS (colonnes variables selon la source) en objets.
// Chaque champ est traité comme NON FIABLE : validation stricte avant insertion.
export function parseFirmsCsv(text, source) {
  const lines = String(text || '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iLat = col('latitude'), iLng = col('longitude');
  const iDate = col('acq_date'), iTime = col('acq_time');
  const iSat = col('satellite'), iInstr = col('instrument');
  const iConf = col('confidence'), iFrp = col('frp'), iDN = col('daynight');
  const iScan = col('scan'), iTrack = col('track');
  const iBright = header.findIndex((h) => h === 'brightness' || h === 'bright_ti4');
  if (iLat < 0 || iLng < 0 || iDate < 0 || iTime < 0) return [];

  const out = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = line.split(',').map((x) => x.trim());
    const lat = Number(f[iLat]), lng = Number(f[iLng]);
    const acqDate = f[iDate] || '', acqTime = String(f[iTime] || '').padStart(4, '0');
    const confidence = normalizeConfidence(iConf >= 0 ? f[iConf] : null);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) continue;
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(acqDate) || !/^\d{4}$/.test(acqTime)) continue;
    if (!confidence) continue;
    const acquiredAt = `${acqDate}T${acqTime.slice(0, 2)}:${acqTime.slice(2)}:00.000Z`;
    if (Number.isNaN(Date.parse(acquiredAt))) continue;
    out.push({
      source,
      satellite: (iSat >= 0 ? f[iSat] : '').slice(0, 20) || null,
      instrument: (iInstr >= 0 ? f[iInstr] : '').slice(0, 20) || null,
      lat, lng,
      scan: iScan >= 0 && Number.isFinite(Number(f[iScan])) ? Number(f[iScan]) : null,
      track: iTrack >= 0 && Number.isFinite(Number(f[iTrack])) ? Number(f[iTrack]) : null,
      acqDate, acqTime, acquiredAt, confidence,
      frp: iFrp >= 0 && Number.isFinite(Number(f[iFrp])) ? Number(f[iFrp]) : null,
      brightness: iBright >= 0 && Number.isFinite(Number(f[iBright])) ? Number(f[iBright]) : null,
      dayNight: iDN >= 0 ? String(f[iDN]).slice(0, 2) : null,
      raw: line.slice(0, 500),
    });
  }
  return out;
}

// Appel API par zone — la clé n'apparaît jamais dans les journaux d'erreur.
// Les sources NRT ne conservent que quelques jours d'historique : si la
// fenêtre demandée est refusée (HTTP 400), on retente avec une fenêtre plus
// courte (7 → 5 → 3 → 1) jusqu'à obtenir une réponse.
async function fetchSource(source, dayRange = 1) {
  const ranges = [...new Set([dayRange, 5, 3, 1].filter((d) => d <= dayRange && d >= 1))];
  let lastError = null;
  for (const range of ranges) {
    const url = `${config.firms.baseUrl}/api/area/csv/${config.firms.mapKey}/${source}/${TUNISIA_BBOX}/${range}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.FIRMS_TIMEOUT_MS) || 45_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      incrementTx();
      const text = await res.text();
      if (!res.ok || /invalid\s*map_key/i.test(text)) {
        lastError = new Error(`FIRMS ${source} : HTTP ${res.status}${/invalid\s*map_key/i.test(text) ? ' (clé invalide)' : ''}`);
        continue; // fenêtre plus courte
      }
      return parseFirmsCsv(text, source);
    } catch (e) {
      lastError = e;
    } finally { clearTimeout(timer); }
  }
  throw lastError || new Error(`FIRMS ${source} : aucune réponse`);
}

function incrementTx() {
  const n = Number(getSetting('firms_tx_count') || 0) + 1;
  setSetting('firms_tx_count', String(n));
}

function nearThermalSource(lat, lng) {
  const rows = db.prepare(`SELECT lat, lng, radius_m FROM thermal_sources WHERE is_active = 1`).all();
  return rows.some((s) => distanceKm(lat, lng, s.lat, s.lng) * 1000 <= s.radius_m);
}

// Rattache une détection à un événement existant (proximité + fenêtre
// temporelle) ou crée un nouvel événement. Met à jour centroïde et compteurs.
function attachToEvent(d) {
  const radiusKm = (getSettingNum('firms_cluster_radius_m') || 1000) / 1000;
  const windowMs = (getSettingNum('firms_cluster_window_h') || 6) * 3600_000;
  const candidates = db.prepare(
    `SELECT * FROM satellite_events WHERE status IN ('active','no_new_detection')
     AND ABS(centroid_lat - ?) < 0.03 AND ABS(centroid_lng - ?) < 0.035`
  ).all(d.lat, d.lng);
  let ev = candidates.find((e) =>
    distanceKm(d.lat, d.lng, e.centroid_lat, e.centroid_lng) <= radiusKm
    && Math.abs(Date.parse(d.acquiredAt) - Date.parse(e.last_detected_at)) <= windowMs);

  if (!ev) {
    const id = uuid();
    db.prepare(`INSERT INTO satellite_events
        (id, centroid_lat, centroid_lng, uncertainty_radius_m, first_detected_at, last_detected_at,
         max_confidence, max_frp, detection_count, satellite_count, satellites, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, '', ?)`)
      .run(id, d.lat, d.lng, Math.round((getSettingNum('firms_cluster_radius_m') || 1000) * 0.75),
        d.acquiredAt, d.acquiredAt, d.confidence, d.frp,
        nearThermalSource(d.lat, d.lng) ? 'false_positive' : 'active');
    ev = db.prepare(`SELECT * FROM satellite_events WHERE id = ?`).get(id);
  }

  // Centroïde = moyenne pondérée par le nombre de détections (position estimée,
  // jamais présentée comme le foyer exact).
  const n = ev.detection_count;
  const newLat = (ev.centroid_lat * n + d.lat) / (n + 1);
  const newLng = (ev.centroid_lng * n + d.lng) / (n + 1);
  const sats = new Set(ev.satellites ? ev.satellites.split(',') : []);
  if (d.satellite) sats.add(d.satellite);
  const maxConf = CONF_RANK[d.confidence] > CONF_RANK[ev.max_confidence] ? d.confidence : ev.max_confidence;
  const first = d.acquiredAt < ev.first_detected_at ? d.acquiredAt : ev.first_detected_at;
  const last = d.acquiredAt > ev.last_detected_at ? d.acquiredAt : ev.last_detected_at;

  db.prepare(`UPDATE satellite_events SET centroid_lat = ?, centroid_lng = ?,
      first_detected_at = ?, last_detected_at = ?, max_confidence = ?,
      max_frp = MAX(COALESCE(max_frp, 0), COALESCE(?, 0)),
      detection_count = detection_count + 1, satellite_count = ?, satellites = ?,
      status = CASE WHEN status = 'no_new_detection' THEN 'active' ELSE status END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .run(newLat, newLng, first, last, maxConf, d.frp, sats.size, [...sats].join(','), ev.id);
  return ev.id;
}

// Corrobore les signalements citoyens : détection nominal/high à proximité
// (distance + fenêtre temporelle configurables). N'ajoute JAMAIS d'incident.
function corroborateIncidents() {
  const maxKm = getSettingNum('firms_corroborate_km') || 2;
  const windowMs = (getSettingNum('firms_corroborate_window_h') || 12) * 3600_000;
  const events = db.prepare(
    `SELECT * FROM satellite_events WHERE status IN ('active','no_new_detection')
     AND max_confidence IN ('nominal','high') AND linked_incident_id IS NULL`
  ).all();
  const incidents = db.prepare(
    `SELECT id, public_id, lat, lng, started_at, COALESCE(published_at, created_at) AS published_at, trust_score
     FROM incidents WHERE type = 'fire' AND status = 'active'`
  ).all();
  let linked = 0;
  for (const ev of events) {
    const match = incidents.find((i) =>
      distanceKm(ev.centroid_lat, ev.centroid_lng, i.lat, i.lng) <= maxKm
      && (Math.abs(Date.parse(ev.last_detected_at) - Date.parse(i.started_at)) <= windowMs
          || Math.abs(Date.parse(ev.last_detected_at) - Date.parse(i.published_at)) <= windowMs));
    if (!match) continue;
    db.prepare(`UPDATE satellite_events SET linked_incident_id = ?, status = 'active',
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(match.id, ev.id);
    // Corroboration → score de confiance interne renforcé (jamais « confirmé officiellement »).
    db.prepare(`UPDATE incidents SET trust_score = MIN(100, trust_score + 15),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(match.id);
    audit('system', 'incident_satellite_corroborated', match.id, { event: ev.id });
    broadcast('incident', { publicId: match.public_id, satellite: true });
    linked++;
  }
  return linked;
}

// Cycle de vie : sans nouvelle détection → « aucune nouvelle détection »,
// puis archivage. L'historique est toujours conservé, rien n'est supprimé.
function updateLifecycles() {
  const staleH = getSettingNum('firms_event_stale_h') || 24;
  const archiveH = getSettingNum('firms_event_archive_h') || 72;
  db.prepare(`UPDATE satellite_events SET status = 'no_new_detection',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE status = 'active'
      AND last_detected_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-${staleH} hours')`).run();
  db.prepare(`UPDATE satellite_events SET status = 'archived',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE status = 'no_new_detection'
      AND last_detected_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-${archiveH} hours')`).run();
}

// Verrou anti-exécutions simultanées (une seule synchro à la fois).
let syncRunning = false;

export async function syncFirms({ force = false } = {}) {
  if (!config.firms.mapKey) return { skipped: 'no_key' };
  if (getSetting('nasa_firms_enabled') === '0') return { skipped: 'disabled' };
  if (syncRunning) return { skipped: 'already_running' };
  const intervalMs = (getSettingNum('firms_sync_interval_min') || 15) * 60_000;
  const last = getSetting('firms_last_sync_at');
  if (!force && last && Date.now() - Date.parse(last) < intervalMs) return { skipped: 'too_soon' };

  // Premier import réussi : rattrapage des 7 derniers jours (configurable) ;
  // ensuite, fenêtre glissante courte.
  const isBackfill = !getSetting('firms_backfill_done');
  const dayRange = isBackfill
    ? Math.min(10, getSettingNum('firms_backfill_days') || 7)
    : (getSettingNum('firms_day_range') || 1);

  syncRunning = true;
  setSetting('firms_last_sync_at', new Date().toISOString());
  const insert = db.prepare(`INSERT OR IGNORE INTO satellite_detections
      (id, provider, source, satellite, instrument, external_fingerprint, lat, lng, scan, track,
       acq_date, acq_time, acquired_at, confidence, frp, brightness, day_night, version, raw_payload)
      VALUES (?, 'NASA_FIRMS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let imported = 0, outOfTunisia = 0, duplicates = 0, errors = [];

  try {
    const sources = String(getSetting('firms_sources') || '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const source of sources) {
      let rows;
      try { rows = await fetchSource(source, dayRange); }
      catch (e) {
        // Les données valides déjà importées sont conservées ; nouvel essai au prochain cycle.
        errors.push(e.message.replace(config.firms.mapKey, '***'));
        continue;
      }
      for (const d of rows) {
        if (!inTunisia(d.lat, d.lng)) { outOfTunisia++; continue; }
        const fp = sha256(`${d.source}|${d.lat.toFixed(5)}|${d.lng.toFixed(5)}|${d.acqDate}|${d.acqTime}|${d.satellite || ''}`);
        const id = uuid();
        const res = insert.run(id, d.source, d.satellite, d.instrument, fp, d.lat, d.lng,
          d.scan, d.track, d.acqDate, d.acqTime, d.acquiredAt, d.confidence, d.frp,
          d.brightness, d.dayNight, d.version, d.raw);
        if (res.changes === 0) { duplicates++; continue; } // empreinte déjà importée
        const eventId = attachToEvent(d);
        db.prepare(`UPDATE satellite_detections SET satellite_event_id = ? WHERE id = ?`).run(eventId, id);
        imported++;
      }
    }
    const linked = corroborateIncidents();
    updateLifecycles();
    if (errors.length < (String(getSetting('firms_sources') || '').split(',').filter(Boolean).length || 1)) {
      setSetting('firms_last_success_at', new Date().toISOString());
      // Rattrapage initial de 7 jours effectué : fenêtre courte désormais.
      if (isBackfill) setSetting('firms_backfill_done', new Date().toISOString());
    }
    setSetting('firms_last_error', errors.join(' ; ') || '');
    if (imported > 0 || linked > 0) broadcast('incident', { satellite: true });
    return { imported, duplicates, outOfTunisia, linked, errors };
  } finally {
    syncRunning = false;
  }
}

// Confiance minimale de publication (réglable) → clause SQL.
export function publicConfidenceList() {
  return getSetting('firms_min_public_confidence') === 'high' ? ['high'] : ['nominal', 'high'];
}
