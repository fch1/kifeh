// Copernicus EFFIS — zones brûlées récentes (Europe, ici filtrées France).
// Source : API REST publique de l'European Forest Fire Information System
// (api.effis.emergency.copernicus.eu, AUCUNE clé requise — accès vérifié).
//
// Principes non négociables :
//   1. panne INDÉPENDANTE : EFFIS hors service = couche absente, jamais d'erreur globale ;
//   2. un contour EFFIS est une ESTIMATION satellite du périmètre déjà brûlé —
//      jamais un périmètre officiel, jamais une prévision, jamais une consigne ;
//   3. attribution systématique « Copernicus EFFIS » avec horodatage ;
//   4. charges utiles compactes : polygones simplifiés côté serveur, le
//      frontend n'interroge que Kifeh (jamais EFFIS directement).
//
// Stockage : cache mémoire + fichier JSON à côté de la base (AUCUNE migration,
// aucune écriture dans la base de production — zéro risque pour les données).
import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting, setSetting, getSettingNum } from '../db.js';
import { uuid } from './crypto.js';
import { broadcast } from '../routes/events.js';
import { config } from '../config.js';

const BASE = () => process.env.EFFIS_URL || 'https://api.effis.emergency.copernicus.eu';

// Fenêtre glissante : zones dont le feu a démarré dans les N derniers jours.
const windowDays = () => {
  const n = Number(process.env.EFFIS_WINDOW_DAYS || getSetting('effis_window_days'));
  return Number.isFinite(n) && n >= 1 && n <= 365 ? n : 45;
};

// Cadence de synchronisation (les zones brûlées évoluent ~1×/jour côté EFFIS).
const intervalMin = () => {
  const n = getSettingNum('effis_sync_interval_min');
  return Number.isFinite(n) && n >= 5 ? n : 360; // 6 h par défaut
};

const cacheFile = () => path.join(path.dirname(config.dbPath), 'effis-cache.json');

// Cache mémoire (rechargé du disque au premier accès après démarrage).
let mem = null; // { updatedAt, areas: [...] }

function loadFromDisk() {
  if (mem) return mem;
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    if (raw && Array.isArray(raw.areas)) mem = raw;
  } catch { /* pas encore de cache — état normal au premier démarrage */ }
  return mem;
}

// ── Simplification des contours ──────────────────────────────────────────────
// Les MultiPolygones EFFIS peuvent dépasser 12 000 points ; l'app n'a besoin
// que d'un contour LISIBLE (il est présenté comme approximatif). On garde les
// 3 anneaux extérieurs les plus grands, décimés à ≤ 40 points, 4 décimales.
const MAX_RINGS = 3, MAX_POINTS = 40;

function simplifyRing(ring) {
  // ring GeoJSON = [[lng, lat], …] (dernier point = premier) → [[lat, lng], …]
  const pts = ring.length > 1
    && ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) : ring;
  const step = Math.max(1, Math.ceil(pts.length / MAX_POINTS));
  const out = [];
  for (let i = 0; i < pts.length; i += step) {
    out.push([+pts[i][1].toFixed(4), +pts[i][0].toFixed(4)]);
  }
  return out.length >= 3 ? out : null;
}

function simplifyShape(shape) {
  if (!shape || shape.type !== 'MultiPolygon' || !Array.isArray(shape.coordinates)) return [];
  const outers = shape.coordinates
    .map((poly) => poly?.[0])            // anneau extérieur uniquement (trous ignorés)
    .filter((r) => Array.isArray(r) && r.length >= 4)
    .sort((a, b) => b.length - a.length) // les plus détaillés = les plus grands
    .slice(0, MAX_RINGS);
  return outers.map(simplifyRing).filter(Boolean);
}

function compactArea(r) {
  const rings = simplifyShape(r.shape);
  if (!rings.length) return null;
  const [w, s, e, n] = Array.isArray(r.bbox) && r.bbox.length === 4 ? r.bbox : [null, null, null, null];
  const c = r.centroid?.coordinates;
  return {
    id: r.id,
    commune: typeof r.commune === 'string' ? r.commune.slice(0, 80) : null,
    province: typeof r.province === 'string' ? r.province.slice(0, 80) : null,
    areaHa: Number.isFinite(+r.area_ha) ? Math.round(+r.area_ha) : null,
    firedate: r.firedate || null,
    updatedAt: r.lastupdate || null,
    centroid: Array.isArray(c) ? [+(+c[1]).toFixed(4), +(+c[0]).toFixed(4)] : null, // [lat, lng]
    bbox: w != null ? [+(+s).toFixed(4), +(+w).toFixed(4), +(+n).toFixed(4), +(+e).toFixed(4)] : null, // [S,O,N,E]
    rings, // [[[lat,lng],…],…] — contour APPROXIMATIF
  };
}

// ── Synchronisation périodique ───────────────────────────────────────────────
let syncRunning = false;

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.EFFIS_TIMEOUT_MS) || 45_000);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new Error(`EFFIS HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

export async function syncEffis({ force = false } = {}) {
  if (getSetting('effis_enabled') === '0') return { skipped: 'disabled' };
  // En développement/tests : ne JAMAIS appeler le vrai EFFIS — uniquement un
  // serveur simulé désigné par EFFIS_URL (les suites démarrent l'app souvent).
  if (config.isDev && !process.env.EFFIS_URL) return { skipped: 'dev_sans_mock' };
  if (syncRunning) return { skipped: 'running' };
  const last = getSetting('effis_last_sync_at');
  if (!force && last && Date.now() - Date.parse(last) < intervalMin() * 60_000) {
    return { skipped: 'recent' };
  }
  syncRunning = true;
  setSetting('effis_last_sync_at', new Date().toISOString());
  try {
    const since = new Date(Date.now() - windowDays() * 24 * 3600_000)
      .toISOString().slice(0, 10) + 'T00:00:00';
    let url = `${BASE()}/rest/2/burntareas/current/?country=FR`
      + `&firedate__gte=${encodeURIComponent(since)}&ordering=-firedate&limit=100`;
    const areas = [];
    // Garde-fou : 8 pages max (800 zones) — bien au-delà d'une saison réelle.
    for (let page = 0; url && page < 8; page++) {
      const data = await fetchPage(url);
      for (const r of data?.results || []) {
        const a = compactArea(r);
        if (a) areas.push(a);
      }
      // L'API renvoie parfois des liens « next » en http:// — on ne garde que
      // chemin + paramètres et on reste sur l'origine configurée (réel ou simulé).
      url = data?.next ? BASE() + String(data.next).replace(/^https?:\/\/[^/]+/, '') : null;
    }
    mem = { updatedAt: new Date().toISOString(), areas };
    // Écriture atomique (tmp puis renommage) — jamais de cache corrompu.
    const tmp = `${cacheFile()}.tmp`;
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(mem));
    fs.renameSync(tmp, cacheFile());
    setSetting('effis_last_success_at', mem.updatedAt);
    setSetting('effis_last_error', '');
    // Historisation (Lot 1) : CHAQUE version publiée d'un périmètre est
    // conservée (jamais écrasée) — le replay ne montrera que ce qui était
    // réellement connu à l'instant choisi. area_ha vient TOUJOURS d'EFFIS,
    // jamais d'un calcul sur la géométrie simplifiée.
    try { recordBurnedAreaVersions(areas); } catch (e) {
      console.error('[effis] versionnement :', String(e?.message || '').slice(0, 80));
    }
    // Événement typé pour les clients temps réel (reprise via Last-Event-ID).
    broadcast('burned-area.batch', {
      country: 'FR', count: areas.length, receivedAt: mem.updatedAt,
    });
    return { synced: areas.length };
  } catch (e) {
    // Message d'état SANS détail sensible ; l'ancien cache reste servi tel quel.
    setSetting('effis_last_error', String(e?.message || 'erreur').slice(0, 200));
    // Panne passagère : nouvel essai ~15 min plus tard (pas dans 6 h).
    setSetting('effis_last_sync_at',
      new Date(Date.now() - Math.max(0, intervalMin() - 15) * 60_000).toISOString());
    throw e;
  } finally { syncRunning = false; }
}

// Enregistre les versions inédites (clé : feature + published_at) et maintient
// is_latest — une seule version « courante » par périmètre.
function recordBurnedAreaVersions(areas) {
  const batchId = uuid();
  const now = new Date().toISOString();
  const ins = db.prepare(`INSERT OR IGNORE INTO burned_area_versions
      (id, effis_feature_id, geometry_display, area_ha_source, commune, province,
       fire_date, published_at, received_at, source_batch_id, is_latest)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
  const demote = db.prepare(`UPDATE burned_area_versions SET is_latest = 0
      WHERE effis_feature_id = ? AND published_at < ?`);
  db.transaction(() => {
    for (const a of areas) {
      const published = a.updatedAt || a.firedate || now;
      const r = ins.run(uuid(), a.id, JSON.stringify(a.rings), a.areaHa,
        a.commune, a.province, a.firedate, published, now, batchId);
      if (r.changes > 0) demote.run(a.id, published);
    }
  })();
}

// ── Lecture pour l'API publique ──────────────────────────────────────────────
function bboxIntersects(a, b) {
  // a = [S,O,N,E] de la zone ; b = bbox demandée { minLat, minLng, maxLat, maxLng }
  if (!a) return false;
  return a[0] <= b.maxLat && a[2] >= b.minLat && a[1] <= b.maxLng && a[3] >= b.minLng;
}

export function burntAreasInBbox(bbox, { limit = 60 } = {}) {
  const cache = loadFromDisk();
  if (!cache) return { updatedAt: null, areas: [] };
  const areas = cache.areas
    .filter((a) => bboxIntersects(a.bbox, bbox))
    .sort((x, y) => Date.parse(y.firedate || 0) - Date.parse(x.firedate || 0))
    .slice(0, limit);
  return { updatedAt: cache.updatedAt, areas };
}

// État pour /healthz — de simples indicateurs, jamais de contenu.
export function effisStatus() {
  const cache = loadFromDisk();
  const lastSuccess = getSetting('effis_last_success_at') || null;
  return {
    lastSync: getSetting('effis_last_sync_at') || null,
    lastSuccess,
    count: cache?.areas?.length ?? 0,
    // Vraie panne = erreur présente ET aucune synchro réussie depuis 24 h.
    hasError: Boolean(getSetting('effis_last_error'))
      && (!lastSuccess || Date.now() - Date.parse(lastSuccess) > 24 * 3600_000),
  };
}
