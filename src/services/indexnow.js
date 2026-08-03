// IndexNow (#lead-gen) — indexation INSTANTANÉE Bing/Yandex/Seznam, sans
// console ni compte : un fichier-clé servi à la racine + un ping quotidien
// avec la liste des URLs publiques (les mêmes registres que le sitemap).
// Google ignore IndexNow — pour Google, c'est Search Console (action Farah,
// réduite à coller un nom de fichier grâce à la route de vérification).
// Garde-fous : jamais en sandbox/développement, jamais depuis un serveur de
// test (hôte kifeh.app uniquement), 1 ping par 24 h, échec silencieux borné.
import { getSetting, setSetting } from '../db.js';
import { getBaseUrl } from '../config.js';
import crypto from 'node:crypto';

const ENDPOINT = () => process.env.INDEXNOW_URL || 'https://api.indexnow.org/indexnow';
const HOST = 'kifeh.app';
const BASE = `https://${HOST}`;

// La clé est générée UNE fois puis stable (le fichier-clé doit rester servi).
export function indexNowKey() {
  let k = getSetting('indexnow_key');
  if (!/^[a-f0-9]{32}$/.test(k || '')) {
    k = crypto.randomBytes(16).toString('hex');
    setSetting('indexnow_key', k);
  }
  return k;
}

// Appelé par le scheduler (tick 60 s) : au plus un ping par 24 h.
export async function syncIndexNow({ listUrls, force = false } = {}) {
  if (getSetting('indexnow_enabled') === '0') return { skipped: 'disabled' };
  // getBaseUrl() : BASE_URL env OU l'URL détectée des requêtes entrantes —
  // Render ne définit pas forcément BASE_URL (leçon du 1er ping jamais parti).
  const baseUrl = getBaseUrl() || '';
  if (!force && !baseUrl.includes(HOST)) return { skipped: 'not_prod' }; // jamais depuis un serveur de test
  const last = Date.parse(getSetting('indexnow_last_ping_at') || 0) || 0;
  if (!force && Date.now() - last < 24 * 3600_000) return { skipped: 'recent' };
  const urls = (listUrls?.() || []).map((p) => (p.startsWith('http') ? p : BASE + p));
  if (!urls.length) return { skipped: 'empty' };
  const key = indexNowKey();
  const r = await fetch(ENDPOINT(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST, key, keyLocation: `${BASE}/${key}.txt`, urlList: urls.slice(0, 500),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  // 200/202 = accepté. On horodate même un refus permanent (4xx) pour ne pas
  // marteler l'API — le prochain essai attendra son tour quotidien.
  setSetting('indexnow_last_ping_at', new Date().toISOString());
  setSetting('indexnow_last_status', String(r.status));
  return { status: r.status, urls: urls.length };
}

export function indexNowStatus() {
  return {
    lastPing: getSetting('indexnow_last_ping_at') || null,
    lastStatus: getSetting('indexnow_last_status') || null,
  };
}
