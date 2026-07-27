// Tests navigateur des nouvelles fonctionnalités : persistance de la langue,
// filtres (badge, état vide, RTL), écran d'urgence après déclaration
// (incendie FR/AR, électricité, absence pour internet).
// Usage : node tests/features-browser.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 3997;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = 'data/features-browser.db';

let passed = 0, failed = 0;
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// Attente robuste : ré-évalue la condition jusqu'à 6 s (évite les faux échecs de timing).
async function okEventually(pg, fn, label, timeout = 6000) {
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

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const server = spawn('node', ['server.js'], {
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
    BASE_URL: BASE, SANDBOX_ENABLED: '0', VERIFICATION_REQUIRED: '0',
    MIN_FORM_FILL_S: '2', TRUST_PUBLISH_THRESHOLD: '10',
  },
  stdio: 'ignore',
});
// Le serveur est toujours arrêté, même si le script échoue en cours de route
// (sinon un processus orphelin garde le port et fausse les exécutions suivantes).
process.on('exit', () => { try { server.kill(); } catch {} });
await new Promise((r) => setTimeout(r, 1500));
// Base réellement vierge ? (détecte un serveur orphelin d'une exécution précédente)
const boot = await fetch(`${BASE}/api/public/incidents`).then((r) => r.json()).catch(() => null);
if (!boot || boot.count !== 0) {
  console.error(`Port ${PORT} occupé par un serveur périmé ou base non vierge (${boot?.count}). Abandon.`);
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' });
// Choix de consentement déjà fait (la bannière GA est testée par ailleurs).
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('ga_consent', 'denied');
    // Pays déjà choisi : la feuille de sélection ne s'ouvre pas pendant les tests
    // (le scénario de première visite est testé séparément plus bas).
    localStorage.setItem('kifeh_country', 'TN');
  } catch {}
});
// Réseau externe indisponible dans l'environnement de test : les tuiles sont
// coupées immédiatement (exerce au passage la bascule de fournisseurs).
await ctx.route(/tile\.openstreetmap|cartocdn|googletagmanager|google-analytics/, (r) => r.abort());
const page = await ctx.newPage();

// ── 1. Persistance de la langue ─────────────────────────────────────────────
console.log('\n■ Persistance de la langue arabe');
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForTimeout(500);
await page.click('.lang-switch');
await page.waitForTimeout(1000);
ok(await page.evaluate(() => document.documentElement.dir) === 'rtl', 'passage en arabe → RTL');
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
ok(await page.evaluate(() => document.documentElement.dir) === 'rtl', 'arabe conservé après rafraîchissement');
const p2 = await ctx.newPage();
await p2.goto(`${BASE}/declare.html`, { waitUntil: 'load' });
await p2.waitForTimeout(500);
ok(await p2.evaluate(() => document.documentElement.dir) === 'rtl', 'arabe conservé sur une nouvelle page (declare)');
ok(await p2.evaluate(() => document.documentElement.lang) === 'ar', 'attribut lang=ar au niveau du document');
await p2.close();
// cookie de secours présent
ok(await page.evaluate(() => document.cookie.includes('kifeh_lang=ar')), 'cookie de secours kifeh_lang posé');
// retour au français
await page.click('.lang-switch');
await page.waitForTimeout(1000);
ok(await page.evaluate(() => document.documentElement.dir) === 'ltr', 'retour au français → LTR complet');

// ── 2. Filtres ──────────────────────────────────────────────────────────────
console.log('\n■ Filtres (badge, état vide, cohérence)');
await page.click('#chipFilters');
await page.waitForTimeout(300);
ok(await page.isVisible('#filterSheet.open'), 'feuille de filtres ouverte');
await page.check('.fType[value="fire"]');
await page.selectOption('#fPeriod', '1');
await page.click('#filterApply');
await okEventually(page, () => document.getElementById('filterBadge').textContent === '2', 'badge : 2 filtres actifs');
await okEventually(page, () => document.getElementById('counter').textContent.includes('Aucun incident ne correspond'),
  'état vide : « Aucun incident ne correspond à ces filtres. »');
ok(await page.evaluate(() => document.querySelector('.chip[data-type="fire"]').getAttribute('aria-pressed')) === 'true',
  'puce type synchronisée avec la feuille de filtres');
await page.click('#chipFilters');
await page.waitForTimeout(300);
await page.click('#filterReset');
await page.waitForTimeout(500);
ok(await page.evaluate(() => document.getElementById('filterBadge').hidden), 'réinitialisation : badge masqué');

// ── 3. Déclaration incendie → écran d'urgence ───────────────────────────────
console.log('\n■ Écran d’urgence après déclaration');
async function declare(pg, type) {
  await pg.goto(`${BASE}/declare.html`, { waitUntil: 'load' });
  await pg.evaluate(() => localStorage.removeItem('incident_draft_v1'));
  await pg.reload({ waitUntil: 'load' });
  await pg.waitForTimeout(400);
  await pg.click(`.type-card[data-type="${type}"]`);
  await pg.waitForTimeout(type === 'fire' ? 1900 : 600);
  // position : clic sur la mini-carte
  await pg.click('#miniMap', { position: { x: 150, y: 130 } });
  await pg.waitForTimeout(800);
  await pg.click('#btnLocationNext');
  await pg.waitForTimeout(300);
  await pg.click('#btnNow');
  await pg.click('#btnTimeNext');
  await pg.waitForTimeout(300);
  await pg.fill('#descInput', `Test ${type} ${Math.random().toString(36).slice(2, 7)}`);
  await pg.waitForTimeout(1200); // délai minimal de remplissage
  await pg.click('#btnDetailsNext');
  await pg.waitForTimeout(1500);
  // éventuel écran de doublon
  if (await pg.isVisible('#stepDup')) { await pg.click('#btnDupNew'); await pg.waitForTimeout(1500); }
}

const pf = await ctx.newPage();
await pf.goto(`${BASE}/`, { waitUntil: 'load' });
await declare(pf, 'fire');
ok(await pf.isVisible('#stepDone'), 'déclaration incendie publiée (écran final)');
await okEventually(pf, () => document.getElementById('emergencyPanel').innerHTML.includes('tel:'), 'panneau d’urgence chargé');
const panel = await pf.evaluate(() => document.getElementById('emergencyPanel').innerHTML);
ok(panel.includes('tel:198'), 'bouton Protection civile — tel:198 présent');
ok(panel.includes('tel:190') && panel.includes('tel:197') && panel.includes('tel:193'),
  'SAMU 190, Police 197, Garde nationale 193 présents');
ok(panel.includes('198') && panel.includes('éloignez-vous'), 'message de sécurité incendie affiché');
const panelFirst = await pf.evaluate(() => {
  const done = document.getElementById('stepDone');
  const ep = document.getElementById('emergencyPanel');
  return done.firstElementChild === ep && ep.innerHTML.length > 0;
});
ok(panelFirst, 'panneau d’urgence affiché AVANT le message de succès');
const primaryVisible = await pf.evaluate(() => {
  const b = document.querySelector('.call-primary');
  if (!b) return false;
  const r = b.getBoundingClientRect();
  return r.top >= 0 && r.top < window.innerHeight;
});
ok(primaryVisible, 'appel principal (198) visible sans défilement sur mobile');

// électricité : STEG, pas de panneau 198 (gravité modérée)
await declare(pf, 'electricity');
await okEventually(pf, () => document.getElementById('emergencyPanel').innerHTML.includes('tel:'), 'panneau STEG chargé');
const panelE = await pf.evaluate(() => document.getElementById('emergencyPanel').innerHTML);
ok(panelE.includes('tel:80100444'), 'électricité : urgences STEG 80 100 444');
ok(panelE.includes('tel:+21671239222'), 'électricité : STEG 71 239 222');
ok(!panelE.includes('tel:198'), 'électricité (gravité modérée) : pas de numéro d’urgence 198');
ok(panelE.includes('STEG'), 'note « non transmis automatiquement à la STEG »');

// internet : aucun panneau d'urgence
await declare(pf, 'internet');
await pf.waitForTimeout(600);
ok(await pf.evaluate(() => document.getElementById('emergencyPanel').innerHTML === ''),
  'internet : pas de panneau d’urgence');

// incendie en arabe : panneau RTL en arabe
await pf.evaluate(() => localStorage.setItem('lang', 'ar'));
await declare(pf, 'fire');
await okEventually(pf, () => {
  const h = document.getElementById('emergencyPanel').innerHTML;
  return h.includes('tel:198') && h.includes('الحماية المدنية');
}, 'arabe : الحماية المدنية — tel:198');
await okEventually(pf, () => document.getElementById('emergencyPanel').innerHTML.includes('ابتعد عن المكان'),
  'arabe : message de sécurité affiché');
ok(await pf.evaluate(() => document.documentElement.dir) === 'rtl', 'arabe : rendu RTL');
await pf.evaluate(() => localStorage.setItem('lang', 'fr'));

// ── 4. Détail : confirmation + état persistant ──────────────────────────────
console.log('\n■ Détail : « Je suis aussi concerné »');
await page.bringToFront();
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1000);
// ouvre le premier incident via l'API pour obtenir un identifiant
const pubId = await page.evaluate(async () => {
  const r = await fetch('/api/public/incidents').then((x) => x.json());
  return r.incidents[0]?.public_id;
});
ok(Boolean(pubId), 'incident disponible sur la carte');
await page.goto(`${BASE}/?incident=${pubId}`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
ok(await page.isVisible('#detailSheet.open'), 'fiche de détail ouverte');
if (await page.isVisible('#btnConfirm')) {
  await page.click('#btnConfirm');
  await page.waitForTimeout(5000); // la géolocalisation facultative peut prendre jusqu'à 4 s
  const zone = await page.evaluate(() => document.getElementById('confirmZone').textContent);
  ok(zone.includes('Vous avez confirmé'), 'après clic : « Vous avez confirmé cet incident »');
  await page.reload({ waitUntil: 'load' });
  await page.goto(`${BASE}/?incident=${pubId}`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const zone2 = await page.evaluate(() => document.getElementById('confirmZone').textContent);
  ok(zone2.includes('Vous avez confirmé'), 'état « confirmé » conservé après rafraîchissement');
} else {
  ok(false, 'bouton de confirmation absent');
  ok(false, 'état confirmé non vérifiable');
}
ok(await page.isVisible('#btnEnded'), 'action « C’est terminé » visible');
ok(await page.isVisible('#btnLocCorrect'), 'action de correction de localisation visible');

// ── Régressions d'audit (320 px + clarté du parcours) ──────────────────────
console.log('\n■ Régressions d’audit');
const tiny = await ctx.newPage();
await tiny.setViewportSize({ width: 320, height: 568 });
await tiny.goto(`${BASE}/`, { waitUntil: 'load' });
await tiny.waitForTimeout(900);
await tiny.click('#chipFilters');
await tiny.waitForTimeout(700);
// Appliquer/Réinitialiser : visibles SANS défiler (actions collantes).
const applyVisible = await tiny.evaluate(() => {
  const r = document.getElementById('filterApply').getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight + 1 && r.height >= 40;
});
ok(applyVisible, '320px : « Appliquer » visible sans défiler (actions collantes)');
// Déclaration : « Étape 1 sur 4 » quand la vérification est désactivée.
await tiny.goto(`${BASE}/declare.html`, { waitUntil: 'load' });
await tiny.waitForTimeout(900);
const hint = await tiny.evaluate(() => document.getElementById('stepHint').textContent);
ok(/sur 4/.test(hint), `déclaration : compteur d'étapes réel (« ${hint} »)`);
const visibleSegs = await tiny.evaluate(() => [...document.querySelectorAll('#progressBar span')].filter((s) => !s.hidden).length);
ok(visibleSegs === 4, `barre de progression à 4 segments (${visibleSegs})`);
await tiny.close();

// ── Multi-pays : première visite, persistance, indépendance pays/langue ─────
console.log('\n■ Multi-pays (sélection, persistance, France en arabe)');
// Contexte NEUF sans pays mémorisé : la feuille de choix se propose.
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' });
await ctx2.addInitScript(() => { try { localStorage.setItem('ga_consent', 'denied'); } catch {} });
const pc = await ctx2.newPage();
await pc.route(/tile\.openstreetmap|cartocdn|googletagmanager|google-analytics/, (r) => r.abort());
await pc.goto(`${BASE}/`, { waitUntil: 'load' });
await okEventually(pc, () => document.getElementById('countrySheet')?.classList.contains('open'),
  'première visite : la feuille « Dans quel pays… » s’ouvre');
ok(await pc.evaluate(() => !document.getElementById('countryFR').hidden), 'option France proposée');
await pc.click('#countryFR'); // choisit la France → rechargement
await pc.waitForTimeout(1500);
await okEventually(pc, () => localStorage.getItem('kifeh_country') === 'FR', 'choix France mémorisé');
await okEventually(pc, () => document.getElementById('countrySwitch').textContent.includes('France'),
  'bouton d’en-tête : France');
// Le choix persiste après rechargement.
await pc.reload({ waitUntil: 'load' });
await okEventually(pc, () => localStorage.getItem('kifeh_country') === 'FR',
  'pays conservé après rechargement');
// Indépendance pays/langue : la France se consulte en arabe, rendu RTL.
await pc.evaluate(() => localStorage.setItem('lang', 'ar'));
await pc.reload({ waitUntil: 'load' });
await pc.waitForTimeout(900);
ok(await pc.evaluate(() => document.documentElement.dir) === 'rtl', 'France en arabe : rendu RTL');
await okEventually(pc, () => document.getElementById('countrySwitch').textContent.includes('فرنسا'),
  'bouton pays affiché en arabe (فرنسا)');
ok(await pc.evaluate(() => localStorage.getItem('kifeh_country')) === 'FR',
  'changer de langue ne change pas le pays');
await ctx2.close();

await browser.close();
server.kill();
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
console.log('\n────────────────────────────');
console.log(`${passed} réussis · ${failed} échoués`);
process.exit(failed ? 1 : 0);
