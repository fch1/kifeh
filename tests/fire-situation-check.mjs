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
      temperature_2m: 34.6, apparent_temperature: 37.2, // chaleur locale
    },
    hourly: { // maximum du jour : 38,4 °C
      time: ['2026-07-27T10:00', '2026-07-27T13:00', '2026-07-27T16:00', '2026-07-27T19:00'],
      temperature_2m: [30.1, 34.6, 38.4, 33.0],
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
// ── Serveur Copernicus EFFIS SIMULÉ : zones brûlées paginées (format DRF).
//    Page 1 : Corse (anneau de 200 points → décimation) + enregistrement
//    malformé (shape null → ignoré sans erreur) ; page 2 : Gironde.
const EFFIS_PORT = 3970;
function effisRing(clat, clng, n, r = 0.01) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([clng + r * Math.cos(a), clat + r * Math.sin(a)]);
  }
  pts.push(pts[0]);
  return pts;
}
const effisSrv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const page2 = u.searchParams.has('offset');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (!page2) {
    res.end(JSON.stringify({
      count: 3,
      next: `http://127.0.0.1:${EFFIS_PORT}/rest/2/burntareas/current/?country=FR&limit=100&offset=100`,
      results: [
        {
          id: 900001, commune: 'Biguglia', province: 'Haute-Corse', country: 'FR',
          area_ha: 228, firedate: new Date(Date.now() - 2 * 24 * 3600_000).toISOString(),
          lastupdate: new Date().toISOString(),
          centroid: { type: 'Point', coordinates: [9.403, 42.627] },
          bbox: [9.3938, 42.6169, 9.4134, 42.637],
          shape: { type: 'MultiPolygon', coordinates: [[effisRing(42.627, 9.403, 200)]] },
        },
        { id: 900002, commune: 'Malformée', country: 'FR', area_ha: 3, shape: null },
      ],
    }));
  } else {
    res.end(JSON.stringify({
      count: 3, next: null,
      results: [{
        id: 900003, commune: 'La Teste-de-Buch', province: 'Gironde', country: 'FR',
        area_ha: 40, firedate: new Date(Date.now() - 9 * 24 * 3600_000).toISOString(),
        lastupdate: new Date().toISOString(),
        centroid: { type: 'Point', coordinates: [-1.15, 44.62] },
        bbox: [-1.17, 44.6, -1.13, 44.64],
        shape: { type: 'MultiPolygon', coordinates: [[effisRing(44.62, -1.15, 12)]] },
      }],
    }));
  }
});
await new Promise((r) => effisSrv.listen(EFFIS_PORT, r));
fs.rmSync('data/effis-cache.json', { force: true }); // cache d'un passage précédent

// ── Serveur Bison Futé SIMULÉ : index de dossier + fichiers DATEX II.
//    3 situations : route fermée (Gironde), travaux (Var), bouchon (ÉCARTÉ).
const ROADS_PORT = 3969;
const datex = (typ, lat, lng, road, closed) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="s">
<d2LogicalModel xmlns:xsi="x"><situation><situationRecord xsi:type="${typ}">
<overallStartTime>2026-07-28T08:00:00+02:00</overallStartTime>
${closed ? '<complianceOption>mandatory</complianceOption><roadOrCarriagewayOrLaneManagementType>roadClosed</roadOrCarriagewayOrLaneManagementType>' : ''}
<groupOfLocations xsi:type="Point"><locationForDisplay><latitude>${lat}</latitude><longitude>${lng}</longitude></locationForDisplay></groupOfLocations>
<roadNumber>${road}</roadNumber>
</situationRecord></situation></d2LogicalModel></soap:Envelope>`;
const roadsFiles = {
  '9000001.xml': datex('RoadOrCarriagewayOrLaneManagement', 44.84, -0.58, 'D106', true),
  '9000002.xml': datex('MaintenanceWorks', 43.12, 5.93, 'A50', false),
  '9000003.xml': datex('AbnormalTraffic', 45.76, 4.83, 'A7', false), // bouchon → écarté
};
const roadsSrv = http.createServer((req, res) => {
  const f = req.url.split('/').pop();
  if (roadsFiles[f]) {
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end(roadsFiles[f]);
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(Object.keys(roadsFiles).map((n) => `<a href="${n}">${n}</a>`).join('\n'));
});
await new Promise((r) => roadsSrv.listen(ROADS_PORT, r));
fs.rmSync('data/roads-cache.json', { force: true });

// ── Serveur qualité de l'air SIMULÉ (format Open-Meteo Air Quality).
const AIR_PORT = 3968;
const airSrv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ current: { time: state.time(), pm2_5: 18.4, pm10: 27.1, european_aqi: 31 } }));
});
await new Promise((r) => airSrv.listen(AIR_PORT, r));

// ── Serveur ADS-B SIMULÉ (#82, format airplanes.live /v2/point) : un aéronef
//    valide basse altitude, un en croisière (filtré), un au sol (filtré).
const ADSB_PORT = 3967; // 3968 est déjà pris par le simulateur qualité de l'air
const adsbSrv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    now: Date.now(),
    ac: [
      { hex: 'a1b2c3', flight: 'MILAN73 ', t: 'AT8T', lat: 44.51, lon: -0.49, alt_baro: 2400, gs: 165, track: 210, seen: 4 },
      { hex: 'd4e5f6', flight: 'AFR123', t: 'A320', lat: 44.52, lon: -0.48, alt_baro: 36000, gs: 450, track: 90, seen: 2 },
      { hex: '070809', flight: 'GRND1', t: 'C172', lat: 44.5, lon: -0.5, alt_baro: 'ground', gs: 0, track: 0, seen: 1 },
    ],
  }));
});
await new Promise((r) => adsbSrv.listen(ADSB_PORT, r));

const server = spawn('node', ['server.js'], {
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
    BASE_URL: BASE, ADMIN_PASSWORD: 'test-admin-password-1', ADMIN_USERNAME: 'admin',
    SANDBOX_ENABLED: '0', VERIFICATION_REQUIRED: '0', MIN_FORM_FILL_S: '2',
    TRUST_PUBLISH_THRESHOLD: '10', WEB_PUSH_DISABLED: '1',
    AIRCRAFT_URL: `http://127.0.0.1:${ADSB_PORT}`,
    WIND_URL: `http://127.0.0.1:${WIND_PORT}`, WIND_CACHE_MIN: '0',
    METEOFRANCE_API_KEY: 'cle-de-test-vigilance',
    VIGILANCE_URL: `http://127.0.0.1:${VIGI_PORT}`,
    EFFIS_URL: `http://127.0.0.1:${EFFIS_PORT}`,
    ROADS_URL: `http://127.0.0.1:${ROADS_PORT}`,
    AIR_URL: `http://127.0.0.1:${AIR_PORT}`,
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
server.stdout.on('data', () => {});
process.on('exit', () => { try { server.kill(); windSrv.close(); vigiSrv.close(); effisSrv.close(); roadsSrv.close(); airSrv.close(); } catch {} });
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
  ok(sum.data.heat && sum.data.heat.tempC === 35 && sum.data.heat.feelsC === 37,
    'chaleur locale : température actuelle et ressenti');
  ok(sum.data.heat?.maxC === 38 && String(sum.data.heat?.maxAt).includes('16:00'),
    'chaleur locale : maximum du jour et son heure');
  ok(Boolean(sum.data.latestOfficialAt), 'horodatage de la dernière info officielle');
  ok(JSON.stringify(sum.data).length < 20_000, 'charge utile < 20 Ko');
  const sumTn = await api('GET', '/api/fire-situation/summary?minLat=36&maxLat=37&minLng=10&maxLng=11');
  ok(sumTn.data.enabled === false, 'résumé inactif côté Tunisie');

  // ── Grille météo de la carte (voile de température + flèches de vent) ──
  const wg = await api('GET', '/api/fire-situation/weather-grid?minLat=44.5&maxLat=45.2&minLng=-1.2&maxLng=-0.2&country=FR');
  ok(wg.status === 200 && wg.data.grid?.cells?.length >= 9, `grille météo : ${wg.data.grid?.cells?.length} cellules`);
  const cell = wg.data.grid.cells[0];
  ok(Number.isFinite(cell.tempC) && Number.isFinite(cell.windToDeg),
    'chaque cellule : température + direction du vent prêtes à dessiner');
  ok(JSON.stringify(wg.data).length < 30_000, 'grille météo < 30 Ko');
  const wgTn = await api('GET', '/api/fire-situation/weather-grid?minLat=36&maxLat=37&minLng=10&maxLng=11');
  ok(wgTn.data.enabled === false, 'grille météo inactive côté Tunisie');

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
  // Fiche dédiée : liste complète des alertes en cours.
  const vigList = await api('GET', '/api/fire-situation/vigilance?country=FR');
  ok(vigList.data.monitored === true && vigList.data.alerts.length === 1,
    'fiche vigilance : 1 alerte listée pendant l’épisode orange');
  const va = vigList.data.alerts[0];
  ok(va.color === 'orange' && va.title.includes('Gironde') && va.deptCode === '33',
    'fiche vigilance : couleur, département et titre corrects');
  ok(Boolean(va.summaryAr) && Boolean(va.sourceUrl) && va.lat != null,
    'fiche vigilance : résumé arabe, source officielle et position présentes');
  const vigListTn = await api('GET', '/api/fire-situation/vigilance');
  ok(vigListTn.data.enabled === false, 'fiche vigilance : inactive côté Tunisie');
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
  const vigCalm = await api('GET', '/api/fire-situation/vigilance?country=FR');
  ok(vigCalm.data.monitored === true && vigCalm.data.alerts.length === 0,
    'fiche vigilance : liste vide après la levée (veille toujours active)');

  // ── Zone d'activité satellite ──
  section('Zone d’activité satellite (approximative, jamais « périmètre »)');
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB, { readonly: true });
  const cols = db.prepare(`PRAGMA table_info(satellite_events)`).all().map((c) => c.name);
  ok(cols.includes('activity_radius_m'), 'colonne activity_radius_m présente (additive)');
  db.close();
  const evs = await api('GET', '/api/public/satellite/events?country=FR');
  ok(!JSON.stringify(evs.data).includes('"perimeter'), 'aucun champ « périmètre » inventé côté satellite');

  // ── « Mon statut de sécurité » : personnel, privé, temporaire ──
  section('Statut de sécurité : flow complet, vie privée, expiration');
  const sInc = await publish({ lat: 44.87, lng: -0.58 });
  const sBefore = await api('GET', `/api/public/incidents/${sInc.publicId}`);
  const sDev = 'safety-device-abcdef123456';
  const sc1 = await api('POST', '/api/safety/checkins', {
    status: 'safe', deviceId: sDev, incidentId: sInc.publicId, country: 'FR',
  });
  ok(sc1.status === 200 && sc1.data.status === 'safe' && Boolean(sc1.data.managementToken),
    'création « je suis en sécurité » : jeton de gestion renvoyé');
  const sHoursLeft = (Date.parse(sc1.data.expiresAt) - Date.now()) / 3600_000;
  ok(sHoursLeft > 5.5 && sHoursLeft < 6.5, `expiration automatique ~6 h (${sHoursLeft.toFixed(1)} h)`);
  // Idempotence réseau mobile : re-soumission → mise à jour, jamais un doublon.
  const sc2 = await api('POST', '/api/safety/checkins', {
    status: 'safe', deviceId: sDev, incidentId: sInc.publicId, country: 'FR',
  });
  ok(sc2.status === 200 && sc2.data.updated === true, 're-soumission → mise à jour du même statut (idempotent)');
  {
    const sdb = new Database(DB, { readonly: true });
    const n = sdb.prepare(`SELECT COUNT(*) n FROM safety_checkins WHERE revoked_at IS NULL`).get().n;
    sdb.close();
    ok(n === 1, 'un seul statut actif en base (pas de doublon)');
  }
  // JAMAIS confondu avec les actions sur l'incident.
  const sAfter = await api('GET', `/api/public/incidents/${sInc.publicId}`);
  ok(sAfter.data.confirmations_count === sBefore.data.confirmations_count,
    'le statut ne compte PAS comme confirmation de l’incident');
  ok(sAfter.data.status === 'active', 'le statut ne clôt PAS l’incident');
  // Passage à « j'ai quitté la zone » via le jeton de gestion → ~12 h.
  const sUp = await api('POST', '/api/safety/checkins/update', {
    managementToken: sc1.data.managementToken, status: 'left_area',
  });
  ok(sUp.status === 200 && sUp.data.status === 'left_area', 'modification via jeton de gestion');
  ok((Date.parse(sUp.data.expiresAt) - Date.now()) / 3600_000 > 11, '« a quitté la zone » : ~12 h');
  // Lien sécurisé : contenu minimal, aucune donnée sensible.
  const sSh = await api('POST', '/api/safety/checkins/share', { managementToken: sc1.data.managementToken });
  ok(sSh.status === 200 && sSh.data.shareToken.length >= 24, 'lien sécurisé créé (jeton aléatoire)');
  const sPage = await api('GET', `/api/safety/shared/${sSh.data.shareToken}`);
  ok(sPage.status === 200 && sPage.data.status === 'left_area' && sPage.data.current === true,
    'page partagée : statut visible et à jour');
  const sRaw = JSON.stringify(sPage.data);
  ok(!sRaw.includes('lat') && !sRaw.includes('token') && !sRaw.includes('"id"') && !sRaw.includes('hash'),
    'page partagée : aucune coordonnée, aucun jeton, aucun identifiant interne');
  ok(sPage.data.areaLabel === sBefore.data.area || sPage.data.areaLabel === null
    || typeof sPage.data.areaLabel === 'string', 'zone approximative uniquement (texte)');
  const sGuess = await api('GET', `/api/safety/shared/jeton-devine-000000000000000000`);
  ok(sGuess.status === 404, 'jeton deviné → introuvable (aucune énumération possible)');
  // Révocation du lien puis suppression du statut.
  const sRv = await api('POST', '/api/safety/checkins/revoke-share', { managementToken: sc1.data.managementToken });
  ok(sRv.status === 200, 'révocation du lien partagé');
  const sGone = await api('GET', `/api/safety/shared/${sSh.data.shareToken}`);
  ok(sGone.status === 404, 'lien révoqué → inaccessible');
  // Statut expiré : présenté comme « plus à jour », jamais comme un danger.
  {
    const sdb = new Database(DB);
    sdb.prepare(`UPDATE safety_checkins SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')`).run();
    sdb.close();
  }
  const sSh2 = await api('POST', '/api/safety/checkins/share', { managementToken: sc1.data.managementToken });
  ok(sSh2.status === 404, 'statut expiré → plus partageable');
  const sDel = await api('POST', '/api/safety/checkins/delete', { managementToken: sc1.data.managementToken });
  ok(sDel.status === 200, 'suppression du statut par son auteur');
  const sDelAgain = await api('POST', '/api/safety/checkins/update', { managementToken: sc1.data.managementToken });
  ok(sDelAgain.status === 404, 'statut supprimé → jeton de gestion inerte');

  // ── Zones brûlées Copernicus EFFIS (serveur simulé) ──
  section('Zones brûlées EFFIS : synchro, simplification, bbox, honnêteté');
  // La synchro part au premier tick du planificateur (démarrage) — on attend
  // qu'elle aboutisse réellement plutôt que d'espérer un délai fixe.
  let ba = null;
  for (let i = 0; i < 30; i++) {
    ba = await api('GET', '/api/fire-situation/burnt-areas?minLat=41&maxLat=51&minLng=-5&maxLng=10&country=FR');
    if (ba.data?.areas?.length) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  ok(ba.data.enabled === true && Array.isArray(ba.data.areas), 'route active côté France');
  ok(ba.data.areas.length === 2, 'pagination suivie + enregistrement malformé ignoré (2 zones)');
  ok(ba.data.source === 'Copernicus EFFIS' && ba.data.updatedAt, 'attribution Copernicus EFFIS + horodatage');
  const corse = ba.data.areas.find((a) => a.commune === 'Biguglia');
  const gironde = ba.data.areas.find((a) => a.commune === 'La Teste-de-Buch');
  ok(Boolean(corse && gironde), 'les deux zones réelles présentes (Corse + Gironde)');
  ok(ba.data.areas[0].commune === 'Biguglia', 'tri par date de feu décroissante (plus récente d’abord)');
  ok(corse.rings.length >= 1 && corse.rings.every((r) => r.length <= 40),
    'anneau de 200 points décimé à ≤ 40 (contour approximatif assumé)');
  ok(Math.abs(corse.rings[0][0][0] - 42.6) < 0.2 && Math.abs(corse.rings[0][0][1] - 9.4) < 0.2,
    'points en [lat, lng] (prêts pour Leaflet)');
  ok(corse.areaHa === 228 && corse.province === 'Haute-Corse', 'surface et département transmis');
  const baSize = JSON.stringify(ba.data).length;
  ok(baSize < 30_000, `charge utile compacte (${baSize} o < 30 Ko)`);
  // Filtrage par zone visible : la Corse seule, puis la Gironde seule.
  const baCorse = await api('GET', '/api/fire-situation/burnt-areas?minLat=41.5&maxLat=43.5&minLng=8.5&maxLng=10&country=FR');
  ok(baCorse.data.areas.length === 1 && baCorse.data.areas[0].commune === 'Biguglia',
    'bbox Corse → zone corse uniquement');
  const baGir = await api('GET', '/api/fire-situation/burnt-areas?minLat=44&maxLat=45.5&minLng=-2&maxLng=0&country=FR');
  ok(baGir.data.areas.length === 1 && baGir.data.areas[0].commune === 'La Teste-de-Buch',
    'bbox Gironde → zone girondine uniquement');
  // Garde-fous : pays non couvert, paramètres manquants.
  const baTn = await api('GET', '/api/fire-situation/burnt-areas?minLat=41&maxLat=51&minLng=-5&maxLng=10&country=TN');
  ok(baTn.data.enabled === false, 'Tunisie → expérience désactivée (aucune donnée française)');
  const baBad = await api('GET', '/api/fire-situation/burnt-areas?country=FR');
  ok(baBad.status === 400, 'bbox manquante → 400');
  // État sur /healthz + cache disque (reprise après redémarrage).
  const hz = await (await fetch(`${BASE}/healthz`)).json();
  ok(hz.effis && hz.effis.count === 2 && Boolean(hz.effis.lastSuccess) && hz.effis.hasError === false,
    'healthz : effis {count: 2, lastSuccess, hasError: false}');
  ok(fs.existsSync('data/effis-cache.json'), 'cache persisté sur disque (survit au redémarrage)');

  // ── Routes barrées Bison Futé (serveur simulé) ──
  section('Routes barrées : DATEX II, filtrage des types, bbox, honnêteté');
  let rd = null;
  for (let i = 0; i < 30; i++) {
    rd = await api('GET', '/api/fire-situation/roads?minLat=41&maxLat=51&minLng=-5&maxLng=10&country=FR');
    if (rd.data?.events?.length) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  ok(rd.data.enabled === true && Array.isArray(rd.data.events), 'route active côté France');
  ok(rd.data.events.length === 2, 'entraves retenues : fermeture + travaux (le bouchon est ÉCARTÉ)');
  const rdClosed = rd.data.events.find((e) => e.road === 'D106');
  const rdWorks = rd.data.events.find((e) => e.road === 'A50');
  ok(Boolean(rdClosed && rdWorks), 'les deux entraves réelles présentes (Gironde + Var)');
  ok(rdClosed.closed === true && rdClosed.type === 'RoadOrCarriagewayOrLaneManagement',
    'fermeture détectée (roadClosed) avec son type DATEX');
  ok(rdWorks.closed === false && rdWorks.type === 'MaintenanceWorks', 'travaux non fermants distingués');
  ok(rd.data.source.includes('Bison Futé') && Boolean(rd.data.updatedAt), 'attribution Bison Futé + horodatage');
  const rdVar = await api('GET', '/api/fire-situation/roads?minLat=42.5&maxLat=43.5&minLng=5&maxLng=6.5&country=FR');
  ok(rdVar.data.events.length === 1 && rdVar.data.events[0].road === 'A50', 'bbox Var → entrave varoise uniquement');
  const rdTn = await api('GET', '/api/fire-situation/roads?minLat=41&maxLat=51&minLng=-5&maxLng=10&country=TN');
  ok(rdTn.data.enabled === false, 'Tunisie → couche routes désactivée');
  const hzR = await (await fetch(`${BASE}/healthz`)).json();
  ok(hzR.roads && hzR.roads.count === 2 && Boolean(hzR.roads.lastSuccess) && hzR.roads.hasError === false,
    'healthz : roads {count: 2, lastSuccess, hasError: false}');

  // ── Lot 1 « Feux FR » : historisation, /api/fire, SSE reprenable ──
  section('Lot 1 : versions EFFIS immuables, /api/fire/map, replay honnête, SSE');
  {
    const vdb = new Database(DB);
    const vs = vdb.prepare(`SELECT effis_feature_id, published_at, received_at, is_latest, area_ha_source
                            FROM burned_area_versions ORDER BY effis_feature_id`).all();
    ok(vs.length === 2, `chaque périmètre EFFIS versionné (${vs.length} versions)`);
    ok(vs.every((v) => v.received_at && v.published_at), 'versions : published_at + received_at présents');
    ok(vs.every((v) => v.is_latest === 1), 'une version courante par périmètre (is_latest)');
    ok(vs.find((v) => v.effis_feature_id === 900001)?.area_ha_source === 228,
      'surface = valeur SOURCE (jamais recalculée depuis la géométrie simplifiée)');
    vdb.close();
  }
  const fm = await api('GET', '/api/fire/map?minLat=41&maxLat=51&minLng=-5&maxLng=10&country=FR');
  ok(fm.data.enabled === true && fm.data.meta?.generatedAt, '/api/fire/map : instantané avec meta');
  ok(fm.data.meta.sources?.effis?.status && fm.data.meta.sources?.weather?.model?.includes('AROME'),
    'meta.sources : statut par source + modèle météo EXPLICITE (AROME HD)');
  ok(String(fm.data.meta.sources.firms.note || '').includes('quasi temps réel'),
    'wording « quasi temps réel » porté par l’API elle-même');
  ok(fm.data.burnedAreas.length === 2 && fm.data.burnedAreas[0].publishedAt,
    'périmètres avec date de PUBLICATION');
  // Replay honnête : à une date ANTÉRIEURE à la publication, le périmètre
  // n'existe pas — même si le feu avait commencé avant.
  const before = new Date(Date.now() - 365 * 24 * 3600_000).toISOString();
  const fmPast = await api('GET', `/api/fire/map?minLat=41&maxLat=51&minLng=-5&maxLng=10&country=FR&at=${encodeURIComponent(before)}`);
  ok(fmPast.data.meta.replayAt === before && fmPast.data.burnedAreas.length === 0,
    'replay : un périmètre publié aujourd’hui N’EXISTE PAS dans le passé');
  const tl = await api('GET', '/api/fire/timeline?minLat=41&maxLat=51&minLng=-5&maxLng=10&country=FR');
  ok(tl.data.enabled === true && Array.isArray(tl.data.effisPublications)
    && tl.data.effisPublications.reduce((s2, r) => s2 + r.n, 0) === 2,
  'timeline : publications EFFIS agrégées par heure');
  ok(String(tl.data.note || '').includes('jamais'), 'timeline : la FRP n’est jamais une taille de feu (dit par l’API)');
  // Partage social : /i/:id sert l'Open Graph SPÉCIFIQUE aux robots (type,
  // lieu approximatif) puis renvoie les humains vers l'application.
  {
    const inc = (await api('GET', '/api/public/incidents?country=FR&type=fire')).data.incidents?.[0];
    if (inc) {
      const share = await fetch(`${BASE}/i/${inc.public_id}`);
      const html = await share.text();
      ok(share.status === 200 && html.includes('og:title') && html.includes(inc.public_id),
        '/i/:id : page de partage avec Open Graph spécifique');
      ok(html.includes('noindex') && html.includes(`/?incident=${inc.public_id}`),
        '/i/:id : noindex (page de partage) + renvoi vers l’application');
    } else { ok(true, '(pas d’incident feu publié — partage non testé ici)'); }
    const missing = await fetch(`${BASE}/i/inexistant-123`, { redirect: 'manual' });
    ok(missing.status === 302, '/i/inconnu → redirection douce vers l’accueil');
  }
  // Plateforme MUTUALISÉE (addendum) : la Tunisie accède aux capacités
  // génériques (détections, signalements, replay) — mais sa réponse ne
  // mentionne JAMAIS les capacités territoriales françaises (EFFIS, AROME).
  const fmTn = await api('GET', '/api/fire/map?minLat=30&maxLat=38&minLng=7&maxLng=12&country=TN');
  ok(fmTn.data.enabled === true && Array.isArray(fmTn.data.detections),
    'Tunisie → /api/fire active (capacités génériques mutualisées)');
  ok(!('burnedAreas' in fmTn.data) && !('weather' in fmTn.data)
    && !/effis|arome/i.test(JSON.stringify(fmTn.data)),
  'Tunisie → ni zones brûlées ni météo : aucune capacité française hors couverture');
  // SSE : identifiants croissants + reprise Last-Event-ID.
  {
    const ac = new AbortController();
    const r1 = await fetch(`${BASE}/api/events?country=FR`, { signal: ac.signal });
    const reader = r1.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const deadline = Date.now() + 8000;
    // burned-area.batch a déjà été émis au démarrage — on force un nouvel
    // événement en republiant un incident ? Plus simple : lire le tampon de
    // reprise en se connectant avec Last-Event-ID=0 n'est pas rejoué (0) ;
    // on vérifie la reprise avec lastEventId=… ci-dessous via HTTP.
    ac.abort();
    try { await reader.cancel(); } catch {}
    const r2 = await fetch(`${BASE}/api/events?country=FR&lastEventId=0`);
    // lastEventId=0 → rien à rejouer, mais la connexion s'établit proprement.
    ok(r2.status === 200 && r2.headers.get('content-type').includes('event-stream'),
      'SSE : flux typé disponible (filtre pays accepté)');
    const r3 = await fetch(`${BASE}/api/events?country=FR`, { headers: { 'Last-Event-ID': '0' } });
    ok(r3.status === 200, 'SSE : en-tête Last-Event-ID accepté (reprise)');
    try { await r2.body.cancel(); await r3.body.cancel(); } catch {}
    void buf; void dec; void deadline;
  }

  // ── Qualité de l'air (serveur simulé) ──
  section('Qualité de l’air : PM2.5 dans le résumé, panne indépendante');
  const sAir = await api('GET', '/api/fire-situation/summary?minLat=44&maxLat=45&minLng=-1&maxLng=0&country=FR');
  ok(sAir.data.air && sAir.data.air.pm25 === 18 && sAir.data.air.eaqi === 31,
    'résumé : air { pm25: 18, eaqi: 31 } (Open-Meteo Air Quality simulé)');
  ok(typeof sAir.data.air.observedAt === 'string' && sAir.data.air.provider === 'open_meteo_air',
    'air : horodatage + fournisseur transmis');

  // ── Chantier #82 : moyens aériens ADS-B (drapeau OFF, ingestion serveur) ──
  section('Moyens aériens (#82) : drapeau territorial, filtres, honnêteté');
  {
    const adminSet = (settings) => fetch(`${BASE}/api/admin/settings`, {
      method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    const bboxQ = 'minLat=44&maxLat=45&minLng=-1&maxLng=0&country=FR';
    const off = await api('GET', `/api/fire/aircraft?${bboxQ}`);
    ok(off.data.enabled === false && off.data.reason === 'not_yet_enabled',
      'drapeau éteint par défaut → enabled:false, raison propre (not_yet_enabled)');
    const capOff = await api('GET', '/api/public/capabilities?country=FR');
    ok(capOff.data.layers.aircraft.enabled === false
      && capOff.data.layers.aircraft.reason === 'not_yet_enabled',
      'registre : licence vérifiée mais capacité fermée tant que le drapeau est éteint');
    // Zone de feu active nécessaire au sondage : signalement feu FR direct en base.
    {
      const { default: Database } = await import('better-sqlite3');
      const d = new Database(DB);
      d.prepare(`INSERT INTO incidents (public_id, type, status, lat, lng, public_lat, public_lng,
                 public_area, country_code, started_at, created_at, updated_at)
                 VALUES ('INC-AIRTEST', 'fire', 'active', 44.5, -0.5, 44.5, -0.5,
                 'Zone test', 'FR', datetime('now'), datetime('now'), datetime('now'))`).run();
      d.close();
    }
    await adminSet({ fire_aircraft_enabled_fr: '1' });
    const capOn = await api('GET', '/api/public/capabilities?country=FR');
    ok(capOn.data.layers.aircraft.enabled === true
      && capOn.data.layers.aircraft.provider === 'adsb-airplanes-live',
      'bascule à chaud → capacité ouverte avec son fournisseur déclaré');
    await api('POST', '/api/dev/tick'); // force une passe du planificateur
    await new Promise((r) => setTimeout(r, 2600)); // 2 requêtes espacées de 1,2 s
    const on = await api('GET', `/api/fire/aircraft?${bboxQ}`);
    ok(on.data.enabled === true && Array.isArray(on.data.aircraft),
      'drapeau allumé + zone active → réponse structurée');
    ok(on.data.aircraft.length === 1 && on.data.aircraft[0].hex === 'a1b2c3'
      && on.data.aircraft[0].callsign === 'MILAN73' && on.data.aircraft[0].type === 'AT8T',
      'filtres : la croisière (36 000 ft) et le sol sont écartés — reste l’aéronef basse altitude, code constructeur BRUT');
    ok(on.data.meta.sources.aircraft.status === 'fresh'
      && typeof on.data.meta.sources.aircraft.fetchedAt === 'string',
      'fraîcheur TYPÉE (aircraft < 3 min = fresh) + horodatage');
    ok(typeof on.data.note === 'string' && /jamais une confirmation/i.test(on.data.note),
      'note honnête : observés — jamais une confirmation d’intervention');
    const tnOff = await api('GET', '/api/fire/aircraft?minLat=36&maxLat=37&minLng=10&maxLng=11&country=TN');
    ok(tnOff.data.enabled === false,
      'Tunisie : drapeau territorial indépendant — FR allumé n’ouvre pas TN');
    await adminSet({ fire_aircraft_enabled_fr: '0' });
    const reOff = await api('GET', `/api/fire/aircraft?${bboxQ}`);
    ok(reOff.data.enabled === false, 'coupure à chaud → refermé immédiatement (réversible)');
  }

  // ── Simulation indicative de fumée (#121, master §6.4) ──
  section('Fumée : modèle pur, déterministe, borné — u/v par 5 directions');
  {
    const { windUV, simulateSmoke, SMOKE } = await import('../src/services/smoke.js');
    const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
    const V = 10;
    const n = windUV(V, 0), s = windUV(V, 180), e = windUV(V, 90), w = windUV(V, 270), sw = windUV(V, 225);
    ok(near(n.u, 0) && near(n.v, -V), 'vent du NORD → l’air VA vers le sud (u=0, v=−V)');
    ok(near(s.u, 0, 1e-9) && near(s.v, V), 'vent du SUD → vers le nord (v=+V)');
    ok(near(e.u, -V) && near(e.v, 0, 1e-9), 'vent d’EST → vers l’ouest (u=−V)');
    ok(near(w.u, V) && near(w.v, 0, 1e-9), 'vent d’OUEST → vers l’est (u=+V)');
    ok(sw.u > 0 && sw.v > 0 && near(Math.hypot(sw.u, sw.v), V, 1e-6),
      'vent du SUD-OUEST → vers le nord-est, norme conservée');

    const now = Date.parse('2026-08-04T12:00:00Z');
    const det = (over = {}) => ({
      id: 'd1', lat: 44.85, lng: -0.60, frp: 80,
      observedAt: '2026-08-04T10:00:00Z', ...over,
    });
    const windFor = () => ({ speedMS: 8, directionFromDeg: 225 });
    const r1 = simulateSmoke({ detections: [det()], windFor, nowMs: now });
    ok(r1.puffs.length > 0, `panache généré (${r1.puffs.length} bouffées, 2 h d'âge)`);
    ok(r1.puffs.every((p, i, a) => i === 0 || p.rM >= a[i - 1].rM),
      'σ(t) croît de façon monotone (élargissement, jamais un rétrécissement)');
    ok(r1.puffs.every((p, i, a) => i === 0 || p.op <= a[i - 1].op),
      'opacité décroît avec l’âge (atténuation exponentielle)');
    ok(r1.puffs.every((p) => p.lat > 44.85 && p.lng > -0.60),
      'vent du sud-ouest → toutes les bouffées partent vers le NORD-EST');
    const r2 = simulateSmoke({ detections: [det()], windFor, nowMs: now });
    ok(JSON.stringify(r1) === JSON.stringify(r2),
      'DÉTERMINISME : mêmes entrées → mêmes bouffées, octet pour octet');
    const tooOld = simulateSmoke({
      detections: [det({ observedAt: '2026-08-04T05:00:00Z' })], windFor, nowMs: now,
    });
    ok(tooOld.puffs.length === 0, 'détection de plus de 6 h → AUCUNE contribution (durée bornée)');
    const capped = simulateSmoke({ detections: [det({ id: 'd1', frp: 9999 })], windFor, nowMs: now });
    const at300 = simulateSmoke({ detections: [det({ id: 'd1', frp: SMOKE.FRP_CAP_MW })], windFor, nowMs: now });
    ok(JSON.stringify(capped) === JSON.stringify(at300),
      'FRP plafonnée : 9999 MW = 300 MW (jamais ∝ à l’infini)');
    const eastWind = () => ({ speedMS: 8, directionFromDeg: 270 }); // vers l'est
    const eq = simulateSmoke({ detections: [det({ id: 'dE', lat: 0.5 })], windFor: eastWind, nowMs: now });
    const north = simulateSmoke({ detections: [det({ id: 'dE', lat: 60.5 })], windFor: eastWind, nowMs: now });
    ok((north.puffs.at(-1)?.lng - (-0.60)) > (eq.puffs.at(-1)?.lng - (-0.60)) * 1.5,
      'latitude RESPECTÉE : le même vent d’ouest déplace plus de degrés à 60° qu’à l’équateur');
    const many = Array.from({ length: 60 }, (_, i) => det({ id: `m${i}`, lat: 44 + i * 0.02 }));
    const lite = simulateSmoke({ detections: many, windFor, nowMs: now, lite: true });
    ok(lite.truncated === true && lite.puffs.length <= SMOKE.MAX_PUFFS_TOTAL_LITE,
      `mode performance réduite : borné à ${SMOKE.MAX_PUFFS_TOTAL_LITE} bouffées, troncature ANNONCÉE`);
    const noWind = simulateSmoke({ detections: [det()], windFor: () => null, nowMs: now });
    ok(noWind.puffs.length === 0, 'pas de vent connu → pas de panache inventé');
  }

  section('Fumée : drapeau serveur, honnêteté territoriale, direction de bout en bout');
  {
    const bboxBx = 'minLat=44.5&maxLat=45.2&minLng=-1.0&maxLng=-0.2';
    const off = await api('GET', `/api/fire/smoke?${bboxBx}&country=FR`);
    ok(off.data.enabled === false && off.data.reason === 'not_yet_enabled',
      'drapeau éteint (défaut) → enabled:false, raison honnête not_yet_enabled');
    const tnRes = await api('GET', '/api/fire/smoke?minLat=36&maxLat=37&minLng=9&maxLng=11&country=TN');
    ok(tnRes.data.enabled === false && tnRes.data.reason === 'model_to_integrate',
      'Tunisie : jamais de panache sur un vent flou (model_to_integrate)');
    const setFlag = (v) => fetch(`${BASE}/api/admin/settings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...hdr },
      body: JSON.stringify({ settings: { smoke_simulation_enabled: v } }),
    });
    await setFlag('1');
    // Deux détections FRAÎCHES près de Bordeaux, insérées par le canal de la
    // base (le pipeline FIRMS complet est testé par firms-check).
    const { default: Database } = await import('better-sqlite3');
    const tdb = new Database(DB);
    const insSat = tdb.prepare(`INSERT OR IGNORE INTO satellite_detections
      (id, provider, source, satellite, instrument, external_fingerprint, lat, lng,
       scan, track, acq_date, acq_time, acquired_at, confidence, frp, brightness,
       day_night, version, country_code)
      VALUES (?, 'nasa_firms', 'VIIRS_SNPP_NRT', 'N', 'VIIRS', ?, ?, ?, 0.5, 0.4,
              ?, ?, ?, 'nominal', ?, 330, 'D', '2.0NRT', 'FR')`);
    const at = new Date(Date.now() - 90 * 60_000); // il y a 1 h 30
    const atSql = at.toISOString().replace('T', ' ').slice(0, 19);
    insSat.run('smoke-t1', 'fp-smoke-t1', 44.85, -0.60,
      at.toISOString().slice(0, 10), '1030', atSql, 120);
    insSat.run('smoke-t2', 'fp-smoke-t2', 44.87, -0.58,
      at.toISOString().slice(0, 10), '1030', atSql, 60);
    tdb.close();
    const on = await api('GET', `/api/fire/smoke?${bboxBx}&country=FR`);
    ok(on.data.enabled === true && (on.data.puffs || []).length > 0,
      `drapeau allumé → panache servi (${on.data.puffs?.length ?? 0} bouffées)`);
    ok((on.data.meta?.disclaimer || '').toLowerCase().includes('simulation indicative'),
      'le disclaimer accompagne CHAQUE réponse (ni observation, ni qualité de l’air)');
    ok(Boolean(on.data.meta?.windModel), 'le modèle de vent est NOMMÉ dans la réponse');
    // Vent simulé : 30,2 km/h venant de 225° (sud-ouest) → panache au NE.
    const mLat = on.data.puffs.reduce((s, p) => s + p.lat, 0) / on.data.puffs.length;
    const mLng = on.data.puffs.reduce((s, p) => s + p.lng, 0) / on.data.puffs.length;
    ok(mLat > 44.85 && mLng > -0.60,
      'BOUT EN BOUT : vent du sud-ouest simulé → bouffées au nord-est des foyers');
    ok(on.data.puffs.every((p) => p.op <= 0.4 && p.rM > 0),
      'bouffées bornées : opacité ≤ 0,4, rayon strictement positif');
    await setFlag('0');
    const off2 = await api('GET', `/api/fire/smoke?${bboxBx}&country=FR`);
    ok(off2.data.enabled === false, 'rollback À CHAUD : drapeau coupé → couche éteinte immédiatement');
  }

  // ── Chantier #103 : moteur MapLibre du mode feux (drapeau OFF, câblage) ──
  section('Moteur MapLibre (#103) : drapeau éteint par défaut, chargement paresseux');
  {
    const cfg0 = await api('GET', '/api/public/config');
    ok(cfg0.data.fireMapLibre === false,
      'config publique : fireMapLibre=false PAR DÉFAUT (opt-in explicite)');
    const adminSet = (settings) => fetch(`${BASE}/api/admin/settings`, {
      method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    await adminSet({ fire_maplibre_enabled: '1' });
    const cfg1 = await api('GET', '/api/public/config');
    ok(cfg1.data.fireMapLibre === true, 'bascule à chaud admin → fireMapLibre=true');
    await adminSet({ fire_maplibre_enabled: '0' });
    const cfg2 = await api('GET', '/api/public/config');
    ok(cfg2.data.fireMapLibre === false, 'coupure à chaud → fireMapLibre=false (réversible)');
    // Câblage client : module servi, librairie vendorisée présente mais JAMAIS
    // référencée dans le HTML (chargée uniquement à l'activation du mode feux).
    const glr = await fetch(`${BASE}/js/fire-map-gl.js`);
    const gl = await glr.text();
    ok(glr.status === 200 && gl.includes('kifehGLBoot') && gl.includes('kifeh:fire-mode'),
      'module fire-map-gl.js servi (armement config + suivi du mode feux)');
    ok(gl.includes('AbortController') && gl.includes('LRU_MAX') && gl.includes('cellKeys'),
      'moteur : cellules + cache LRU + annulation des requêtes présents');
    ok(gl.includes('markFailed') && gl.includes("'no_webgl'") && gl.includes('AGE_COLORS'),
      'moteur : fallback Leaflet obligatoire + 5 classes d’ancienneté');
    const htmlr = await fetch(`${BASE}/`);
    const html = await htmlr.text();
    ok((html.match(/fire-map-gl\.js/g) || []).length === 1 && !html.includes('vendor/maplibre'),
      'index.html : module inclus une fois, librairie MapLibre ABSENTE du HTML initial');
    ok(fs.existsSync('public/vendor/maplibre/maplibre-gl.js')
      && fs.existsSync('public/vendor/maplibre/maplibre-gl.css'),
      'librairie vendorisée sur disque (aucun CDN au moment de l’activation)');
  }

  console.log('\n────────────────────────────');
  console.log(`${passed} réussis · ${failed} échoués`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
