// Routes barrées & entraves — Bison Futé (données ouvertes DATEX II, DIR).
// Source : tipi.bison-fute.gouv.fr /bison-fute-ouvert (AUCUNE clé requise).
// Chaque situation est un petit fichier XML DATEX II ; l'index du dossier EST
// l'état courant (un fichier disparu = situation terminée).
//
// Principes :
//   1. panne INDÉPENDANTE (couche absente, jamais d'erreur globale) ;
//   2. on ne retient que ce qui ENTRAVE la route (fermetures, travaux,
//      accidents, obstacles) — jamais les simples bouchons ;
//   3. attribution « Bison Futé — DIR » + horodatage sur chaque donnée ;
//   4. cache serveur (mémoire + disque) : le frontend n'appelle jamais Tipi.
import fs from 'node:fs';
import path from 'node:path';
import { getSetting, setSetting, getSettingNum } from '../db.js';
import { config } from '../config.js';

const BASE = () => process.env.ROADS_URL
  || 'https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/Evenementiel-DIR/grt/RRN';

const intervalMin = () => {
  const n = getSettingNum('roads_sync_interval_min');
  return Number.isFinite(n) && n >= 5 ? n : 30;
};

// Types DATEX retenus (entraves réelles) — les bouchons (AbnormalTraffic) et
// limitations de vitesse ne sont PAS des « routes barrées ».
const KEPT_TYPES = new Set([
  'RoadOrCarriagewayOrLaneManagement', 'ReroutingManagement',
  'MaintenanceWorks', 'ConstructionWorks', 'Accident',
  'VehicleObstruction', 'GeneralObstruction', 'EnvironmentalObstruction',
]);

const cacheFile = () => path.join(path.dirname(config.dbPath), 'roads-cache.json');
let mem = null;                 // { updatedAt, events: [...] }
const fileCache = new Map();    // id -> événement analysé (ou null si écarté)

function loadFromDisk() {
  if (mem) return mem;
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    if (raw && Array.isArray(raw.events)) mem = raw;
  } catch { /* premier démarrage : pas encore de cache */ }
  return mem;
}

async function fetchText(url, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`roads HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(timer); }
}

// Extraction par expressions régulières — les fichiers Tipi sont petits et
// réguliers ; aucun analyseur XML embarqué nécessaire.
function parseSituation(id, xml) {
  const types = [...xml.matchAll(/xsi:type="([A-Za-z]+)"/g)].map((m) => m[1]);
  const kept = types.find((tp) => KEPT_TYPES.has(tp));
  if (!kept) return null;
  const num = (re) => { const m = xml.match(re); return m ? Number(m[1]) : null; };
  const str = (re) => { const m = xml.match(re); return m ? m[1] : null; };
  const lat = num(/<latitude>([-\d.]+)<\/latitude>/);
  const lng = num(/<longitude>([-\d.]+)<\/longitude>/);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id,
    lat: +lat.toFixed(5), lng: +lng.toFixed(5),
    type: kept,
    closed: /roadClosed|carriagewayClosures>\s*closed/i.test(xml),
    road: (str(/<roadNumber>([^<]+)<\/roadNumber>/) || '').slice(0, 16) || null,
    start: str(/<overallStartTime>([^<]+)<\/overallStartTime>/),
    end: str(/<overallEndTime>([^<]+)<\/overallEndTime>/),
  };
}

let syncRunning = false;

export async function syncRoads({ force = false } = {}) {
  if (getSetting('roads_enabled') === '0') return { skipped: 'disabled' };
  // Jamais le vrai Tipi en développement/tests sans serveur simulé (ROADS_URL).
  if (config.isDev && !process.env.ROADS_URL) return { skipped: 'dev_sans_mock' };
  if (syncRunning) return { skipped: 'running' };
  const last = getSetting('roads_last_sync_at');
  if (!force && last && Date.now() - Date.parse(last) < intervalMin() * 60_000) {
    return { skipped: 'recent' };
  }
  syncRunning = true;
  setSetting('roads_last_sync_at', new Date().toISOString());
  try {
    const index = await fetchText(`${BASE()}/`, 20_000);
    // Les identifiants croissent : on garde les 800 plus récents (l'index
    // complet ~2 500 inclut de vieilles situations de longue durée).
    const ids = [...index.matchAll(/href="(\d+)\.xml"/g)].map((m) => m[1])
      .sort((a, b) => Number(b) - Number(a)).slice(0, 800);
    const idSet = new Set(ids);
    // Purge des situations disparues de l'index (terminées côté source).
    for (const k of fileCache.keys()) if (!idSet.has(k)) fileCache.delete(k);
    const missing = ids.filter((id) => !fileCache.has(id));
    // Lots de 24 requêtes — l'essentiel des synchronisations ne télécharge
    // que les NOUVEAUX fichiers (le cache mémoire fait le reste).
    for (let k = 0; k < missing.length; k += 24) {
      await Promise.all(missing.slice(k, k + 24).map(async (id) => {
        try {
          fileCache.set(id, parseSituation(id, await fetchText(`${BASE()}/${id}.xml`)));
        } catch { /* fichier illisible : re-tenté à la prochaine synchro */ }
      }));
    }
    const events = ids.map((id) => fileCache.get(id)).filter(Boolean);
    mem = { updatedAt: new Date().toISOString(), events };
    const tmp = `${cacheFile()}.tmp`;
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(mem));
    fs.renameSync(tmp, cacheFile());
    setSetting('roads_last_success_at', mem.updatedAt);
    setSetting('roads_last_error', '');
    return { synced: events.length, fetched: missing.length };
  } catch (e) {
    setSetting('roads_last_error', String(e?.message || 'erreur').slice(0, 200));
    // Panne passagère : nouvel essai ~10 min plus tard.
    setSetting('roads_last_sync_at',
      new Date(Date.now() - Math.max(0, intervalMin() - 10) * 60_000).toISOString());
    throw e;
  } finally { syncRunning = false; }
}

export function roadEventsInBbox(bbox, { limit = 80 } = {}) {
  const cache = loadFromDisk();
  if (!cache) return { updatedAt: null, events: [] };
  const events = cache.events
    .filter((e) => e.lat >= bbox.minLat && e.lat <= bbox.maxLat
      && e.lng >= bbox.minLng && e.lng <= bbox.maxLng)
    .sort((x, y) => Date.parse(y.start || 0) - Date.parse(x.start || 0))
    .slice(0, limit);
  return { updatedAt: cache.updatedAt, events };
}

export function roadsStatus() {
  const cache = loadFromDisk();
  const lastSuccess = getSetting('roads_last_success_at') || null;
  return {
    lastSync: getSetting('roads_last_sync_at') || null,
    lastSuccess,
    count: cache?.events?.length ?? 0,
    hasError: Boolean(getSetting('roads_last_error'))
      && (!lastSuccess || Date.now() - Date.parse(lastSuccess) > 6 * 3600_000),
  };
}
