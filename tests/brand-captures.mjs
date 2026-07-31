// Non-régression de MARQUE (addendum §24) : captures de référence de
// l'interface aux largeurs 320 / 375 / 768 / 1280 / 1440 px, en français ET
// en arabe (RTL), comparées pixel à pixel (sharp — déjà en dépendance).
//
//   node tests/brand-captures.mjs            # compare aux références
//   node tests/brand-captures.mjs --update   # (ré)génère les références
//
// Déterminisme : base vierge, intégrations sur ports fermés (aucune donnée
// variable), tuiles de carte BLOQUÉES (le fond réseau varie ; la marque vit
// dans l'interface), animations coupées. Toute évolution volontaire du design
// system se fait par --update + PR documentant raison/portée/impact.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const PORT = 3966;
const BASE = `http://localhost:${PORT}`;
const DB = 'data/brand-test.db';
const REF_DIR = 'tests/brand-reference';
const UPDATE = process.argv.includes('--update');
const WIDTHS = [320, 375, 768, 1280, 1440];
const LANGS = ['fr', 'ar'];
// Tolérance : 1 % de pixels réellement différents (delta canal > 24) — absorbe
// l'anticrénelage entre exécutions, attrape toute dérive de couleurs/layout.
const PIXEL_DELTA = 24, MAX_DIFF_RATIO = 0.01;

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const server = spawn('node', ['server.js'], {
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
    BASE_URL: BASE, ADMIN_PASSWORD: 'test-admin-password-1', SANDBOX_ENABLED: '0',
    // Aucune donnée variable : toutes les intégrations visent un port fermé.
    WIND_URL: 'http://127.0.0.1:9', EFFIS_URL: '', ROADS_URL: 'http://127.0.0.1:9',
    AIR_URL: 'http://127.0.0.1:9', WEB_PUSH_DISABLED: '1',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
server.stdout.on('data', () => {});
process.on('exit', () => { try { server.kill(); } catch {} });
for (let i = 0; i < 60; i++) {
  try { await fetch(`${BASE}/healthz`); break; }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}

fs.mkdirSync(REF_DIR, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  .catch(() => chromium.launch({ args: ['--no-sandbox'] })); // CI : Chromium Playwright standard

async function capture(lang, width) {
  const ctx = await browser.newContext({
    viewport: { width, height: 820 },
    locale: lang === 'ar' ? 'ar-TN' : 'fr-FR',
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  // Tuiles et ressources externes bloquées : la référence ne dépend d'aucun réseau.
  await page.route(/tile\.openstreetmap|cartocdn|googletagmanager|google-analytics/, (r) => r.abort());
  await page.addInitScript(([l]) => {
    localStorage.setItem('lang', l);
    localStorage.setItem('kifeh_onboarded', '1');
    localStorage.setItem('kifeh_country', 'FR');
    localStorage.setItem('kifeh_visits', '1');
  }, [lang]);
  // JAMAIS networkidle : le flux SSE reste ouvert en permanence (par design).
  await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'load', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  try { await page.locator('.consent-refuse').first().click({ timeout: 1500 }); } catch {}
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
      .leaflet-tile-pane{visibility:hidden!important}
      /* Avis TRANSITOIRES (toasts, bandeaux d'échec réseau) : dépendants du
         timing — exclus des références. La marque vit dans l'interface stable. */
      .map-banner,.map-fallback-note{display:none!important}`,
  });
  await page.waitForTimeout(700);
  const buf = await page.screenshot({ fullPage: false });
  await ctx.close();
  return buf;
}

async function diffRatio(bufA, bufB) {
  const a = sharp(bufA).raw();
  const [ma, mb] = [await a.toBuffer({ resolveWithObject: true }),
    await sharp(bufB).raw().toBuffer({ resolveWithObject: true })];
  if (ma.info.width !== mb.info.width || ma.info.height !== mb.info.height) return 1;
  const A = ma.data, B = mb.data, ch = ma.info.channels;
  let diff = 0;
  const total = ma.info.width * ma.info.height;
  for (let i = 0; i < A.length; i += ch) {
    if (Math.abs(A[i] - B[i]) > PIXEL_DELTA
      || Math.abs(A[i + 1] - B[i + 1]) > PIXEL_DELTA
      || Math.abs(A[i + 2] - B[i + 2]) > PIXEL_DELTA) diff++;
  }
  return diff / total;
}

console.log(`\n■ Non-régression de marque (${UPDATE ? 'MISE À JOUR des références' : 'comparaison'})`);
for (const lang of LANGS) {
  for (const width of WIDTHS) {
    const name = `${lang}-${width}.png`;
    const ref = path.join(REF_DIR, name);
    const shot = await capture(lang, width);
    if (UPDATE || !fs.existsSync(ref)) {
      fs.writeFileSync(ref, shot);
      ok(true, `${name} : référence ${UPDATE ? 'mise à jour' : 'créée'}`);
      continue;
    }
    const ratio = await diffRatio(fs.readFileSync(ref), shot);
    const pct = (ratio * 100).toFixed(2);
    if (ratio > MAX_DIFF_RATIO) {
      fs.writeFileSync(path.join(REF_DIR, `DIVERGENT-${name}`), shot);
      ok(false, `${name} : ${pct}% de pixels divergents (> ${MAX_DIFF_RATIO * 100}%) — capture DIVERGENT-${name} écrite`);
    } else {
      ok(true, `${name} : conforme (${pct}% de divergence)`);
    }
  }
}

await browser.close();
try { server.kill(); } catch {}
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
console.log(`\n═══ Marque : ${passed} conformes, ${failed} divergents ═══`);
process.exit(failed > 0 ? 1 : 0);
