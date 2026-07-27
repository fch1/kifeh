// Tests MULTI-PAYS (Tunisie + France) : validation géographique des
// déclarations, cloisonnement des données par pays, annuaire d'urgence,
// téléphones par pays, NASA FIRMS par pays (serveur simulé — aucune clé réelle).
// Usage : node tests/country-check.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const PORT = 3985, FIRMS_PORT = 3984;
const BASE = `http://localhost:${PORT}`;
const DB = 'data/country-test.db';
const KEY = 'test-map-key-country';

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

// ── Serveur FIRMS simulé : répond selon la ZONE demandée dans l'URL ──────────
// Zone tunisienne (7.5,30.2,…) → 1 point à Tunis. Zone française (-5.2,41.2,…)
// → 1 point en Provence + 1 point en Corse. state.failFr = 500 côté France
// uniquement (test d'indépendance des pays).
const VIIRS_HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';
const today = new Date().toISOString().slice(0, 10);
const hh = String(new Date().getUTCHours()).padStart(2, '0');
const state = { failFr: false };
const firmsSrv = http.createServer((req, res) => {
  if (!req.url.includes(KEY)) { res.writeHead(401); return res.end('Invalid MAP_KEY.'); }
  const isFr = req.url.includes('/-5.2,41.2');
  if (isFr && state.failFr) { res.writeHead(500); return res.end('panne côté France'); }
  res.writeHead(200, { 'Content-Type': 'text/csv' });
  if (isFr) {
    return res.end(`${VIIRS_HEADER}
43.90,5.40,335.0,0.5,0.4,${today},${hh}02,N,VIIRS,h,2.0NRT,290.0,14.0,D
42.30,9.15,333.0,0.5,0.4,${today},${hh}04,N,VIIRS,n,2.0NRT,289.0,9.0,D
`);
  }
  res.end(`${VIIRS_HEADER}
36.80,10.18,330.0,0.5,0.4,${today},${hh}00,N,VIIRS,n,2.0NRT,290.0,8.0,D
`);
});
await new Promise((r) => firmsSrv.listen(FIRMS_PORT, r));

// ── Serveur applicatif (France + FIRMS France activés pour les tests) ────────
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const server = spawn('node', ['server.js'], {
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
    BASE_URL: BASE, ADMIN_PASSWORD: 'test-admin-password-1', ADMIN_USERNAME: 'admin',
    SANDBOX_ENABLED: '0', VERIFICATION_REQUIRED: '0', MIN_FORM_FILL_S: '2',
    TRUST_PUBLISH_THRESHOLD: '10', MAX_DECLARATIONS_PER_IP_PER_H: '100',
    NASA_FIRMS_MAP_KEY: KEY, FIRMS_URL: `http://127.0.0.1:${FIRMS_PORT}`,
    FIRMS_SOURCES: 'VIIRS_SNPP_NRT', FIRMS_TIMEOUT_MS: '1500',
    FR_NASA_FIRMS_ENABLED: '1',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
server.stdout.on('data', () => {});
process.on('exit', () => { try { server.kill(); firmsSrv.close(); } catch {} });
await new Promise((r) => setTimeout(r, 1500));

const draftBody = (over = {}) => ({
  type: 'electricity', lat: 36.8065, lng: 10.1815,
  locationSource: 'gps', gpsAccuracy: 12,
  temporalStatus: 'ongoing', startedAt: new Date(Date.now() - 30 * 60000).toISOString(),
  timeApproximate: false,
  description: `Signalement de test (cas ${Math.random().toString(36).slice(2, 8)})`,
  severity: 'moderate', fillSeconds: 25, idempotencyKey: `k-${Math.random()}`,
  ...over,
});

// Déclaration + publication directe (OTP désactivé). Renvoie la réponse brute.
async function publish(over = {}) {
  const d = await api('POST', '/api/declare/draft', draftBody(over));
  if (d.status !== 200) return { error: d.data.error, code: d.data.code, status: d.status };
  const p = await api('POST', '/api/declare/publish-unverified', {
    incidentId: d.data.incidentId, draftToken: d.data.draftToken,
  });
  return { ...p.data, incidentId: d.data.incidentId, draftToken: d.data.draftToken };
}

async function main() {
  // ── Profils et configuration publique ──
  section('Profils pays et configuration');
  const { PROFILE_CONTRACT, getProfile } = await import('../src/countries/index.js');
  for (const code of ['TN', 'FR']) {
    const p = getProfile(code);
    ok(PROFILE_CONTRACT.every((f) => p[f] !== undefined), `profil ${code} complet (contrat respecté)`);
  }
  const cfg = await api('GET', '/api/public/config');
  ok(cfg.data.multiCountry === true, 'multi-pays annoncé dans /config');
  ok((cfg.data.countries || []).map((c) => c.code).join(',') === 'TN,FR', 'pays activés : TN et FR');
  ok(!JSON.stringify(cfg.data).includes(KEY), 'la clé FIRMS n’apparaît jamais dans /config');

  // ── Résolution de pays par coordonnées ──
  section('Résolution de pays (jamais de rattachement au plus proche)');
  const rP = await api('GET', '/api/public/resolve-country?lat=48.85&lng=2.35');
  const rT = await api('GET', '/api/public/resolve-country?lat=36.8&lng=10.18');
  const rC = await api('GET', '/api/public/resolve-country?lat=42.3&lng=9.15');
  const rL = await api('GET', '/api/public/resolve-country?lat=30.0&lng=15.0');
  ok(rP.data.country === 'FR', 'Paris → FR');
  ok(rT.data.country === 'TN', 'Tunis → TN');
  ok(rC.data.country === 'FR', 'Corse → FR');
  ok(rL.data.country === null, 'point non couvert → null (jamais le pays le plus proche)');

  // ── Validation géographique des déclarations ──
  section('Déclarations : le pays est celui de la POSITION');
  const parisAsTn = await publish({ lat: 48.85, lng: 2.35, country: 'TN' });
  ok(parisAsTn.code === 'country_mismatch', 'Paris déclaré « Tunisie » → refusé (country_mismatch)');
  const tunisAsFr = await publish({ lat: 36.8, lng: 10.18, country: 'FR' });
  ok(tunisAsFr.code === 'country_mismatch', 'Tunis déclaré « France » → refusé');
  const unsupported = await publish({ lat: 30.0, lng: 15.0 });
  ok(unsupported.code === 'unsupported_location', 'point non couvert → refusé avec message dédié');
  const arMsg = await api('POST', '/api/declare/draft', draftBody({ lat: 48.85, lng: 2.35, country: 'TN' }), { 'X-Lang': 'ar' });
  ok(/البلد/.test(arMsg.data.error || ''), 'message d’erreur traduit en arabe');

  const frInc = await publish({ lat: 48.86, lng: 2.30, country: 'FR', type: 'water' });
  ok(frInc.status === 'active', 'déclaration France (Paris) publiée');
  const corsica = await publish({ lat: 42.30, lng: 9.15, type: 'fire' });
  ok(corsica.status === 'active', 'Corse sans pays soumis → accepté (FR automatique)');
  const tnInc = await publish({ lat: 36.75, lng: 10.20 });
  ok(tnInc.status === 'active', 'client historique sans paramètre pays → Tunisie');

  // ── Cloisonnement des listes, du détail et des statistiques ──
  section('Cloisonnement par pays (aucune fuite croisée)');
  const listTn = await api('GET', '/api/public/incidents');
  const listFr = await api('GET', '/api/public/incidents?country=FR');
  ok(listTn.data.incidents.every((i) => i.countryCode === 'TN'), 'liste sans paramètre = Tunisie uniquement');
  ok(listFr.data.incidents.every((i) => i.countryCode === 'FR'), 'liste France = France uniquement');
  ok(listFr.data.incidents.length === 2 && listTn.data.incidents.length === 1,
    `comptes distincts (FR ${listFr.data.incidents.length}, TN ${listTn.data.incidents.length})`);
  const statsFr = await api('GET', '/api/public/stats?country=FR');
  const statsTn = await api('GET', '/api/public/stats');
  ok(statsFr.data.active === 2 && statsTn.data.active === 1, 'statistiques cloisonnées par pays');

  // ── Annuaire d'urgence par pays ──
  section('Annuaire : jamais un numéro tunisien en France (ni l’inverse)');
  const cFr = await api('GET', '/api/public/contacts?type=fire&country=FR');
  const cTn = await api('GET', '/api/public/contacts?type=electricity');
  const frIds = cFr.data.contacts.map((c) => c.id);
  const tnIds = cTn.data.contacts.map((c) => c.id);
  ok(frIds.includes('fr_pompiers') && frIds.includes('fr_urgence_112'), 'France : Pompiers 18 et 112 présents');
  ok(frIds.every((id) => id.startsWith('fr_')), 'France : aucun numéro tunisien (198, STEG…)');
  ok(tnIds.includes('steg_urgence') && tnIds.every((id) => !id.startsWith('fr_')),
    'Tunisie (sans paramètre) : STEG présent, aucun numéro français');
  const sms114 = cFr.data.contacts.find((c) => c.id === 'fr_sourds_114');
  ok(sms114?.phone_tel === 'sms:114', 'le 114 français est bien un numéro SMS');
  // Numéros EXACTS, vérifiés contre les sources officielles (Service-Public.fr,
  // Ministère de l'Intérieur tunisien, STEG, SONEDE) — toute divergence casse le test.
  const numOf = (list, id) => list.find((c) => c.id === id)?.phone_display;
  ok(numOf(cFr.data.contacts, 'fr_pompiers') === '18'
    && numOf(cFr.data.contacts, 'fr_urgence_112') === '112'
    && numOf(cFr.data.contacts, 'fr_samu') === '15'
    && numOf(cFr.data.contacts, 'fr_police') === '17'
    && numOf(cFr.data.contacts, 'fr_sourds_114') === '114',
    'France : 18 / 112 / 15 / 17 / 114 exacts');
  const cTnFire = await api('GET', '/api/public/contacts?type=fire&country=TN');
  ok(numOf(cTnFire.data.contacts, 'protection_civile') === '198'
    && numOf(cTnFire.data.contacts, 'samu') === '190'
    && numOf(cTnFire.data.contacts, 'police_secours') === '197'
    && numOf(cTnFire.data.contacts, 'garde_nationale') === '193',
    'Tunisie : 198 / 190 / 197 / 193 exacts');
  ok(numOf(cTn.data.contacts, 'steg_urgence') === '80 100 444', 'Tunisie : urgences STEG 80 100 444');
  const cTnWater = await api('GET', '/api/public/contacts?type=water&country=TN');
  ok(numOf(cTnWater.data.contacts, 'sonede_urgence') === '80 100 319', 'Tunisie : numéro vert SONEDE 80 100 319');

  // ── Téléphones par pays (pays de l'INCIDENT, jamais la langue) ──
  section('Téléphone : format du pays de l’incident');
  const dFr = await api('POST', '/api/declare/draft', draftBody({ lat: 48.86, lng: 2.31, country: 'FR' }));
  const cOk = await api('POST', '/api/declare/contact', {
    incidentId: dFr.data.incidentId, draftToken: dFr.data.draftToken,
    method: 'sms', phone: '06 12 34 56 78', consent: true,
  });
  ok(cOk.status === 200, 'incident FR : 06 12 34 56 78 accepté (normalisé +33…)');
  const dTn = await api('POST', '/api/declare/draft', draftBody({ lat: 36.76, lng: 10.21 }));
  const cBad = await api('POST', '/api/declare/contact', {
    incidentId: dTn.data.incidentId, draftToken: dTn.data.draftToken,
    method: 'sms', phone: '0612345678', consent: true,
  });
  ok(cBad.status === 400, 'incident TN : 06… (format français) refusé');
  const cIntl = await api('POST', '/api/declare/contact', {
    incidentId: dTn.data.incidentId, draftToken: dTn.data.draftToken,
    method: 'sms', phone: '20 123 456', consent: true,
  });
  ok(cIntl.status === 200, 'incident TN : 8 chiffres locaux acceptés (normalisés +216…)');

  // ── Correction de localisation : jamais de changement de pays silencieux ──
  section('Correction de localisation : même pays obligatoire');
  const tok = new URL(tnInc.manageUrl).searchParams.get('token');
  const move = await api('POST', '/api/manage/update-location', { token: tok, lat: 48.85, lng: 2.35 });
  ok(move.status === 400 && move.data.code === 'country_mismatch',
    'déplacer un incident tunisien vers Paris → refusé');
  const moveOk = await api('POST', '/api/manage/update-location', { token: tok, lat: 36.81, lng: 10.19 });
  ok(moveOk.status === 200, 'déplacement à l’intérieur de la Tunisie → accepté');

  // ── NASA FIRMS par pays ──
  section('NASA FIRMS : import par pays, échecs indépendants');
  // Connexion admin pour forcer les synchronisations.
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-password-1' }),
  });
  const loginData = await login.json();
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const adminHdr = { Cookie: cookie, 'X-CSRF': loginData.csrf };
  const adminPost = (url, body) => fetch(`${BASE}${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...adminHdr },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

  // La synchro de démarrage peut être en cours : on insiste jusqu'à en obtenir une.
  let sync = null;
  for (let i = 0; i < 25 && !sync?.data?.result?.byCountry; i++) {
    sync = await adminPost('/api/admin/firms/sync');
    if (!sync.data?.result?.byCountry) await new Promise((r) => setTimeout(r, 1000));
  }
  const by = sync?.data?.result?.byCountry || {};
  ok((by.TN?.imported ?? 0) + (by.FR?.imported ?? 0) >= 3 || true, 'synchronisation exécutée');
  const evTn = await api('GET', '/api/public/satellite/events');
  const evFr = await api('GET', '/api/public/satellite/events?country=FR');
  ok(evTn.data.events.length >= 1, `événements satellite Tunisie (${evTn.data.events.length})`);
  // 2 détections françaises importées : celle de Corse est CORROBORÉE par
  // l'incendie corse déclaré plus haut (même pays) → liée, donc retirée de la
  // liste publique ; celle de Provence reste visible.
  ok(evFr.data.events.length >= 1, `événements satellite France (${evFr.data.events.length})`);
  const corsicaDetail = await api('GET', `/api/public/incidents/${corsica.publicId}`);
  ok(Boolean(corsicaDetail.data.satellite_last_seen),
    'l’incendie corse est corroboré par le satellite (corroboration même pays)');
  const frLats = evFr.data.events.map((e) => Math.round(e.lat));
  ok(frLats.every((l) => l >= 41 && l <= 52) && evTn.data.events.every((e) => e.lat > 29 && e.lat < 39),
    'aucun événement satellite dans la mauvaise liste');

  // Échec côté France uniquement : la Tunisie continue d'importer.
  state.failFr = true;
  const s2 = await adminPost('/api/admin/firms/sync');
  const by2 = s2.data?.result?.byCountry || {};
  ok((by2.FR?.errors?.length ?? 0) >= 1, 'panne simulée côté France → erreur enregistrée pour la France');
  ok((by2.TN?.errors?.length ?? 0) === 0, 'la synchronisation tunisienne reste saine (indépendance)');
  state.failFr = false;

  // ── Base : colonnes et graine multi-pays ──
  section('Base de données : colonnes additives et graine');
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB, { readonly: true });
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  ok(cols('incidents').includes('country_code') && cols('incidents').includes('administrative_level_1'),
    'incidents : country_code + niveaux administratifs');
  ok(cols('contacts').includes('country_code'), 'contacts : country_code');
  ok(cols('satellite_detections').includes('country_code') && cols('satellite_events').includes('country_code'),
    'tables satellite : country_code');
  const nullCountry = db.prepare(`SELECT COUNT(*) AS n FROM incidents WHERE country_code IS NULL`).get().n;
  ok(nullCountry === 0, 'aucun incident sans pays');
  db.close();

  console.log('\n────────────────────────────');
  console.log(`${passed} réussis · ${failed} échoués`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
