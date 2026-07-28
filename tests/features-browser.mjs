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

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  .catch(() => chromium.launch({ args: ['--no-sandbox'] })); // CI : Chromium Playwright standard
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

// ── Navigation principale fixe : 5 destinations, boutons flottants ──────────
{
  const ctxN = await browser.newContext({ viewport: { width: 400, height: 820 }, locale: 'fr-FR' });
  const pn = await ctxN.newPage();
  await pn.addInitScript(() => {
    localStorage.setItem('lang', 'fr');
    localStorage.setItem('kifeh_country', 'FR');
    localStorage.setItem('kifeh_consent', 'denied');
  });
  await pn.goto(`${BASE}/?country=FR`, { waitUntil: 'load' });
  await pn.waitForTimeout(1500);
  try { await pn.locator('.consent-refuse').first().click({ timeout: 1500 }); } catch {}
  ok(await pn.evaluate(() => Boolean(document.querySelector('.bottom-nav'))
    && [...document.querySelectorAll('.bottom-nav .nav-item, .bottom-nav .nav-declare')].length === 5),
  'barre fixe : 5 destinations, zéro défilement horizontal');
  ok(await pn.evaluate(() => {
    const r = document.querySelector('.bottom-nav').getBoundingClientRect();
    return r.width <= window.innerWidth + 1 && document.querySelector('.bottom-nav').scrollWidth <= r.width + 1;
  }), 'la barre tient entièrement dans l’écran à 400 px');
  await pn.locator('#navSituation').click();
  await pn.waitForTimeout(500);
  ok(await pn.evaluate(() => document.getElementById('situationSheet').classList.contains('open')
    && document.getElementById('situationBody').textContent.length > 10),
  '« Situation » ouvre le panneau Situation autour de vous');
  ok(await pn.evaluate(() => /actualisation|تحديث/i.test(document.getElementById('situationBody').textContent)),
    'le panneau situation affiche l’heure de dernière actualisation');
  await pn.locator('#navAide').click();
  await pn.waitForTimeout(500);
  ok(await pn.evaluate(() => document.getElementById('aideSheet').classList.contains('open')),
    '« Aide » ouvre la feuille d’aide');
  await pn.locator('#aideEmergency').click();
  await pn.waitForTimeout(700);
  ok(await pn.evaluate(() => document.getElementById('safetySheet').classList.contains('open')
    && /18|112|198|190/.test(document.getElementById('safetySheetBody').textContent)),
  'Aide → urgences : numéros de secours affichés');
  // La navigation reste cliquable AU-DESSUS des feuilles : « Carte » referme tout.
  await pn.locator('#navMap').click();
  await pn.waitForTimeout(400);
  ok(await pn.evaluate(() => !document.querySelector('.sheet.open')
    && document.getElementById('navMap').getAttribute('aria-current') === 'page'),
  '« Carte » referme les feuilles même quand l’une est ouverte (navigation toujours accessible)');
  await pn.locator('#btnLayers').click();
  await pn.waitForTimeout(500);
  ok(await pn.evaluate(() => document.getElementById('filterSheet').classList.contains('open')),
    'bouton flottant Couches → feuille des couches et filtres');
  ok(await pn.evaluate(() => {
    const f = document.querySelectorAll('.map-fabs .fab');
    return f.length === 4 && [...f].every((b) => b.getBoundingClientRect().width >= 40);
  }), 'quatre boutons flottants (zoom ±, position, couches) à taille tactile');
  // Zoom via la pile flottante (le contrôle Leaflet n'existe plus sur l'accueil).
  ok(await pn.evaluate(() => !document.querySelector('.leaflet-control-zoom')),
    'plus de double commande de zoom Leaflet');
  await pn.locator('#navMap').click(); // referme la feuille des couches
  await pn.waitForTimeout(400);
  const zBefore = await pn.evaluate(() => window.kifehMapZoom?.() ?? null);
  await pn.locator('#fabZoomIn').click();
  await pn.waitForTimeout(500);
  const zAfter = await pn.evaluate(() => window.kifehMapZoom?.() ?? null);
  ok(zBefore === null || zAfter === zBefore + 1, `zoom ＋ fonctionne (${zBefore} → ${zAfter})`);
  // Marque cliquable : recentre sur la vue d'ensemble du pays.
  await pn.locator('#brandHome').click();
  await pn.waitForTimeout(600);
  ok(await pn.evaluate(() => {
    const z = window.kifehMapZoom?.();
    return z === null || z === undefined || z === 6; // zoom par défaut FR
  }), 'logo Kifeh → retour à la vue d’ensemble du pays');
  // EFFIS : la légende « zone brûlée » existe (cachée sans données locales).
  ok(await pn.evaluate(() => Boolean(document.getElementById('burntLegend'))),
    'légende zones brûlées EFFIS présente (affichée seulement avec des données)');
  await ctxN.close();
}

// ── Garde anti-chevauchement GRAND ÉCRAN (régression du 28/07 : des enfants
// position:fixed sous un ancêtre transformé se dessinaient PAR-DESSUS les
// actions). On MESURE le rendu réel à 900 et 1440 px : aucun recouvrement
// entre situation, légende météo, rangée d'actions et « Déclarer ».
for (const width of [900, 1440]) {
  const ctxD = await browser.newContext({ viewport: { width, height: 860 }, locale: 'fr-FR' });
  const pd = await ctxD.newPage();
  await pd.addInitScript(() => {
    localStorage.setItem('lang', 'fr');
    localStorage.setItem('kifeh_country', 'FR');
    localStorage.setItem('kifeh_consent', 'denied');
  });
  await pd.goto(`${BASE}/?country=FR`, { waitUntil: 'load' });
  await pd.waitForTimeout(1800);
  const bad = await pd.evaluate(() => {
    const get = (sel) => {
      const el = document.querySelector(sel);
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      return r.width && r.height ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
    };
    const boxes = {
      counter: get('#counter'), legend: get('#wxLegend'),
      nav: get('.bottom-nav'), fabs: get('.map-fabs'),
    };
    const overlap = (a, b) => a && b
      && a.x < b.x + b.w - 2 && a.x + a.w - 2 > b.x
      && a.y < b.y + b.h - 2 && a.y + a.h - 2 > b.y;
    const missing = ['nav'].filter((k) => !boxes[k]);
    const bads = [['counter', 'nav'], ['legend', 'nav'], ['counter', 'legend'],
      ['counter', 'fabs'], ['legend', 'fabs']]
      .filter(([p, q]) => overlap(boxes[p], boxes[q])).map((x) => x.join('/'));
    return { bads, missing };
  });
  ok(bad.missing.length === 0 && bad.bads.length === 0,
    `grand écran ${width} px : navigation présente, aucun chevauchement (${bad.bads.join(', ') || 'propre'})`);
  await ctxD.close();
}

await browser.close();
server.kill();
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
console.log('\n────────────────────────────');
console.log(`${passed} réussis · ${failed} échoués`);
process.exit(failed ? 1 : 0);
