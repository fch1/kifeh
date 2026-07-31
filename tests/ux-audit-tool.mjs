// Audit UX réel (#100 — REFONTE PR 1) : 9 largeurs × FR + 3 × AR.
// Mesures OBJECTIVES par vue : % de la carte recouverte par les surfaces
// flottantes, débordement horizontal, inventaire des overlays visibles.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';

const PORT = 3958, BASE = `http://localhost:${PORT}`, DB = 'data/uxaudit.db';
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const server = spawn('node', ['server.js'], {
  env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
    SANDBOX_ENABLED: '0', WIND_URL: 'http://127.0.0.1:9', EFFIS_URL: '',
    ROADS_URL: 'http://127.0.0.1:9', AIR_URL: 'http://127.0.0.1:9', WEB_PUSH_DISABLED: '1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
process.on('exit', () => { try { server.kill(); } catch {} });
for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/healthz`); break; } catch { await new Promise(r => setTimeout(r, 400)); } }

const SIZES = [[320,568],[360,640],[375,667],[390,844],[768,1024],[1024,768],[1280,800],[1440,900],[1920,1080]];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  .catch(() => chromium.launch({ args: ['--no-sandbox'] }));
const results = [];
async function audit(lang, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-TN' : 'fr-FR', reducedMotion: 'reduce' });
  await ctx.addInitScript(([l]) => { localStorage.setItem('lang', l); localStorage.setItem('kifeh_onboarded','1'); localStorage.setItem('kifeh_country','FR'); localStorage.setItem('ga_consent','denied'); }, [lang]);
  const p = await ctx.newPage();
  await p.route(/tile\.|cartocdn|googletagmanager/, r => r.abort());
  await p.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1400);
  await p.addStyleTag({ content: '.map-banner{display:none!important}' });
  const m = await p.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const mapEl = document.getElementById('map');
    const mr = mapEl ? mapEl.getBoundingClientRect() : { left:0, top:0, right:vw, bottom:vh };
    // Surfaces au-dessus de la carte : éléments fixed/absolute visibles.
    const overlays = [];
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if ((cs.position === 'fixed' || cs.position === 'absolute') && cs.display !== 'none' && cs.visibility !== 'hidden') {
        const r = el.getBoundingClientRect();
        if (r.width > 40 && r.height > 24 && r.bottom > 0 && r.top < vh && !el.closest('#map')) {
          overlays.push({ id: el.id || el.className.toString().split(' ')[0] || el.tagName, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
        }
      }
    }
    // % carte recouverte : grille d'échantillonnage 40×30 sur la zone carte.
    const els = overlays.map(o => o); let covered = 0, total = 0;
    for (let gx = 0; gx < 40; gx++) for (let gy = 0; gy < 30; gy++) {
      const x = mr.left + (gx + .5) * (mr.right - mr.left) / 40;
      const y = mr.top + (gy + .5) * (mr.bottom - mr.top) / 30;
      if (x < 0 || y < 0 || x > vw || y > vh) continue;
      total++;
      const t = document.elementFromPoint(x, y);
      if (t && !t.closest('#map')) covered++;
    }
    const searchEl = document.querySelector('#addr, #searchInput, input[type=search], .search input, #q');
    const sr = searchEl ? searchEl.getBoundingClientRect() : null;
    return {
      overlays: overlays.slice(0, 25),
      overlayCount: overlays.length,
      mapCoveredPct: total ? Math.round(100 * covered / total) : null,
      hScroll: document.documentElement.scrollWidth > vw + 1,
      searchWidthPct: sr ? Math.round(100 * sr.width / vw) : null,
      heroVisible: Boolean(document.getElementById('counter')?.offsetParent),
    };
  });
  const name = `${lang}-${w}x${h}.png`;
  await p.screenshot({ path: `docs/audit/${name}` });
  results.push({ lang, w, h, ...m, shot: name });
  await ctx.close();
  console.log(`${lang} ${w}×${h} → carte recouverte ${m.mapCoveredPct}% · overlays ${m.overlayCount} · recherche ${m.searchWidthPct}% · hscroll ${m.hScroll}`);
}
for (const [w, h] of SIZES) await audit('fr', w, h);
for (const [w, h] of [[375,667],[768,1024],[1440,900]]) await audit('ar', w, h);
fs.writeFileSync('docs/audit/metrics.json', JSON.stringify(results, null, 2));
await browser.close();
try { server.kill(); } catch {}
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
console.log('AUDIT_OK');
