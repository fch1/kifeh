// Tests NASA FIRMS + fin d'incident — avec un serveur FIRMS
// SIMULÉ (aucun appel réel à la NASA, aucune clé réelle nécessaire).
// Usage : node tests/firms-check.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const PORT = 3995, FIRMS_PORT = 3990;
const BASE = `http://localhost:${PORT}`;
const DB = 'data/firms-test.db';
const KEY = 'test-map-key-123456';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
}
function section(t) { console.log(`\n■ ${t}`); }

async function api(method, url, body, headers = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

// ── Serveur FIRMS simulé ────────────────────────────────────────────────────
const VIIRS_HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';
const MODIS_HEADER = 'latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight';
const today = new Date().toISOString().slice(0, 10);
const hh = String(new Date().getUTCHours()).padStart(2, '0');

const state = { requests: [], mode: 'ok' };
const firmsSrv = http.createServer((req, res) => {
  state.requests.push(req.url.replace(KEY, '[KEY]'));
  if (!req.url.includes(KEY)) { res.writeHead(401); return res.end('Invalid MAP_KEY.'); }
  if (state.mode === 'down') { res.writeHead(500); return res.end('oops'); }
  if (state.mode === 'invalid_key') { res.writeHead(200); return res.end('Invalid MAP_KEY.'); }
  if (state.mode === 'hang') { return; /* ne répond jamais → timeout */ }
  if (req.url.includes('/EMPTY_SRC/')) { res.writeHead(200); return res.end(`${VIIRS_HEADER}\n`); }
  if (req.url.includes('/BROKEN_SRC/')) { res.writeHead(500); return res.end('erreur source'); }
  if (req.url.includes('/MODIS_NRT/')) {
    res.writeHead(200, { 'Content-Type': 'text/csv' });
    return res.end(`${MODIS_HEADER}\n34.4200,8.7800,320.5,1.1,1.0,${today},${hh}15,Terra,MODIS,85,6.1,295.2,12.3,D\n`);
  }
  // VIIRS : 2 points proches à Tunis (nominal+high), 1 faible confiance,
  // 1 point en Algérie (exclu), 1 en mer (exclu), 1 ligne malformée (rejetée).
  res.writeHead(200, { 'Content-Type': 'text/csv' });
  res.end(`${VIIRS_HEADER}
36.8000,10.1800,330.1,0.5,0.4,${today},${hh}00,N,VIIRS,n,2.0NRT,290.1,8.5,D
36.8060,10.1870,335.2,0.5,0.4,${today},${hh}06,N20,VIIRS,h,2.0NRT,291.0,15.2,D
35.5000,9.5000,310.0,0.5,0.4,${today},${hh}00,N,VIIRS,l,2.0NRT,285.0,2.1,N
36.7000,3.0500,332.0,0.5,0.4,${today},${hh}00,N,VIIRS,h,2.0NRT,290.0,9.9,D
37.2000,11.4500,331.0,0.5,0.4,${today},${hh}00,N,VIIRS,n,2.0NRT,289.0,7.7,D
pas-une-latitude,10.2,x,x,x,${today},abc,N,VIIRS,n,2.0NRT,x,x,D
`);
});
await new Promise((r) => firmsSrv.listen(FIRMS_PORT, r));

// ── Serveur applicatif ──────────────────────────────────────────────────────
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const server = spawn('node', ['server.js'], {
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
    BASE_URL: BASE, ADMIN_PASSWORD: 'test-admin-password-1', ADMIN_USERNAME: 'admin',
    SANDBOX_ENABLED: '0', VERIFICATION_REQUIRED: '0', MIN_FORM_FILL_S: '2',
    TRUST_PUBLISH_THRESHOLD: '10', MAX_DECLARATIONS_PER_IP_PER_H: '100',
    NASA_FIRMS_MAP_KEY: KEY, FIRMS_URL: `http://127.0.0.1:${FIRMS_PORT}`,
    FIRMS_SOURCES: 'VIIRS_SNPP_NRT,MODIS_NRT,BROKEN_SRC',
    FIRMS_TIMEOUT_MS: '1500',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
server.stdout.on('data', () => {});
process.on('exit', () => { try { server.kill(); firmsSrv.close(); } catch {} });
for (let __i = 0; __i < 60; __i++) {
  try { await fetch(`${BASE}/healthz`); break; }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}

const device = (n) => `firms-device-${String(n).padStart(6, '0')}xx`;
const draftBody = (over = {}) => ({
  type: 'fire', lat: 36.8100, lng: 10.1900, locationSource: 'manual',
  temporalStatus: 'ongoing', startedAt: new Date(Date.now() - 40 * 60000).toISOString(),
  timeApproximate: false, description: `Feu test ${Math.random().toString(36).slice(2, 8)}`,
  severity: 'high', fillSeconds: 25, idempotencyKey: `k-${Math.random()}`, ...over,
});
async function publish(over = {}) {
  const d = await api('POST', '/api/declare/draft', draftBody(over));
  const p = await api('POST', '/api/declare/publish-unverified', {
    incidentId: d.data.incidentId, draftToken: d.data.draftToken,
  });
  return { ...p.data };
}

async function main() {
  // Connexion admin (déclenchement manuel des synchronisations).
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-password-1' }),
  });
  const loginData = await login.json();
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  const adminHdr = { Cookie: cookie, 'X-CSRF': loginData.csrf };
  const adminPost = (url, body) => fetch(`${BASE}${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...adminHdr },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
  const adminGet = (url) => fetch(`${BASE}${url}`, { headers: adminHdr }).then((r) => r.json());

  // ── Corroboration : incident citoyen publié AVANT l'import ───────────────
  const fireInc = await publish();

  section('Import FIRMS (rattrapage initial de 7 jours)');
  // La première synchro a pu être déclenchée automatiquement au démarrage
  // (et peut durer quelques secondes avec les reprises 5xx) : on attend
  // qu'une synchro forcée soit acceptée.
  let s1;
  for (let i = 0; i < 25; i++) {
    s1 = await adminPost('/api/admin/firms/sync');
    if (!s1.data.result?.skipped) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  ok(s1.status === 200 && s1.data.result.imported + s1.data.result.duplicates === 4,
    `4 détections valides traitées (VIIRS n/h/l + MODIS) — importées : ${s1.data.result.imported}, doublons : ${s1.data.result.duplicates}`);
  ok(s1.data.result.outOfTunisia === 2, 'points en Algérie et en mer exclus (polygone Tunisie)');
  ok(s1.data.result.errors.length === 1 && !s1.data.result.errors[0].includes(KEY),
    'source en panne tolérée, erreur journalisée SANS la clé');
  ok(state.requests.some((u) => u.endsWith('/7')), 'premier import : 7 jours d’historique demandés');
  const st1 = await adminGet('/api/admin/firms/status');
  ok(st1.detections === 4 && st1.lastSuccessAt, 'statut admin : 4 détections, dernière synchro réussie');
  ok(st1.txCount >= 3, `compteur de transactions API suivi (${st1.txCount})`);

  section('Anti-réimport (empreinte unique)');
  const s2 = await adminPost('/api/admin/firms/sync');
  ok(s2.data.result.imported === 0 && s2.data.result.duplicates === 4,
    'deuxième synchro : 0 nouvel enregistrement, 4 doublons ignorés');
  ok(state.requests.some((u) => u.endsWith('/1')), 'synchros suivantes : fenêtre courte (1 jour)');
  const st2 = await adminGet('/api/admin/firms/status');
  ok(st2.detections === 4, 'aucune détection réimportée en double');

  section('Regroupement en événements');
  const evAdmin = await adminGet('/api/admin/firms/events');
  const activeEvents = evAdmin.events.filter((e) => e.status !== 'false_positive');
  const tunisEvent = activeEvents.find((e) => Math.abs(e.centroid_lat - 36.8) < 0.05);
  ok(tunisEvent && tunisEvent.detection_count === 2 && tunisEvent.satellite_count === 2,
    'deux détections proches (satellites différents) regroupées en UN événement');
  ok(tunisEvent.max_confidence === 'high', 'confiance maximale de l’événement : high');
  const lowEvent = activeEvents.find((e) => Math.abs(e.centroid_lat - 35.5) < 0.05);
  ok(lowEvent && lowEvent.max_confidence === 'low', 'détection faible confiance conservée en base');

  section('Corroboration citoyen ↔ satellite');
  ok(tunisEvent.linked_incident_id, 'événement de Tunis associé à l’incident citoyen existant');
  const incList = await api('GET', '/api/public/incidents?status=active');
  const fires = incList.data.incidents.filter((x) => x.type === 'fire');
  ok(fires.length === 1 && fires[0].public_id === fireInc.publicId,
    'toujours UN seul incident incendie — aucun doublon créé par la NASA');
  ok(fires[0].satellite_last_seen, 'badge « corroboré par satellite » exposé sur l’incident');

  section('Couche satellite publique');
  const pub = await api('GET', '/api/public/satellite/events');
  ok(pub.data.events.every((e) => !e.id.includes(KEY)) && JSON.stringify(pub.data).includes(KEY) === false,
    'la clé API n’apparaît jamais dans les réponses publiques');
  const publicIds = pub.data.events.map((e) => e.id);
  ok(!publicIds.includes(lowEvent.id), 'détection « low » non publiée sur la carte (visible en modération)');
  ok(!publicIds.includes(tunisEvent.id), 'événement corroboré non affiché en double (marqueur citoyen unique)');
  ok(pub.data.lastSyncAt, 'heure de dernière synchro réussie exposée');
  const modisEvent = pub.data.events.find((e) => Math.abs(e.lat - 34.42) < 0.05);
  ok(Boolean(modisEvent), 'événement MODIS indépendant (« incendie potentiel ») visible');
  const highOnly = await api('GET', '/api/public/satellite/events?confidence=high');
  ok(!highOnly.data.events.some((e) => e.max_confidence === 'nominal'),
    'filtre de confiance « élevée uniquement » respecté');

  section('Confirmations citoyennes sur un événement satellite');
  const fb1 = await api('POST', `/api/public/satellite/events/${modisEvent.id}/feedback`,
    { kind: 'confirm', deviceId: device(1) });
  ok(fb1.status === 200 && fb1.data.confirmations === 1, 'première confirmation comptée');
  const fb1b = await api('POST', `/api/public/satellite/events/${modisEvent.id}/feedback`,
    { kind: 'confirm', deviceId: device(1) });
  ok(fb1b.status === 400 && fb1b.data.alreadyConfirmed, 'double confirmation refusée');
  const fb2 = await api('POST', `/api/public/satellite/events/${modisEvent.id}/feedback`,
    { kind: 'not_fire', deviceId: device(2) });
  ok(fb2.status === 200, '« ce point ne semble pas correspondre à un incendie » enregistré');

  section('Pannes FIRMS (tolérance)');
  state.mode = 'down';
  const sDown = await adminPost('/api/admin/firms/sync');
  ok(sDown.status === 200 && sDown.data.result.imported === 0, 'API en panne : aucune erreur bloquante');
  const stillThere = await adminGet('/api/admin/firms/status');
  ok(stillThere.detections === 4, 'données déjà importées conservées pendant la panne');
  state.mode = 'invalid_key';
  const sBad = await adminPost('/api/admin/firms/sync');
  ok(sBad.data.result.errors.every((e) => !e.includes(KEY)), 'clé invalide : erreur enregistrée sans révéler la clé');
  state.mode = 'hang';
  const t0 = Date.now();
  const sHang = await adminPost('/api/admin/firms/sync');
  ok(sHang.status === 200 && Date.now() - t0 < 15000, 'timeout géré (pas de blocage de Kifeh)');
  state.mode = 'ok';
  const appStill = await api('GET', '/api/public/incidents');
  ok(appStill.status === 200, 'Kifeh reste opérationnel pendant les pannes FIRMS');

  section('Fin d’incident — validations serveur');
  const endInc = await publish({ type: 'electricity', lat: 35.1, lng: 9.4 });
  const before = await api('POST', `/api/public/incidents/${endInc.publicId}/resolution`,
    { deviceId: device(10), proposedEndedAt: new Date(Date.now() - 2 * 3600_000).toISOString() });
  ok(before.status === 400, 'fin antérieure au début refusée avec message traduit');
  const future = await api('POST', `/api/public/incidents/${endInc.publicId}/resolution`,
    { deviceId: device(10), proposedEndedAt: new Date(Date.now() + 3600_000).toISOString() });
  ok(future.status === 400, 'fin dans le futur refusée');
  const nowR = await api('POST', `/api/public/incidents/${endInc.publicId}/resolution`,
    { deviceId: device(10), isNow: true });
  ok(nowR.status === 200 && nowR.data.resolved === true,
    '« Terminé maintenant » : résolution appliquée immédiatement (mode immediate)');
  const resolvedView = await api('GET', `/api/public/incidents/${endInc.publicId}`);
  ok(resolvedView.data.status === 'resolved' && resolvedView.data.ended_at, 'statut Résolu + heure de fin immédiats');

  section('Réouverture communautaire + « C’est toujours en cours »');
  const ro = await api('POST', `/api/public/incidents/${endInc.publicId}/reopen`, { deviceId: device(13) });
  ok(ro.status === 200, 'réouverture d’une clôture erronée acceptée');
  const roDup = await api('POST', `/api/public/incidents/${endInc.publicId}/reopen`, { deviceId: device(13) });
  ok(roDup.status === 404 || roDup.status === 400, 'réouverture en double refusée');
  const reopened = await api('GET', `/api/public/incidents/${endInc.publicId}`);
  ok(reopened.data.status === 'active' && !reopened.data.ended_at, 'incident de nouveau actif, fin effacée');
  const sa = await api('POST', `/api/public/incidents/${endInc.publicId}/still-active`, { deviceId: device(14) });
  ok(sa.status === 200 && sa.data.stillActiveAt, '« C’est toujours en cours » : fraîcheur actualisée');
  const saDup = await api('POST', `/api/public/incidents/${endInc.publicId}/still-active`, { deviceId: device(14) });
  ok(saDup.status === 400 && saDup.data.alreadyReported, 'actualisation en double (même personne) refusée');
  const saView = await api('GET', `/api/public/incidents/${endInc.publicId}`);
  ok(Boolean(saView.data.still_active_at), 'still_active_at exposé publiquement');
  const cfgTiles = await api('GET', '/api/public/config');
  ok(cfgTiles.data.tileProviders?.length === 2 && cfgTiles.data.tileProviders[0].url.includes('{z}'),
    'fournisseurs de tuiles configurés côté serveur (principal + secours)');
  // clôture directe par le déclarant (lien de gestion) + métadonnées
  const own = await publish({ type: 'water', lat: 36.4, lng: 10.6 });
  const token = new URL(own.manageUrl).searchParams.get('token');
  const closed = await api('POST', '/api/manage/close', { token, endedAt: new Date().toISOString() });
  ok(closed.status === 200, 'clôture directe par le déclarant');
  const closedView = await api('GET', `/api/public/incidents/${own.publicId}`);
  ok(closedView.data.status === 'resolved' && closedView.data.ended_at, 'statut Résolu + heure de fin visibles');

  section('Confidentialité de la clé');
  for (const f of ['js/home.js', 'js/api.js', 'js/declare.js', 'js/i18n.js']) {
    const src = await fetch(`${BASE}/${f}`).then((r) => r.text());
    if (src.includes(KEY) || /NASA_FIRMS_MAP_KEY/.test(src)) { ok(false, `clé absente de ${f}`); }
  }
  ok(true, 'aucun fichier frontend ne contient la clé ni son nom de variable');

  console.log('\n────────────────────────────');
  console.log(`${passed} réussis · ${failed} échoués`);
  server.kill(); firmsSrv.close();
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); server.kill(); firmsSrv.close(); process.exit(1); });
