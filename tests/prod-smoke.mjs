// Smoke test de PRODUCTION — lecture seule, exécuté par GitHub Actions.
// Répond à la vraie question : « une personne réelle peut-elle ouvrir Kifeh
// et accomplir ses actions essentielles MAINTENANT ? » (/healthz prouve que
// le serveur vit, pas que l'interface fonctionne — audit du 28/07/2026).
//
// RÈGLE ABSOLUE : AUCUNE écriture (pas de déclaration, pas d'abonnement,
// pas de check-in) — uniquement navigation, panneaux et lectures GET.
// Usage : PROD_URL=https://kifeh.app node tests/prod-smoke.mjs
import { chromium } from 'playwright';

const BASE = (process.env.PROD_URL || 'https://kifeh.app').replace(/\/$/, '');
let passed = 0, failed = 0;
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// SwiftShader : les runners CI n'ont pas de GPU — l'étape moteur GL (§9)
// exige un WebGL logiciel fonctionnel.
const LAUNCH_ARGS = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ args: LAUNCH_ARGS })
  .catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: LAUNCH_ARGS }));
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' });
const page = await ctx.newPage();
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(String(e).slice(0, 200)));

// ── 1. Chargement ───────────────────────────────────────────────────────────
console.log(`\n■ Parcours réels sur ${BASE}`);
await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 45_000 });
await page.waitForTimeout(2500);
// Première visite dans un navigateur neuf : onboarding puis pays.
try { await page.locator('#obGo').click({ timeout: 2000 }); } catch {}
try { await page.locator('#countryFR').click({ timeout: 2500 }); await page.waitForTimeout(1800); } catch {}
try { await page.locator('.consent-refuse').first().click({ timeout: 2500 }); } catch {}
await page.waitForTimeout(800);

ok(jsErrors.length === 0, `aucune erreur JavaScript au chargement${jsErrors.length ? ` (${jsErrors[0]})` : ''}`);
ok(await page.evaluate(() => Boolean(document.querySelector('#map .leaflet-pane'))),
  'la carte Leaflet est initialisée');
ok(await page.evaluate(() => {
  const els = [...document.querySelectorAll('.bottom-nav .nav-item, .bottom-nav .nav-declare')];
  return els.length === 5 && els.every((e) => e.getBoundingClientRect().height > 20);
}), 'navigation : 5 destinations visibles');
ok(await page.evaluate(() => (document.getElementById('counter')?.textContent || '').trim().length > 0),
  'la situation (compteur) est renseignée');

// ── 2. Panneau Situation ────────────────────────────────────────────────────
await page.locator('#navSituation').click();
await page.waitForTimeout(900);
ok(await page.evaluate(() => document.getElementById('situationSheet').classList.contains('open')
  && document.getElementById('situationBody').textContent.length > 10),
'panneau Situation : s’ouvre avec du contenu');

// ── 3. Couches : ouverture, sources affichées, fermeture ────────────────────
await page.locator('#navMap').click();
await page.waitForTimeout(500);
await page.locator('#btnLayers').click();
await page.waitForTimeout(700);
ok(await page.evaluate(() => document.getElementById('layersSheet').classList.contains('open')),
  'panneau Couches : s’ouvre');
ok(await page.evaluate(() => [...document.querySelectorAll('#layersSheet .layer-src')]
  .filter((p) => !p.hidden).every((p) => p.textContent.length > 4)),
'chaque couche visible affiche sa source');
await page.locator('#navMap').click();
await page.waitForTimeout(400);
ok(await page.evaluate(() => !document.querySelector('.sheet.open')), 'panneau Couches : se referme');

// ── 4. Langue arabe (RTL) ───────────────────────────────────────────────────
await page.evaluate(() => localStorage.setItem('lang', 'ar'));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2000);
ok(await page.evaluate(() => document.documentElement.dir === 'rtl'), 'bascule arabe : rendu RTL');
await page.evaluate(() => localStorage.setItem('lang', 'fr'));

// ── 5. Données publiques (GET uniquement) ───────────────────────────────────
const api = async (path) => {
  try { const r = await fetch(`${BASE}${path}`); return { status: r.status, data: await r.json() }; }
  catch { return { status: 0, data: null }; }
};
const inc = await api('/api/public/incidents?minLat=41&maxLat=51.5&minLng=-5.5&maxLng=10&country=FR');
ok(inc.status === 200 && Array.isArray(inc.data.incidents), 'API incidents : répond avec une liste');
const hz = await api('/healthz');
ok(hz.status === 200 && hz.data.ok === true, 'healthz : ok');

// ── 6. Formulaire de signalement disponible (SANS déclarer) ─────────────────
await page.goto(`${BASE}/declare.html`, { waitUntil: 'load' });
await page.waitForTimeout(1500);
ok(await page.evaluate(() => document.querySelectorAll('.type-card').length >= 4),
  'déclaration : les 4 types d’incident sont proposés');
ok(jsErrors.length === 0, 'déclaration : aucune erreur JavaScript');

// ── 7. PWA : manifest + service worker servis ───────────────────────────────
const mf = await fetch(`${BASE}/site.webmanifest`);
ok(mf.status === 200, 'manifest PWA servi');
const sw = await fetch(`${BASE}/sw.js`);
ok(sw.status === 200 && (await sw.text()).includes('SHELL_CACHE'), 'service worker servi (cache du shell)');

// ── 8. Aucun chevauchement des commandes principales ────────────────────────
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForTimeout(2000);
ok(await page.evaluate(() => {
  const get = (sel) => {
    const el = document.querySelector(sel);
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return r.width && r.height ? r : null;
  };
  const a = get('#counter'), b = get('.bottom-nav');
  if (!a || !b) return false;
  return a.bottom <= b.top + 2; // la situation vit AU-DESSUS de la navigation
}), 'aucun chevauchement situation/navigation');

// ── 9. Moteur GL en BAC À SABLE (#122, étape 1) — lecture seule ─────────────
// Le sandbox (/sandbox) a le drapeau allumé : on vérifie ICI, sur la vraie
// infrastructure (CSP réelle, worker blob:, tuiles réelles), que le moteur
// s'active et que son style est COMPLET — ou qu'il se replie proprement.
// C'est le feu vert (ou rouge) de l'étape « pourcentage de sessions ».
{
  const sbxCfg = await fetch(`${BASE}/sandbox/api/public/config`).then((r) => r.json()).catch(() => null);
  if (sbxCfg?.fireMapLibre === true) {
    const pgGl = await ctx.newPage();
    const cspErr = [];
    pgGl.on('console', (m) => {
      if (/Refused to create a worker|Content Security Policy/i.test(m.text())) cspErr.push(m.text().slice(0, 140));
    });
    await pgGl.goto(`${BASE}/sandbox/?glshot=1&lat=44.5&lng=-0.6&z=8`, { waitUntil: 'load' });
    await pgGl.waitForTimeout(2500);
    await pgGl.click('.chip[data-type="fire"]').catch(() => {});
    let stGl = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      stGl = await pgGl.evaluate(() => window.kifehGLState?.()).catch(() => null);
      if (stGl && (stGl.failed || (stGl.active && stGl.styleComplete))) break;
      await pgGl.waitForTimeout(500);
    }
    ok(Boolean(stGl && (stGl.failed || (stGl.active && stGl.styleComplete))),
      `sandbox GL : moteur ACTIF au style complet ou repli propre (${JSON.stringify(stGl)})`);
    ok(cspErr.length === 0, `sandbox GL : aucune erreur CSP/worker (${cspErr.join(' | ') || 'aucune'})`);
    // En conditions réelles le repli n'est acceptable QUE faute de WebGL.
    if (stGl?.failed) ok(['webgl', 'webgl_lost', 'init'].some((r) => String(stGl.reason).includes(r)),
      `sandbox GL : repli pour cause matérielle uniquement (raison: ${stGl.reason})`);
    await pgGl.close();
  } else {
    console.log('  · sandbox GL éteint ou injoignable : étape ignorée');
  }
}

await browser.close();
console.log('\n────────────────────────────');
console.log(`${passed} réussis · ${failed} échoués`);
process.exit(failed ? 1 : 0);
