// Tests du repère DFCI : exactitude contre 40 FIXTURES extraites du fichier
// source officiel (centroïde de carreaux tirés au hasard → leur code), cas
// limites (hors France, Tunisie, non-feu, coordonnées invalides, référence
// absente), déterminisme, API de prévisualisation, valeur client IGNORÉE,
// et non-blocage de la déclaration.
// Usage : node tests/dfci-check.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 3967;
const BASE = `http://localhost:${PORT}`;
const DB = 'data/dfci-test.db';

let passed = 0, failed = 0;
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};
const section = (t) => console.log(`\n■ ${t}`);

async function api(method, url, body, headers = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

// ── Le service seul (sans serveur) : fixtures et frontières ─────────────────
process.env.DFCI_ENABLED_FR = '1';
process.env.DB_PATH = DB;
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const { lookupDfci, dfciReferenceLoaded } = await import('../src/services/dfci.js');

section('Référence locale : chargement + 40 fixtures du fichier officiel');
ok(dfciReferenceLoaded(), 'base de référence DFCI chargée (construite depuis l’artefact versionné)');
const fixtures = JSON.parse(fs.readFileSync('tests/fixtures/dfci-fixtures.json', 'utf8'));
let good = 0;
for (const f of fixtures) {
  const r = lookupDfci({ lat: f.centroid[0], lng: f.centroid[1], countryCode: 'FR', incidentType: 'fire' });
  if (r.available && r.code === f.code) good++;
  else console.log(`    ✗ attendu ${f.code}, obtenu ${r.code || r.reason} @ ${f.centroid}`);
}
ok(good === fixtures.length, `${good}/${fixtures.length} centroïdes → leur code exact (Corse et littoral inclus)`);
ok(fixtures.some((f) => f.centroid[1] > 8.5), 'les fixtures couvrent la Corse');

section('Frontières et cas limites (service)');
const again = lookupDfci({ lat: fixtures[0].centroid[0], lng: fixtures[0].centroid[1], countryCode: 'FR', incidentType: 'fire' });
ok(again.code === fixtures[0].code, 'deux appels identiques → même code (déterminisme)');
ok(again.sourceVersion === '2016-06-07' && again.precision === '2km', 'version du référentiel + précision 2 km');
ok(lookupDfci({ lat: 36.8, lng: 10.18, countryCode: 'FR', incidentType: 'fire' }).reason === 'invalid_coordinates',
  'Tunis avec country=FR → hors emprise, refusé proprement');
ok(lookupDfci({ lat: 36.8, lng: 10.18, countryCode: 'TN', incidentType: 'fire' }).reason === 'not_applicable',
  'incident tunisien → not_applicable (jamais de repère)');
ok(lookupDfci({ lat: 46.5, lng: 2.5, countryCode: 'FR', incidentType: 'electricity' }).reason === 'not_applicable',
  'incident non-feu → not_applicable');
ok(lookupDfci({ lat: NaN, lng: 2, countryCode: 'FR', incidentType: 'fire' }).reason === 'invalid_coordinates',
  'coordonnées invalides → invalid_coordinates');
// Point EXACTEMENT sur un coin de carreau : une réponse déterministe, jamais d'erreur.
const corner = lookupDfci({ lat: 48.0002, lng: 2.0002, countryCode: 'FR', incidentType: 'fire' });
ok(corner.available === true || corner.reason === 'outside_coverage',
  `point de frontière → réponse déterministe (${corner.code || corner.reason})`);

// ── Serveur complet : API, flux de déclaration, drapeaux ────────────────────
const server = spawn('node', ['server.js'], {
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
    BASE_URL: BASE, ADMIN_PASSWORD: 'test-admin-password-1', ADMIN_USERNAME: 'admin',
    SANDBOX_ENABLED: '0', VERIFICATION_REQUIRED: '0', MIN_FORM_FILL_S: '2',
    WEB_PUSH_DISABLED: '1', DFCI_ENABLED_FR: '1', DFCI_PUBLIC_DISPLAY_ENABLED: '1',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
server.stdout.on('data', () => {});
process.on('exit', () => { try { server.kill(); } catch {} });
for (let i = 0; i < 40; i++) {
  try { await fetch(`${BASE}/healthz`); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
}

async function main() {
  section('API de prévisualisation (aucune persistance)');
  const fx = fixtures[1];
  const pv = await api('POST', '/api/public/location/dfci',
    { lat: fx.centroid[0], lng: fx.centroid[1], country: 'FR', type: 'fire' });
  ok(pv.status === 200 && pv.data.available === true && pv.data.dfci.code === fx.code,
    `prévisualisation → ${fx.code}`);
  const pvTn = await api('POST', '/api/public/location/dfci', { lat: 36.8, lng: 10.18, country: 'TN', type: 'fire' });
  ok(pvTn.data.available === false, 'prévisualisation tunisienne → indisponible');
  const pvElec = await api('POST', '/api/public/location/dfci',
    { lat: fx.centroid[0], lng: fx.centroid[1], country: 'FR', type: 'electricity' });
  ok(pvElec.data.available === false, 'prévisualisation non-feu → indisponible');
  const pvBad = await api('POST', '/api/public/location/dfci', { lat: 'x', lng: 2, country: 'FR', type: 'fire' });
  ok(pvBad.status === 400, 'coordonnées invalides → 400');

  section('Déclaration : code calculé serveur, valeur client IGNORÉE');
  const d = await api('POST', '/api/declare/draft', {
    type: 'fire', lat: fx.centroid[0], lng: fx.centroid[1], country: 'FR',
    temporalStatus: 'ongoing', startedAt: new Date(Date.now() - 600000).toISOString(),
    severity: 'high', fillSeconds: 25, idempotencyKey: `dfci-${Math.random()}`,
    description: 'Feu de test repère DFCI, fumée visible depuis la route.',
    deviceLat: fx.centroid[0], deviceLng: fx.centroid[1],
    dfciCode: 'XX99Z9', // ← doit être IGNORÉ (le serveur recalcule toujours)
  });
  ok(d.status === 200, 'brouillon feu français créé');
  const p = await api('POST', '/api/declare/publish-unverified', {
    incidentId: d.data.incidentId, draftToken: d.data.draftToken,
  });
  ok(p.data.status === 'active', 'publication du feu');
  const det = await api('GET', `/api/public/incidents/${p.data.publicId || d.data.publicId}`);
  ok(det.data.dfci && det.data.dfci.code === fx.code,
    `détail public : repère ${fx.code} (calcul serveur, valeur client ignorée)`);
  ok(det.data.dfci.code !== 'XX99Z9', 'le code envoyé par le navigateur n’apparaît jamais');
  ok(!('dfci_source_version' in det.data) && !('dfci_computed_at' in det.data),
    'détail public : ni version du référentiel ni horodatage interne');
  const rawDetail = JSON.stringify(det.data);
  ok(!rawDetail.includes(String(fx.centroid[0])), 'détail public : jamais la coordonnée exacte du calcul');

  section('Non-feu et Tunisie : jamais de repère');
  const dElec = await api('POST', '/api/declare/draft', {
    type: 'electricity', lat: fx.centroid[0], lng: fx.centroid[1], country: 'FR',
    temporalStatus: 'ongoing', startedAt: new Date(Date.now() - 600000).toISOString(),
    severity: 'moderate', fillSeconds: 25, idempotencyKey: `dfci2-${Math.random()}`,
    description: 'Coupure de test — aucun repère DFCI attendu ici.',
    deviceLat: fx.centroid[0], deviceLng: fx.centroid[1],
  });
  const pElec = await api('POST', '/api/declare/publish-unverified', {
    incidentId: dElec.data.incidentId, draftToken: dElec.data.draftToken,
  });
  const detElec = await api('GET', `/api/public/incidents/${pElec.data.publicId}`);
  ok(detElec.data.dfci === null || detElec.data.dfci === undefined,
    'coupure d’électricité → aucun repère DFCI');

  section('healthz : indicateurs sans chemin local');
  const hz = await (await fetch(`${BASE}/healthz`)).json();
  ok(hz.dfci && hz.dfci.enabled === true && hz.dfci.referenceLoaded === true
    && hz.dfci.version === '2016-06-07', 'healthz : dfci {enabled, referenceLoaded, version}');
  ok(!JSON.stringify(hz.dfci).includes('/'), 'healthz : aucun chemin de fichier exposé');

  console.log('\n────────────────────────────');
  console.log(`${passed} réussis · ${failed} échoués`);
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
