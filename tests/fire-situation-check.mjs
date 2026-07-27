// Tests « Situation incendie » (France) : vent contextuel (serveur météo
// SIMULÉ), contexte sous-le-vent conservateur, informations officielles
// (liste blanche, hiérarchie, remplacement), zone d'activité satellite,
// et verrou multi-dénominateurs des confirmations.
// Usage : node tests/fire-situation-check.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const PORT = 3973, WIND_PORT = 3972;
const BASE = `http://localhost:${PORT}`;
const DB = 'data/firesit-test.db';

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

// ── Serveur météo SIMULÉ (format Open-Meteo) : vent 30 km/h venant du
//    sud-ouest (225°) → soufflant VERS le nord-est (45°). state.down = panne.
const state = { down: false, time: () => new Date().toISOString().slice(0, 16) };
const windSrv = http.createServer((req, res) => {
  if (state.down) { res.writeHead(503); return res.end('indisponible'); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    current: {
      time: state.time(),
      wind_speed_10m: 30.2, wind_direction_10m: 225, wind_gusts_10m: 52.4,
    },
  }));
});
await new Promise((r) => windSrv.listen(WIND_PORT, r));

// ── Serveur Vigilance Météo-France SIMULÉ : state.vigi pilote le bulletin.
const VIGI_PORT = 3971;
const vigiState = { warm: [] }; // ex. [{ dept: '33', color: 4, phen: '6' }]
const VIGI_END = new Date(Date.now() + 8 * 3600_000).toISOString(); // fenêtre FIXE (comme un vrai bulletin)
const vigiSrv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    product: {
      update_time: new Date().toISOString(),
      global_max_color_id: vigiState.warm.length ? Math.max(...vigiState.warm.map((w) => w.color)) : 1,
      periods: [{
        echeance: 'J',
        begin_validity_time: new Date().toISOString(),
        end_validity_time: VIGI_END,
        timelaps: {
          domain_ids: [
            ...vigiState.warm.map((w) => ({
              domain_id: w.dept, max_color_id: w.color,
              phenomenon_items: [{ phenomenon_id: w.phen, phenomenon_max_color_id: w.color }],
            })),
            { domain_id: '75', max_color_id: 1, phenomenon_items: [] },
          ],
        },
      }],
    },
  }));
});
await new Promise((r) => vigiSrv.listen(VIGI_PORT, r));

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const server = spawn('node', ['server.js'], {
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
    BASE_URL: BASE, ADMIN_PASSWORD: 'test-admin-password-1', ADMIN_USERNAME: 'admin',
    SANDBOX_ENABLED: '0', VERIFICATION_REQUIRED: '0', MIN_FORM_FILL_S: '2',
    TRUST_PUBLISH_THRESHOLD: '10', WEB_PUSH_DISABLED: '1',
    WIND_URL: `http://127.0.0.1:${WIND_PORT}`, WIND_CACHE_MIN: '0',
    METEOFRANCE_API_KEY: 'cle-de-test-vigilance',
    VIGILANCE_URL: `http://127.0.0.1:${VIGI_PORT}`,
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
server.stdout.on('data', () => {});
process.on('exit', () => { try { server.kill(); windSrv.close(); vigiSrv.close(); } catch {} });
// Attente de disponibilité réelle (le premier démarrage crée les tables).
for (let i = 0; i < 30; i++) {
  try { await fetch(`${BASE}/healthz`); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
}

async function publish(over = {}) {
  const d = await api('POST', '/api/declare/draft', {
    type: 'fire', lat: 44.85, lng: -0.60, country: 'FR',
    temporalStatus: 'ongoing', startedAt: new Date(Date.now() - 600000).toISOString(),
    severity: 'high', fillSeconds: 25, idempotencyKey: `k-${Math.random()}`,
    description: `Feu de test ${Math.random().toString(36).slice(2, 8)}`,
    deviceLat: 44.85, deviceLng: -0.60, ...over,
  });
  if (d.status !== 200) return { error: d.data, status: d.status };
  const p = await api('POST', '/api/declare/publish-unverified', {
    incidentId: d.data.incidentId, draftToken: d.data.draftToken,
  });
  return { ...p.data };
}

async function main() {
  // ── Connexion admin ──
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-password-1' }),
  });
  const loginData = await login.json();
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const hdr = { Cookie: cookie, 'X-CSRF': loginData.csrf };

  // ── Vent contextuel ──
  section('Vent (modèle simulé) : direction, rafales, horodatage');
  const fire = await publish();
  ok(fire.status === 'active', 'incendie français publié (Bordeaux)');
  const w1 = await api('GET', '/api/fire-situation/wind?fireLat=44.85&fireLng=-0.60&country=FR');
  ok(w1.data.enabled === true && w1.data.wind, 'vent renvoyé pour un foyer français');
  ok(w1.data.wind.speedKmh === 30 && w1.data.wind.gustsKmh === 52, 'vitesse 30 km/h et rafales 52 km/h');
  ok(w1.data.wind.directionToDeg === 45, 'vent du sud-ouest → souffle vers le nord-est (45°)');
  ok(Boolean(w1.data.wind.observedAt) && w1.data.wind.stale === false, 'horodatage présent, donnée fraîche');
  ok(!JSON.stringify(w1.data).includes('GRIB'), 'aucune donnée brute météo transmise');

  section('Contexte « sous le vent » — conservateur, jamais une prévision');
  // Foyer à Bordeaux (44.85, -0.60) ; vent vers le nord-est.
  const down = await api('GET', '/api/fire-situation/wind?fireLat=44.85&fireLng=-0.60&userLat=44.95&userLng=-0.45&country=FR');
  ok(down.data.downwind === 'downwind', 'lieu au nord-est du foyer → sous le vent');
  const up = await api('GET', '/api/fire-situation/wind?fireLat=44.85&fireLng=-0.60&userLat=44.75&userLng=-0.75&country=FR');
  ok(up.data.downwind === 'upwind', 'lieu au sud-ouest → au vent (hors axe)');
  const cross = await api('GET', '/api/fire-situation/wind?fireLat=44.85&fireLng=-0.60&userLat=44.95&userLng=-0.80&country=FR');
  ok(cross.data.downwind === 'crosswind', 'lieu perpendiculaire → travers (hors axe)');
  const far = await api('GET', '/api/fire-situation/wind?fireLat=44.85&fireLng=-0.60&userLat=48.85&userLng=2.35&country=FR');
  ok(far.data.downwind === 'unknown', 'lieu à 500 km → indéterminé (jamais d’inférence lointaine)');
  // Donnée périmée → indéterminé.
  state.time = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 16);
  const stale = await api('GET', '/api/fire-situation/wind?fireLat=44.86&fireLng=-0.61&userLat=44.95&userLng=-0.45&country=FR');
  ok(stale.data.wind.stale === true && stale.data.downwind === 'unknown',
    'météo périmée (3 h) → marquée périmée, contexte indéterminé');
  state.time = () => new Date().toISOString().slice(0, 16);

  section('Pannes indépendantes');
  state.down = true;
  const wDown = await api('GET', '/api/fire-situation/wind?fireLat=44.90&fireLng=-0.66&country=FR');
  ok(wDown.data.enabled === true && wDown.data.wind === null, 'météo en panne → vent null, jamais d’erreur bloquante');
  const listStill = await api('GET', '/api/public/incidents?country=FR');
  ok(listStill.data.count >= 1, 'les signalements citoyens restent servis pendant la panne météo');
  state.down = false;

  section('Cloisonnement : la Tunisie garde son comportement actuel');
  const tnWind = await api('GET', '/api/fire-situation/wind?fireLat=36.8&fireLng=10.18');
  ok(tnWind.data.enabled === false, 'expérience désactivée côté Tunisie (pas de paramètre pays)');

  // ── Informations officielles ──
  section('Informations officielles : liste blanche obligatoire');
  const badAuth = await api('POST', '/api/admin/official/updates', {
    authorityId: 'inexistante', infoType: 'evacuation', summaryFr: 'x', publishedAt: new Date().toISOString(),
  }, hdr);
  ok(badAuth.status === 400, 'import refusé pour une autorité hors liste blanche');
  const pref = await api('POST', '/api/admin/official/authorities', {
    countryCode: 'FR', name: 'Préfecture de la Gironde', authorityType: 'prefecture',
    coverageLevel: 'departement', officialDomain: 'gironde.gouv.fr',
    sourceUrl: 'https://www.gironde.gouv.fr',
  }, hdr);
  const commune = await api('POST', '/api/admin/official/authorities', {
    countryCode: 'FR', name: 'Commune de Saumos', authorityType: 'commune',
    coverageLevel: 'commune', officialDomain: 'saumos.fr',
  }, hdr);
  ok(pref.status === 200 && commune.status === 200, 'préfecture et commune enregistrées (liste blanche)');

  const uPref = await api('POST', '/api/admin/official/updates', {
    authorityId: pref.data.id, infoType: 'safety_instruction', severity: 'urgent',
    summaryFr: 'Évitez le secteur forestier concerné, suivez les axes indiqués par les autorités.',
    summaryAr: 'تجنّبوا القطاع الغابي المعني واتبعوا المحاور التي حددتها السلطات.',
    rawContent: 'Texte original de la préfecture — jamais réécrit.',
    publishedAt: new Date(Date.now() - 30 * 60000).toISOString(),
    lat: 44.85, lng: -0.60, radiusKm: 60,
    sourceUrl: 'https://www.gironde.gouv.fr/actualite-test',
  }, hdr);
  const uCommune = await api('POST', '/api/admin/official/updates', {
    authorityId: commune.data.id, infoType: 'situation_update',
    summaryFr: 'Point de situation communal : intervention en cours au nord du bourg.',
    publishedAt: new Date(Date.now() - 10 * 60000).toISOString(),
    lat: 44.85, lng: -0.60, radiusKm: 15,
  }, hdr);
  ok(uPref.status === 200 && uCommune.status === 200, 'deux messages officiels importés');

  section('Hiérarchie : la source la plus spécifique d’abord');
  const off = await api('GET', '/api/fire-situation/official?lat=44.85&lng=-0.60&country=FR');
  ok(off.data.updates.length === 2, 'deux messages pertinents pour le point');
  ok(off.data.updates[0].authority === 'Commune de Saumos', 'commune avant préfecture');
  ok(off.data.updates.every((u) => u.authority && u.publishedAt && u.infoType),
    'chaque message porte autorité, horodatage et type');
  ok(!JSON.stringify(off.data).match(/nasa_firms|VIIRS|official_municipality/i),
    'aucune énumération interne exposée');
  const offFar = await api('GET', '/api/fire-situation/official?lat=48.85&lng=2.35&country=FR');
  ok(offFar.data.updates.length === 0, 'Paris (hors zones) → aucun message non pertinent affiché');

  section('Remplacement (supersedes) et texte original préservé');
  const uPref2 = await api('POST', '/api/admin/official/updates', {
    authorityId: pref.data.id, infoType: 'end_of_alert',
    summaryFr: 'Levée des restrictions sur le secteur.',
    publishedAt: new Date().toISOString(),
    lat: 44.85, lng: -0.60, radiusKm: 60,
    supersedesId: uPref.data.id,
  }, hdr);
  ok(uPref2.status === 200, 'message de fin d’alerte importé (remplace le précédent)');
  const off2 = await api('GET', '/api/fire-situation/official?lat=44.85&lng=-0.60&country=FR');
  ok(!off2.data.updates.some((u) => u.id === uPref.data.id), 'message remplacé retiré du flux courant');
  const detail = await api('GET', `/api/fire-situation/official/${uPref2.data.id}`);
  ok(detail.status === 200 && detail.data.infoType === 'end_of_alert', 'détail du message accessible');
  const oldDetail = await api('GET', `/api/fire-situation/official/${uPref.data.id}`);
  ok(oldDetail.status === 200 && oldDetail.data.rawContent.includes('jamais réécrit'),
    'historique conservé, texte original intact');

  // ── Résumé local ──
  section('Résumé local compact');
  const sum = await api('GET', '/api/fire-situation/summary?minLat=44.5&maxLat=45.2&minLng=-1.2&maxLng=-0.2&country=FR');
  ok(sum.data.enabled === true, 'résumé actif côté France');
  ok(sum.data.communityFires >= 1, `au moins 1 incendie citoyen dans la zone (${sum.data.communityFires})`);
  ok(sum.data.wind && sum.data.wind.speedKmh === 30, 'vent local inclus');
  ok(Boolean(sum.data.latestOfficialAt), 'horodatage de la dernière info officielle');
  ok(JSON.stringify(sum.data).length < 20_000, 'charge utile < 20 Ko');
  const sumTn = await api('GET', '/api/fire-situation/summary?minLat=36&maxLat=37&minLng=10&maxLng=11');
  ok(sumTn.data.enabled === false, 'résumé inactif côté Tunisie');

  // ── Verrou multi-dénominateurs des confirmations ──
  section('Confirmations : un dénominateur (appareil OU IP) ne sert qu’une fois');
  const inc = await publish({ lat: 44.90, lng: -0.55 });
  const dev = (s) => `device-${s}-abcdefghij123456`;
  const c1 = await api('POST', '/api/public/confirm/direct', { publicId: inc.publicId, deviceId: dev('a') });
  ok(c1.status === 200, 'confirmation 1 acceptée (appareil A + IP)');
  const c2 = await api('POST', '/api/public/confirm/direct', { publicId: inc.publicId, deviceId: dev('a') });
  ok(c2.status === 400, 'même appareil → refusée');
  const c3 = await api('POST', '/api/public/confirm/direct', { publicId: inc.publicId, deviceId: dev('b') });
  ok(c3.status === 400, 'appareil B mais MÊME IP → refusée (le dénominateur IP a déjà servi)');
  const c4 = await api('POST', '/api/public/confirm/direct', { publicId: inc.publicId });
  ok(c4.status === 400, 'sans identifiant d’appareil, même IP → refusée');
  const det = await api('GET', `/api/public/incidents/${inc.publicId}`);
  ok(det.data.confirmations_count === 1, 'compteur final : 1 seule confirmation retenue');

  // ── Vigilance Météo-France (bulletin simulé) ──
  section('Vigilance Météo-France : orange publiée, levée archivée');
  const adminPost = (url) => fetch(`${BASE}${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...hdr },
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
  vigiState.warm = [{ dept: '33', color: 3, phen: '6' }]; // Gironde orange canicule
  const vs1 = await adminPost('/api/admin/vigilance/sync');
  ok(vs1.data.published === 1, 'vigilance orange Gironde → 1 information officielle publiée');
  const offVigi = await api('GET', '/api/fire-situation/official?lat=44.85&lng=-0.60&country=FR');
  const vigiMsg = offVigi.data.updates.find((u) => u.authority === 'Météo-France — Vigilance');
  ok(Boolean(vigiMsg), 'visible dans les consignes officielles à Bordeaux');
  ok(vigiMsg?.summaryFr.includes('orange') && vigiMsg?.summaryFr.includes('canicule'),
    'résumé prudent : couleur + phénomène, renvoi au bulletin officiel');
  ok(Boolean(vigiMsg?.summaryAr), 'résumé arabe présent (étiqueté Kifeh côté client)');
  const offVigiParis = await api('GET', '/api/fire-situation/official?lat=48.85&lng=2.35&country=FR');
  ok(!offVigiParis.data.updates.some((u) => u.authority === 'Météo-France — Vigilance'),
    'Paris (département vert) : aucune vigilance affichée');
  // État de veille TOUJOURS visible dans le résumé (même hors de la zone en alerte).
  const sumVigi = await api('GET', '/api/fire-situation/summary?minLat=48.5&maxLat=49.2&minLng=2.0&maxLng=2.9&country=FR');
  ok(sumVigi.data.vigilance?.activeDepartments === 1,
    'résumé : la veille Vigilance signale 1 département en alerte (échelle nationale)');
  ok(Boolean(sumVigi.data.vigilance?.checkedAt), 'résumé : horodatage du dernier contrôle Vigilance');
  const vs1b = await adminPost('/api/admin/vigilance/sync');
  ok(vs1b.data.published === 0, 'bulletin inchangé → aucune republication (anti-doublon)');
  vigiState.warm = []; // retour au calme
  const vs2 = await adminPost('/api/admin/vigilance/sync');
  ok(vs2.data.archived === 1, 'vigilance levée → message archivé (historique conservé)');
  const offAfter = await api('GET', '/api/fire-situation/official?lat=44.85&lng=-0.60&country=FR');
  ok(!offAfter.data.updates.some((u) => u.authority === 'Météo-France — Vigilance'),
    'plus affichée après la levée');
  const sumCalm = await api('GET', '/api/fire-situation/summary?minLat=44.5&maxLat=45.2&minLng=-1.2&maxLng=-0.2&country=FR');
  ok(sumCalm.data.vigilance?.activeDepartments === 0,
    'retour au calme : la veille affiche « rien à signaler » (0 département)');

  // ── Zone d'activité satellite ──
  section('Zone d’activité satellite (approximative, jamais « périmètre »)');
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB, { readonly: true });
  const cols = db.prepare(`PRAGMA table_info(satellite_events)`).all().map((c) => c.name);
  ok(cols.includes('activity_radius_m'), 'colonne activity_radius_m présente (additive)');
  db.close();
  const evs = await api('GET', '/api/public/satellite/events?country=FR');
  ok(!JSON.stringify(evs.data).includes('"perimeter'), 'aucun champ « périmètre » inventé côté satellite');

  console.log('\n────────────────────────────');
  console.log(`${passed} réussis · ${failed} échoués`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
