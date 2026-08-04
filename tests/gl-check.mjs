// Tests navigateur du moteur MapLibre du mode feux (#103) — hors chaîne CI
// (WebGL requis) : `npm run test:gl`. Trois vérités mesurées :
//   1. drapeau ÉTEINT → strictement RIEN (ni #glMap, ni requête vendor) ;
//   2. drapeau ALLUMÉ + mode feux → le moteur s'active (ou se replie
//      HONNÊTEMENT sur Leaflet si WebGL absent — jamais un écran cassé) ;
//   3. mesures de performance réelles pour docs/MAP_PERFORMANCE_REPORT.md
//      (init moteur, premier rendu, cellules chargées).
// Usage : node tests/gl-check.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const PORT = 3969;
const FIRMS_PORT = 3962;
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = 'gl-check-firms-key';
const DB = 'data/gl-check.db';

let passed = 0, failed = 0;
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};
async function okEventually(pg, fn, label, timeout = 10000) {
  const start = Date.now();
  let last = false;
  while (Date.now() - start < timeout) {
    try { last = await pg.evaluate(fn); } catch { last = false; }
    if (last) break;
    await pg.waitForTimeout(250);
  }
  ok(last, label);
  return last;
}

// FIRMS simulé : 12 détections autour de la Gironde — le moteur doit les
// RENDRE réellement (régression 04/08 : worker bloqué par la CSP → zéro
// pixel alors que « active » restait vrai).
const VIIRS_HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';
const firmsRows = () => Array.from({ length: 12 }, (_, i) => {
  const at = new Date(Date.now() - ((i * 90) % 1200) * 60_000);
  const lat = (44.52 + Math.sin(i * 2.4) * 0.2).toFixed(4);
  const lng = (-0.62 + Math.cos(i * 2.4) * 0.25).toFixed(4);
  return `${lat},${lng},331.0,0.5,0.4,${at.toISOString().slice(0, 10)},${at.toISOString().slice(11, 16).replace(':', '')},N,VIIRS,n,2.0NRT,290.0,${(5 + i * 3).toFixed(1)},D`;
}).join('\n');
const firmsSrv = http.createServer((req, res) => {
  if (!req.url.includes(KEY)) { res.writeHead(401); return res.end('Invalid MAP_KEY.'); }
  res.writeHead(200, { 'Content-Type': 'text/csv' });
  res.end(`${VIIRS_HEADER}\n${firmsRows()}\n`);
});
await new Promise((r) => firmsSrv.listen(FIRMS_PORT, r));

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const server = spawn('node', ['server.js'], {
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
    BASE_URL: BASE, ADMIN_PASSWORD: 'test-admin-password-1', ADMIN_USERNAME: 'admin',
    SANDBOX_ENABLED: '0', VERIFICATION_REQUIRED: '0',
    NASA_FIRMS_MAP_KEY: KEY, FIRMS_URL: `http://127.0.0.1:${FIRMS_PORT}`,
    FIRMS_SOURCES: 'VIIRS_SNPP_NRT', FIRMS_TIMEOUT_MS: '2500',
  },
  stdio: 'ignore',
});
process.on('exit', () => { try { server.kill(); firmsSrv.close(); } catch {} });
for (let i = 0; i < 60; i++) {
  try { await fetch(`${BASE}/healthz`); break; }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}

// Connexion admin (bascule du drapeau à chaud — jamais par variable d'env :
// une env pinnerait le réglage et masquerait la bascule réelle).
const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'test-admin-password-1' }),
});
const loginData = await login.json();
const hdr = {
  Cookie: (login.headers.get('set-cookie') || '').split(';')[0],
  'X-CSRF': loginData.csrf, 'Content-Type': 'application/json',
};
const setFlag = (v) => fetch(`${BASE}/api/admin/settings`, {
  method: 'POST', headers: hdr, body: JSON.stringify({ settings: { fire_maplibre_enabled: v } }),
});
// Import RÉEL (pipeline FIRMS complet) : le moteur devra RENDRE ces points.
const syncRes = await fetch(`${BASE}/api/admin/firms/sync`, { method: 'POST', headers: hdr });
ok(syncRes.status === 200, `import FIRMS simulé (${syncRes.status})`);

// WebGL logiciel (SwiftShader) : le conteneur de test n'a pas de GPU.
// Les requêtes de tuiles du WORKER MapLibre ne passent PAS par page.route
// (limite Playwright) : depuis que la CSP les autorise (04/08), elles
// pendaient sur le réseau muet du bac à sable et « load » n'arrivait jamais.
// On résout donc les domaines de tuiles vers 127.0.0.1 : refus IMMÉDIAT,
// pour tous les contextes, workers compris.
const TILE_ARGS = ['--host-resolver-rules=MAP tile.openstreetmap.org 127.0.0.1, MAP *.tile.openstreetmap.org 127.0.0.1, MAP basemaps.cartocdn.com 127.0.0.1, MAP *.cartocdn.com 127.0.0.1'];
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...TILE_ARGS],
}).catch(() => chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...TILE_ARGS] }));

const initScript = () => {
  try {
    localStorage.setItem('lang', 'fr');
    localStorage.setItem('kifeh_onboarded', '1');
    localStorage.setItem('kifeh_country', 'FR');
    localStorage.setItem('kifeh_visits', '3');
    localStorage.setItem('kifeh_weather_layer', '0'); // couches annexes muettes
  } catch {}
};

async function newPage(ctx, path = '/') {
  const pg = await ctx.newPage();
  const requests = [];
  pg.on('request', (r) => requests.push(r.url()));
  // Tuiles raster bloquées : réseau déterministe (le moteur, pas la carte OSM).
  await pg.route(/tile\.openstreetmap\.org|cartocdn\.com/, (route) => route.abort());
  await pg.goto(`${BASE}${path}`, { waitUntil: 'load' });
  await pg.waitForTimeout(1200);
  return { pg, requests };
}

console.log('\n■ Drapeau ÉTEINT (défaut) : zéro trace du moteur');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(initScript);
  const { pg, requests } = await newPage(ctx, '/?lat=44.52&lng=-0.62&z=9');
  // Mode feux activé (puce 🔥) — le moteur doit rester ABSENT, drapeau éteint.
  await pg.click('.chip[data-type="fire"]').catch(() => {});
  await pg.waitForTimeout(1500);
  // Capture de référence Leaflet (#119) : mêmes données, même viewport que
  // la capture GL de la section suivante.
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: '/home/claude/carte-leaflet.png' }).catch(() => {});
  ok(await pg.evaluate(() => !document.getElementById('glMap')),
    'drapeau OFF → #glMap n’existe pas (même en mode feux)');
  ok(!requests.some((u) => u.includes('vendor/maplibre')),
    'drapeau OFF → librairie MapLibre jamais téléchargée');
  ok(await pg.evaluate(() => window.kifehGLState && window.kifehGLState().armed === false),
    'drapeau OFF → moteur désarmé (kifehGLState.armed=false)');
  await ctx.close();
}

console.log('\n■ Drapeau ALLUMÉ : activation en mode feux (ou repli honnête)');
await setFlag('1');
let perf = null;
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(initScript);
  // ?glshot=1 : poignée de diagnostic __glMap (jamais présente en usage réel).
  const { pg, requests } = await newPage(ctx, '/?glshot=1&lat=44.52&lng=-0.62&z=9');
  ok(await pg.evaluate(() => window.kifehGLState().armed === true),
    'drapeau ON → moteur armé après réception de la configuration');
  ok(await pg.evaluate(() => !document.getElementById('glMap')),
    'armé mais HORS mode feux → toujours aucun chargement (paresseux)');
  const t0 = Date.now();
  await pg.click('.chip[data-type="fire"]');
  const activated = await okEventually(pg,
    () => window.kifehGLState().active === true || window.kifehGLState().failed === true,
    'mode feux → le moteur tranche : actif OU repli explicite (jamais un limbe)');
  const st = await pg.evaluate(() => window.kifehGLState());
  if (st.active) {
    ok(requests.some((u) => u.includes('vendor/maplibre/maplibre-gl.js')),
      'librairie vendorisée chargée à l’activation uniquement');
    ok(await pg.evaluate(() => document.getElementById('glMap')?.style.display !== 'none'),
      'GL visible au-dessus de Leaflet (qui reste vivant dessous)');
    await okEventually(pg, () => window.kifehGLState().cells >= 1,
      'chargement par cellules : au moins une cellule en cache LRU');
    // Régression 04/08 : une expression de style invalide laissait le moteur
    // « actif » SANS couches de détections (zombie). Le style doit être COMPLET.
    await okEventually(pg, () => window.kifehGLState().styleComplete === true,
      'style COMPLET : couches det-core + det-halo réellement présentes');
    // Régression 04/08 (bis) : worker MapLibre bloqué par la CSP → données
    // jamais traitées, ZÉRO pixel rendu. La vérité, c'est le RENDU.
    await okEventually(pg, () => {
      const m = window.__glMap;
      if (!m) return false;
      try { return m.queryRenderedFeatures({ layers: ['det-core'] }).length > 0; } catch { return false; }
    }, 'détections réellement RENDUES (queryRenderedFeatures > 0)', 15000);
    // Capture GL (#119) : le tampon est conservé (?glshot=1) — même viewport
    // que la capture Leaflet de la section précédente.
    await pg.waitForTimeout(1200);
    await pg.screenshot({ path: '/home/claude/carte-maplibre.png' }).catch(() => {});
    ok(requests.some((u) => u.includes('/api/fire/map?')),
      'les cellules interrogent bien l’API mutualisée /api/fire/map');
    await okEventually(pg, () => Number.isFinite(window.__glPerf?.firstRenderMs),
      'premier rendu mesuré (__glPerf.firstRenderMs — « idle » optionnel, tuiles coupées)');
    // TUILES BLOQUÉES dans ce test : le moteur doit rester debout malgré tout
    // (les échecs de fond de carte ne tuent jamais le moteur — comme Leaflet).
    await pg.waitForTimeout(2500);
    ok(await pg.evaluate(() => window.kifehGLState().active === true),
      'tuiles en échec → le moteur TIENT (fond neutre, données visibles)');
    perf = await pg.evaluate(() => window.__glPerf);
    perf.wallToActiveMs = Date.now() - t0;
    // Sortie du mode feux → moteur masqué, Leaflet seul, requêtes annulées.
    await pg.click('.chip[data-type="fire"]');
    await okEventually(pg, () => window.kifehGLState().active === false,
      'sortie du mode feux → moteur masqué, Leaflet reprend');
    ok(await pg.evaluate(() => document.getElementById('glMap')?.style.display === 'none'),
      'le conteneur GL est caché (pas détruit : ré-entrée instantanée)');
  } else {
    // Environnement sans WebGL : le REPLI est la fonctionnalité testée.
    ok(st.failed === true, `WebGL indisponible ici → repli Leaflet propre (raison trackée)`);
    ok(await pg.evaluate(() => !document.getElementById('glMap')
      || document.getElementById('glMap').style.display === 'none'),
      'repli → aucun voile GL ne recouvre la carte Leaflet');
    console.log('  ⚠ WebGL absent dans ce conteneur : mesures de perf non produites ici.');
  }
  void activated;
  await ctx.close();
}
await setFlag('0');

console.log('\n■ Déploiement progressif (#122) : pourcentage de sessions, tirage stable');
{
  const setPct = (v) => fetch(`${BASE}/api/admin/settings`, {
    method: 'POST', headers: hdr, body: JSON.stringify({ settings: { fire_maplibre_rollout_pct: v } }),
  });
  await setPct('100');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(initScript);
  const { pg } = await newPage(ctx);
  ok(await pg.evaluate(() => window.kifehGLState().armed === true),
    'drapeau OFF + pourcentage 100 → moteur armé (déploiement progressif)');
  const b1 = await pg.evaluate(() => localStorage.getItem('kifeh_gl_bucket'));
  await pg.reload({ waitUntil: 'load' });
  await pg.waitForTimeout(1200);
  const b2 = await pg.evaluate(() => localStorage.getItem('kifeh_gl_bucket'));
  ok(b1 !== null && b1 === b2,
    `tirage local STABLE entre visites (godet ${b1} — jamais d'expérience qui clignote)`);
  await ctx.close();
  await setPct('0');
  const ctx0 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx0.addInitScript(initScript);
  const { pg: pg0 } = await newPage(ctx0);
  ok(await pg0.evaluate(() => window.kifehGLState().armed === false),
    'pourcentage 0 (rollback) → moteur désarmé pour les nouveaux chargements');
  await ctx0.close();
}

console.log('\n────────────────────────────');
console.log(`${passed} réussis · ${failed} échoués`);
if (perf) console.log(`PERF ${JSON.stringify(perf)}`);
await browser.close();
process.exit(failed ? 1 : 0);
