// Audit d'accessibilité WCAG 2.2 AA (#95) — outil d'AUDIT, hors chaîne CI.
// Usage : node tests/a11y-audit.mjs
// Scanne les vues clés (accueil fr/ar, panneaux ouverts, déclaration, safety)
// avec axe-core + mesures maison (cibles tactiles, focus visible, ordre de
// tabulation). Sortie : docs/audit/a11y-results.json (brut, trié) — le rapport
// lisible vit dans docs/ACCESSIBILITY_AUDIT.md.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 3941;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = 'data/a11y-audit.db';
const AXE = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const server = spawn('node', ['server.js'], {
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
    BASE_URL: BASE, SANDBOX_ENABLED: '0', VERIFICATION_REQUIRED: '0',
  },
  stdio: 'ignore',
});
process.on('exit', () => { try { server.kill(); } catch {} });
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  .catch(() => chromium.launch({ args: ['--no-sandbox'] }));

const initFor = (lang) => () => {
  try {
    localStorage.setItem('lang', lang === 'ar' ? 'ar' : 'fr');
    localStorage.setItem('kifeh_onboarded', '1');
    localStorage.setItem('kifeh_country', 'TN');
    localStorage.setItem('kifeh_visits', '3');
    localStorage.setItem('kifeh_weather_layer', '0');
  } catch {}
};

// Vues auditées : chemin + action d'ouverture éventuelle (panneau, fiche).
const VIEWS = [
  { id: 'home-fr', lang: 'fr', url: '/', act: null },
  { id: 'home-ar-rtl', lang: 'ar', url: '/', act: null },
  { id: 'filtres-ouverts', lang: 'fr', url: '/', act: async (pg) => { await pg.click('#chipFilters').catch(() => {}); await pg.waitForTimeout(600); } },
  { id: 'calques-ouverts', lang: 'fr', url: '/', act: async (pg) => { await pg.click('#btnLayers').catch(() => {}); await pg.waitForTimeout(600); } },
  { id: 'situation', lang: 'fr', url: '/', act: async (pg) => { await pg.click('#navSituation').catch(() => {}); await pg.waitForTimeout(900); } },
  { id: 'declaration', lang: 'fr', url: '/declare.html', act: null },
  { id: 'safety', lang: 'fr', url: '/safety.html', act: null },
];

const results = {};
for (const v of VIEWS) {
  // bypassCSP : l'outil d'audit injecte axe-core dans la page — la CSP de
  // production (script-src 'self') resterait sinon dans le chemin. Audit
  // uniquement : jamais utilisé dans la chaîne de tests fonctionnels.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, bypassCSP: true });
  await ctx.addInitScript(initFor(v.lang));
  const pg = await ctx.newPage();
  await pg.route(/tile\.openstreetmap\.org|cartocdn\.com/, (r) => r.abort());
  const nav = await pg.goto(`${BASE}${v.url}`, { waitUntil: 'load', timeout: 20000 }).catch(() => null);
  if (!nav) { results[v.id] = { error: 'page absente' }; await ctx.close(); continue; }
  await pg.waitForTimeout(1200);
  if (v.act) await v.act(pg);

  // 1) axe-core — WCAG 2.x A/AA, éléments VISIBLES uniquement.
  await pg.addScriptTag({ content: AXE });
  const axe = await pg.evaluate(async () => {
    const r = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    });
    return r.violations.map((x) => ({
      id: x.id, impact: x.impact, help: x.help, wcag: x.tags.filter((t) => /^wcag\d/.test(t)),
      nodes: x.nodes.slice(0, 6).map((n) => n.target.join(' ')),
      count: x.nodes.length,
    }));
  }).catch((e) => [{ id: 'axe-crash', help: String(e).slice(0, 120) }]);

  // 2) Cibles tactiles < 44×44 px (WCAG 2.5.8 : minimum 24, recommandé 44).
  const targets = await pg.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('button, a, input, [role="button"], .chip, .fab')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // invisible
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') continue;
      if (r.width < 24 || r.height < 24) {
        bad.push({ sel: (el.id ? `#${el.id}` : el.className?.toString().slice(0, 40)) || el.tagName, w: Math.round(r.width), h: Math.round(r.height), sev: 'bloquant-2.5.8' });
      } else if (r.width < 44 || r.height < 44) {
        bad.push({ sel: (el.id ? `#${el.id}` : el.className?.toString().slice(0, 40)) || el.tagName, w: Math.round(r.width), h: Math.round(r.height), sev: 'sous-44px' });
      }
    }
    return bad.slice(0, 25);
  });

  // 3) Focus visible : les 12 premiers éléments tabbables ont-ils un indicateur ?
  const focus = await pg.evaluate(() => {
    const out = [];
    const els = [...document.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .slice(0, 12);
    for (const el of els) {
      el.focus();
      const s = getComputedStyle(el);
      const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0)
        || s.boxShadow !== 'none';
      if (!visible) out.push((el.id ? `#${el.id}` : el.className?.toString().slice(0, 40)) || el.tagName);
    }
    return out;
  });

  results[v.id] = { axe, targets, focusInvisible: focus };
  await ctx.close();
}

fs.mkdirSync('docs/audit', { recursive: true });
fs.writeFileSync('docs/audit/a11y-results.json', JSON.stringify(results, null, 2));
let tot = 0;
for (const [id, r] of Object.entries(results)) {
  const nAxe = r.axe?.reduce((s, x) => s + (x.count || 1), 0) || 0;
  console.log(`■ ${id} : ${r.axe?.length ?? '?'} règles axe en échec (${nAxe} nœuds) · ${r.targets?.length ?? 0} cibles <44px · ${r.focusInvisible?.length ?? 0} focus invisibles`);
  for (const x of r.axe || []) console.log(`   axe ${x.impact || '?'} — ${x.id} ×${x.count}: ${x.help}`);
  tot += (r.axe?.length || 0);
}
console.log(`\nTotal règles en échec (toutes vues) : ${tot} — détail docs/audit/a11y-results.json`);
await browser.close();
process.exit(0);
