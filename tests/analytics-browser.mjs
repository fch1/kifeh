// Test navigateur du PLAN DE MESURE (addendum growth) : les événements
// canoniques partent au bon moment, les paramètres globaux sont attachés,
// la boucle de retour est détectée, et AUCUNE donnée sensible ne transite.
// S'appuie sur window.__trackLog (rempli même consentement refusé — aucune
// donnée n'est envoyée à GA sans accord ; le journal reste dans l'onglet).
// Usage : node tests/analytics-browser.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';

const PORT = 3965;
const BASE = `http://localhost:${PORT}`;
const DB = 'data/analytics-test.db';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const server = spawn('node', ['server.js'], {
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
    BASE_URL: BASE, ADMIN_PASSWORD: 'test-admin-password-1', SANDBOX_ENABLED: '0',
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

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  .catch(() => chromium.launch({ args: ['--no-sandbox'] }));
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('lang', 'fr');
    localStorage.setItem('kifeh_onboarded', '1');
    localStorage.setItem('kifeh_country', 'FR');
    localStorage.setItem('ga_consent', 'denied'); // le journal doit vivre MÊME sans consentement
  } catch {}
});
const page = await ctx.newPage();
await page.route(/tile\.openstreetmap|cartocdn|googletagmanager/, (r) => r.abort());

console.log('\n■ Boucle de retour + situation locale');
await page.goto(`${BASE}/?src=push`, { waitUntil: 'load', timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(2500);
const log1 = await page.evaluate(() => window.__trackLog || []);
const names = (l) => l.map((e) => e.event);
ok(names(log1).includes('return_after_alert'), 'src=push → return_after_alert');
ok(log1.find((e) => e.event === 'return_after_alert')?.params?.alert_channel === 'push', 'canal push attaché');
ok(names(log1).includes('local_situation_displayed'), 'local_situation_displayed au rendu du résumé');
const withGlobals = log1.find((e) => e.event === 'local_situation_displayed');
ok(withGlobals?.params?.selected_country === 'FR' && withGlobals?.params?.interface_language === 'fr',
  'paramètres globaux pays + langue séparés (jamais fusionnés)');

console.log('\n■ Canonisation des noms historiques');
await page.evaluate(() => { window.track('follow_sheet_opened', {}); window.track('zone_alerts_enabled', { radius_km: 10 }); });
const log2 = await page.evaluate(() => window.__trackLog);
ok(names(log2).includes('zone_follow_started'), 'follow_sheet_opened → zone_follow_started');
const acs = log2.find((e) => e.event === 'alert_channel_selected');
ok(acs && acs.params.alert_channel === 'push' && acs.params.radius_km === 10,
  'zone_alerts_enabled → alert_channel_selected {alert_channel: push}');

console.log('\n■ Funnel : panneau sources, suivi, signalement');
try { await page.locator('#btnLayers').click({ timeout: 4000 }); await page.waitForTimeout(400); } catch {}
const log3 = await page.evaluate(() => window.__trackLog);
ok(names(log3).includes('source_panel_opened'), 'ouverture des calques → source_panel_opened');
await page.goto(`${BASE}/declare.html`, { waitUntil: 'load', timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(1200);
try { await page.evaluate(() => localStorage.removeItem('kifeh_declare_draft')); } catch {}
try {
  await page.locator('[data-type="fire"], #typeFire, button:has-text("Incendie")').first().click({ timeout: 4000 });
  await page.waitForTimeout(500);
} catch {}
const log4 = await page.evaluate(() => window.__trackLog);
ok(names(log4).includes('incident_report_started'), 'déclaration entamée → incident_report_started');

console.log('\n■ Rétention : « Depuis votre dernière visite » (delta honnête)');
await ctx.addInitScript(() => {
  try { localStorage.setItem('kifeh_last_visit_at', new Date(Date.now() - 24 * 3600_000).toISOString()); } catch {}
});
await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(2500);
const log5 = await page.evaluate(() => window.__trackLog || []);
const slvEvt = log5.find((e) => e.event === 'since_last_visit_displayed');
ok(Boolean(slvEvt), 'événement since_last_visit_displayed émis (dernière visite il y a 24 h)');
ok(slvEvt?.params?.has_news === false, 'état vide HONNÊTE : has_news=false sur base vierge');
try { await page.locator('#navSituation').click({ timeout: 4000 }); await page.waitForTimeout(600); } catch {}
const slvText = await page.evaluate(() => document.getElementById('slvBlock')?.textContent || '');
ok(slvText.includes('Depuis votre dernière visite') && slvText.includes('Aucune nouvelle information'),
  'bloc affiché dans Situation avec l’état vide (jamais un compteur gonflé)');
const pwaEligible = await page.evaluate(() => {
  localStorage.setItem('kifeh_pwa_eligible', '1');
  return localStorage.getItem('kifeh_pwa_eligible') === '1';
});
ok(pwaEligible, 'éligibilité PWA contextuelle posable (zone suivie / retour d’alerte)');

console.log('\n■ Vie privée : AUCUNE donnée sensible dans le journal');
const all = await page.evaluate(() => JSON.stringify(window.__trackLog));
ok(!/lat["':]|lng["':]|latitude|longitude/i.test(all), 'aucune coordonnée dans les événements');
ok(!/@|phone|tel["':]/.test(all.replace(/alert_channel/g, '')), 'aucun contact dans les événements');
ok(!/[A-Z]{2}[0-9]{2}[A-Z][0-9]/.test(all), 'aucun code DFCI dans les événements');

await browser.close();
try { server.kill(); } catch {}
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
console.log(`\n═══ Mesure : ${passed} réussis, ${failed} échoués ═══`);
process.exit(failed > 0 ? 1 : 0);
