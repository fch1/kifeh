// Tests PLATEFORME MUTUALISÉE (addendum) : contrat des profils pays, registre
// de capacités effectives, fraîcheur typée, formatage localisé, espaces de
// noms i18n (parité fr↔ar), matrice de capacités anti-divergence, API
// /api/fire mutualisée (la Tunisie accède aux capacités génériques ; une
// réponse tunisienne ne mentionne JAMAIS EFFIS/DFCI/AROME).
// Usage : node tests/platform-check.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 3967;
const BASE = `http://localhost:${PORT}`;
const DB = 'data/platform-test.db';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
}
function section(t) { console.log(`\n■ ${t}`); }

// ═══ 1. Contrat des profils (validation déclarative, sans serveur) ═══════════
section('Contrat des profils pays (schema.js)');
const { validateProfile, CAPABILITY_CONCEPTS, DISABLED_REASONS } = await import('../src/countries/schema.js');
const { fr } = await import('../src/countries/fr.js');
const { tn } = await import('../src/countries/tn.js');

const frErrors = validateProfile(fr), tnErrors = validateProfile(tn);
ok(frErrors.length === 0, `profil FR valide (${frErrors.join(' ; ') || 'aucune erreur'})`);
ok(tnErrors.length === 0, `profil TN valide (${tnErrors.join(' ; ') || 'aucune erreur'})`);
ok(CAPABILITY_CONCEPTS.every((c) => c in fr.capabilities && c in tn.capabilities),
  'tous les concepts déclarés dans les deux profils');
ok(validateProfile({ ...tn, emergencyNumbers: { ...tn.emergencyNumbers, fire: [] } }).length > 0,
  'un profil sans numéro pompiers est rejeté');
ok(validateProfile({ ...tn, capabilities: { ...tn.capabilities, burnedAreas: { enabled: false } } }).length > 0,
  'une capacité désactivée SANS raison est rejetée');
ok(validateProfile({ ...tn, capabilities: { ...tn.capabilities, burnedAreas: { enabled: false, reason: 'parce_que' } } }).length > 0,
  'une raison hors vocabulaire est rejetée');

// Vérités territoriales : les numéros français ne fuient jamais vers la
// Tunisie, et réciproquement.
ok(fr.emergencyNumbers.fire.includes('18') && fr.emergencyNumbers.fire.includes('112'),
  'France : pompiers 18 + 112');
ok(tn.emergencyNumbers.fire.length === 1 && tn.emergencyNumbers.fire[0] === '198',
  'Tunisie : Protection civile 198 (et rien d’autre)');
ok(!JSON.stringify(tn.emergencyNumbers).match(/"1[578]"|"112"/), 'aucun numéro français dans le profil TN');

// Le profil TN ne mentionne aucun fournisseur français/européen actif.
const tnStr = JSON.stringify(tn.capabilities);
ok(!/"provider":"copernicus-effis"|"provider":"dfci|arome/i.test(tnStr),
  'TN : aucun fournisseur EFFIS/DFCI/AROME déclaré actif');
ok(tn.capabilities.thermalDetections.enabled === true && tn.capabilities.replay.enabled === true,
  'TN : détections thermiques + replay déclarés (capacités génériques)');
ok(fr.capabilities.aircraft.enabled === false && fr.capabilities.aircraft.reason === 'license_review_pending',
  'FR : moyens aériens bloqués tant que la licence n’est pas relue');
ok(fr.capabilities.smokeSimulation.enabled === false && fr.capabilities.smokeSimulation.reason === 'charter_decision_pending',
  'fumée gelée en attente de décision de charte (FR comme TN)');

// ═══ 2. Fraîcheur typée ══════════════════════════════════════════════════════
section('Fraîcheur typée (sourceFreshness.js)');
const { classifyFreshness, freshnessFromLastSuccess, freshnessThresholds } = await import('../src/services/sourceFreshness.js');
ok(classifyFreshness('thermalDetections', 0) === 'fresh', 'détections : 0 s → fresh');
ok(classifyFreshness('thermalDetections', 3 * 3600 - 1) === 'fresh', 'détections : 2 h 59 → fresh');
ok(classifyFreshness('thermalDetections', 3 * 3600 + 1) === 'delayed', 'détections : 3 h 01 → delayed');
ok(classifyFreshness('thermalDetections', 8 * 3600 + 1) === 'stale', 'détections : 8 h 01 → stale');
ok(classifyFreshness('thermalDetections', null) === 'unavailable', 'sans dernière réussite → unavailable');
ok(classifyFreshness('firms', 60) === 'fresh', 'alias historique « firms » accepté');
ok(classifyFreshness('burnedAreas', 20 * 3600) === 'fresh',
  'zones brûlées : 20 h → fresh (cadence quotidienne, pas les seuils satellite)');
ok(classifyFreshness('weatherModel', 2 * 3600) === 'delayed', 'météo : 2 h → delayed (cadence 15 min)');
ok(classifyFreshness('inconnue', 60) === null, 'source inconnue → null (jamais de seuil inventé)');
const f1 = freshnessFromLastSuccess('thermalDetections', new Date(Date.now() - 60_000).toISOString());
ok(f1.status === 'fresh' && f1.ageSeconds >= 59 && f1.ageSeconds <= 62, 'freshnessFromLastSuccess : âge + statut');
ok(Object.keys(freshnessThresholds()).length >= 6, 'seuils exposés pour la documentation');

// ═══ 3. Formatage localisé ═══════════════════════════════════════════════════
section('Formatage localisé (localizationFormatter.js) — stockage canonique, affichage territorial');
process.env.DB_PATH = 'data/platform-unit.db';
for (const f of ['data/platform-unit.db', 'data/platform-unit.db-wal', 'data/platform-unit.db-shm']) fs.rmSync(f, { force: true });
const fmt = await import('../src/services/localizationFormatter.js');
// Même instant UTC : 12:00 UTC = 14:00 à Paris (été) et 13:00 à Tunis.
const noonUtc = '2026-07-15T12:00:00Z';
const parisTime = fmt.fmtTime(noonUtc, { language: 'fr', countryCode: 'FR' });
const tunisTime = fmt.fmtTime(noonUtc, { language: 'fr', countryCode: 'TN' });
ok(parisTime.includes('14'), `heure de Paris (été) : ${parisTime}`);
ok(tunisTime.includes('13'), `heure de Tunis : ${tunisTime}`);
ok(fmt.fmtDistance(850, { language: 'fr', countryCode: 'FR' }) === '850 m', 'distance < 1 km en mètres');
ok(fmt.fmtDistance(12_400, { language: 'fr', countryCode: 'FR' }).includes('km'), '12 400 m → km');
ok(fmt.fmtDistance(2000, { language: 'ar', countryCode: 'TN' }).includes('كم'), 'unité arabe كم');
ok(fmt.fmtSpeedMs(10, { language: 'fr', countryCode: 'FR' }).includes('36'), '10 m/s → 36 km/h (canonique m/s)');
ok(fmt.fmtAreaHa(1091, { language: 'fr', countryCode: 'FR' }).includes('ha'), 'surface en hectares (valeur source)');
const arPlural = (n) => fmt.pluralize(n, {
  zero: 'صفر', one: 'واحد', two: 'اثنان', few: 'قليل', many: 'كثير', other: 'غير ذلك',
}, { language: 'ar', countryCode: 'TN' });
ok(arPlural(0) === 'صفر' && arPlural(1) === 'واحد' && arPlural(2) === 'اثنان', 'pluriels arabes : zero/one/two');
ok(arPlural(5) === 'قليل' && arPlural(30) === 'كثير', 'pluriels arabes : few (3-10) / many (11-99)');
const lineTn = fmt.emergencyLine('TN', 'fr');
const lineFrAr = fmt.emergencyLine('FR', 'ar');
ok(lineTn.includes('198') && !/\b1[578]\b|\b112\b/.test(lineTn),
  `urgences TN en français : ${lineTn} (jamais un numéro français)`);
ok(lineFrAr.includes('18') && lineFrAr.includes('112') && /[؀-ۿ]/.test(lineFrAr),
  'urgences FR en arabe : numéros français + texte arabe');

// ═══ 4. Espaces de noms i18n — parité stricte fr ↔ ar ════════════════════════
section('i18n par espaces de noms : parité fr ↔ ar');
const NS = ['common', 'fire', 'map', 'replay', 'sources', 'alerts', 'seo'];
let parityOk = true, nonEmptyOk = true, arIsArabic = true;
for (const ns of NS) {
  const frD = JSON.parse(fs.readFileSync(path.join('i18n', 'fr', `${ns}.json`), 'utf8'));
  const arD = JSON.parse(fs.readFileSync(path.join('i18n', 'ar', `${ns}.json`), 'utf8'));
  const frK = Object.keys(frD).sort().join(','), arK = Object.keys(arD).sort().join(',');
  if (frK !== arK) { parityOk = false; console.log(`    divergence ${ns} : ${frK} ≠ ${arK}`); }
  if (![...Object.values(frD), ...Object.values(arD)].every((v) => typeof v === 'string' && v.trim())) nonEmptyOk = false;
  if (!Object.values(arD).some((v) => /[؀-ۿ]/.test(v))) arIsArabic = false;
}
ok(parityOk, 'chaque clé fr existe en ar (et réciproquement) dans les 7 espaces');
ok(nonEmptyOk, 'aucune valeur vide');
ok(arIsArabic, 'les fichiers ar contiennent réellement de l’arabe');
const commonFr = JSON.parse(fs.readFileSync('i18n/fr/common.json', 'utf8'));
ok(commonFr.source_not_available_for_zone === 'Cette source n’est pas encore disponible pour cette zone.'
  || commonFr.source_not_available_for_zone === "Cette source n'est pas encore disponible pour cette zone.",
  'message de mode dégradé conforme à la charte');

// ═══ 5. Matrice de capacités — jamais de divergence doc ↔ code ═══════════════
section('Matrice de capacités (docs/COUNTRY_CAPABILITY_MATRIX.md)');
const { renderMatrix } = await import('../scripts/generate-capability-matrix.mjs');
const committed = fs.existsSync('docs/COUNTRY_CAPABILITY_MATRIX.md')
  ? fs.readFileSync('docs/COUNTRY_CAPABILITY_MATRIX.md', 'utf8') : '';
ok(committed.trim() === renderMatrix().trim(),
  'la matrice committée est EXACTEMENT celle générée depuis le registre');
ok(committed.includes('FICHIER GÉNÉRÉ'), 'la matrice se déclare générée (ne pas éditer)');

// ═══ 6. Serveur : capacités effectives + API feux mutualisée ═════════════════
section('Démarrage du serveur de test');
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const server = spawn('node', ['server.js'], {
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
    BASE_URL: BASE, ADMIN_PASSWORD: 'test-admin-password-1', ADMIN_USERNAME: 'admin',
    SANDBOX_ENABLED: '0',
    // Clé FIRMS factice + URL fermée : la synchro échoue vite et proprement —
    // on teste l'API et les capacités, pas l'ingestion. AUCUN drapeau posé en
    // env (les variables d'environnement PRIMENT sur les réglages : elles
    // rendraient les bascules admin invisibles).
    NASA_FIRMS_MAP_KEY: 'test-key-platform', FIRMS_URL: 'http://127.0.0.1:9',
    FIRMS_TIMEOUT_MS: '400',
    WIND_URL: 'http://127.0.0.1:9', EFFIS_URL: '', METEOFRANCE_API_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
server.stdout.on('data', () => {});
process.on('exit', () => { try { server.kill(); } catch {} });
let up = false;
for (let i = 0; i < 60; i++) {
  try { await fetch(`${BASE}/healthz`); up = true; break; }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}
ok(up, 'serveur démarré');

const api = async (url, headers = {}) => {
  const res = await fetch(`${BASE}${url}`, { headers });
  let data = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
};

section('Capacités effectives (/api/public/capabilities)');
const capFr = await api('/api/public/capabilities?country=FR');
ok(capFr.status === 200 && capFr.data.country === 'FR', 'réponse France');
ok(capFr.data.fireMode === true && capFr.data.layers.thermalDetections.enabled === true,
  'mode feux France actif par défaut (détections déclarées + clé présente)');
ok(capFr.data.layers.burnedAreas.enabled === true && capFr.data.layers.burnedAreas.provider === 'copernicus-effis',
  'France : zones brûlées actives (fournisseur affiché en méta, pas en architecture)');
ok(capFr.data.layers.weatherModel.enabled === true
  && capFr.data.layers.weatherModel.model === 'meteofrance_arome_france_hd',
  'France : modèle météo configuré explicite');
ok(capFr.data.layers.officialAlerts.enabled === false && capFr.data.layers.officialAlerts.reason === 'not_configured',
  'vigilance sans clé → not_configured (honnête, pas cassé)');
ok(capFr.data.emergency.numbers.fire.join(',') === '18,112' && capFr.data.timezone === 'Europe/Paris',
  'France : numéros 18/112 + fuseau Europe/Paris');
ok(capFr.data.layers.emergencyGrid.enabled === true && capFr.data.layers.emergencyGrid.publicDisplay === false,
  'carroyage d’urgence : calcul actif, affichage public éteint (décision en attente)');

const capTn = await api('/api/public/capabilities?country=TN');
ok(capTn.data.country === 'TN' && capTn.data.timezone === 'Africa/Tunis', 'réponse Tunisie + fuseau de Tunis');
ok(capTn.data.emergency.numbers.fire.join(',') === '198', 'Tunisie : Protection civile 198');
ok(capTn.data.layers.burnedAreas.enabled === false && capTn.data.layers.burnedAreas.reason === 'coverage_to_verify',
  'Tunisie : zones brûlées absentes avec raison');
ok(capTn.data.layers.weatherModel.enabled === false && capTn.data.layers.weatherModel.reason === 'model_to_integrate',
  'Tunisie : météo à intégrer (jamais le modèle français hors couverture)');
ok(!/effis|arome|dfci/i.test(JSON.stringify(capTn.data)),
  'la réponse tunisienne ne mentionne JAMAIS EFFIS, AROME ni DFCI');

// Langue ≠ pays : la même réponse quelle que soit la langue.
const capTnAr = await api('/api/public/capabilities?country=TN&lang=ar');
const strip = (c) => JSON.stringify({ ...c, language: null });
ok(strip(capTnAr.data) === strip(capTn.data), 'les capacités sont IDENTIQUES en arabe et en français');

section('Drapeaux à chaud (admin) → capacités et API feux');
const login = await fetch(`${BASE}/api/admin/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'test-admin-password-1' }),
});
const loginData = await login.json();
const hdr = {
  Cookie: (login.headers.get('set-cookie') || '').split(';')[0],
  'X-CSRF': loginData.csrf, 'Content-Type': 'application/json',
};
const setSettings = (settings) => fetch(`${BASE}/api/admin/settings`, {
  method: 'POST', headers: hdr, body: JSON.stringify({ settings }),
});
// Coupure à chaud du drapeau d'UNE couche → raison propre, le mode feux
// survit (une expérience n'est jamais l'otage d'une seule couche).
await setSettings({ fr_nasa_firms_enabled: '0' });
const capFrOff = await api('/api/public/capabilities?country=FR');
ok(capFrOff.data.layers.thermalDetections.enabled === false
  && capFrOff.data.layers.thermalDetections.reason === 'not_yet_enabled',
  'fr_nasa_firms_enabled=0 → détections FR coupées AVEC raison (mode dégradé propre)');
ok(capFrOff.data.fireMode === true,
  '…le mode feux France survit (signalements + zones brûlées restent)');
ok((await api('/api/public/capabilities?country=TN')).data.layers.thermalDetections.enabled === true,
  '…les détections tunisiennes restent actives (indépendance des territoires)');
await setSettings({ fr_nasa_firms_enabled: '1' });
const capFr2 = await api('/api/public/capabilities?country=FR');
ok(capFr2.data.layers.thermalDetections.enabled === true, 'drapeau réactivé → détections FR de retour');
const capTn2 = await api('/api/public/capabilities?country=TN');
ok(capTn2.data.fireMode === true, 'mode feux Tunisie actif (capacité générique)');

section('API feux MUTUALISÉE (/api/fire/map, /api/fire/timeline)');
const bboxFr = 'minLat=41&maxLat=52&minLng=-5&maxLng=10';
const bboxTn = 'minLat=30&maxLat=38&minLng=7&maxLng=12';
const mapFr = await api(`/api/fire/map?country=FR&${bboxFr}`);
ok(mapFr.data.enabled === true && Array.isArray(mapFr.data.detections), 'France : instantané servi');
ok('burnedAreas' in mapFr.data && mapFr.data.meta?.sources?.effis !== undefined,
  'France : zones brûlées présentes (capacité active)');
ok(mapFr.data.meta?.sources?.weather?.model?.includes('AROME'),
  'France : la météo porte son modèle explicite');
ok(mapFr.data.meta?.sources?.firms?.status === 'unavailable',
  'aucune synchro réussie → statut TYPÉ unavailable (jamais un faux « fresh »)');
ok(mapFr.data.meta?.country === 'FR', 'meta.country présent');

const mapTn = await api(`/api/fire/map?country=TN&${bboxTn}`);
ok(mapTn.data.enabled === true && Array.isArray(mapTn.data.detections) && Array.isArray(mapTn.data.citizenReports),
  'Tunisie : instantané servi (détections + signalements)');
ok(!('burnedAreas' in mapTn.data) && !('weather' in mapTn.data),
  'Tunisie : NI zones brûlées NI météo dans la réponse (capacités absentes)');
ok(!/effis|arome|dfci/i.test(JSON.stringify(mapTn.data)),
  'la réponse feux tunisienne ne mentionne jamais EFFIS/AROME/DFCI');
ok(mapTn.data.meta?.sources?.firms !== undefined, 'Tunisie : fraîcheur des détections présente');

const mapTnAr = await api(`/api/fire/map?country=TN&${bboxTn}&lang=ar`);
ok(/[؀-ۿ]/.test(mapTnAr.data.meta?.sources?.firms?.note || ''),
  'note satellite en ARABE quand lang=ar (i18n espaces de noms)');

const tlFr = await api(`/api/fire/timeline?country=FR&${bboxFr}`);
const tlTn = await api(`/api/fire/timeline?country=TN&${bboxTn}`);
ok(tlFr.data.enabled === true && 'effisPublications' in tlFr.data, 'timeline France : publications de contours');
ok(tlTn.data.enabled === true && !('effisPublications' in tlTn.data),
  'timeline Tunisie : aucune mention de publications inexistantes');
ok(/[؀-ۿ]/.test((await api(`/api/fire/timeline?country=TN&${bboxTn}&lang=ar`)).data.note || ''),
  'note FRP de la timeline en arabe quand lang=ar');

// Coupure territoriale à chaud.
await setSettings({ fire_situation_enabled_tn: '0' });
const mapTnOff = await api(`/api/fire/map?country=TN&${bboxTn}`);
ok(mapTnOff.data.enabled === false, 'fire_situation_enabled_tn=0 → API feux TN coupée proprement');
ok((await api(`/api/fire/map?country=FR&${bboxFr}`)).data.enabled === true,
  '…sans toucher à la France (indépendance des territoires)');
await setSettings({ fire_situation_enabled_tn: '1' });

section('i18n servi (/api/public/i18n/:ns)');
const i18nFire = await api('/api/public/i18n/fire?lang=ar');
ok(i18nFire.status === 200 && i18nFire.data.messages.title === 'الحرائق', 'espace fire servi en arabe');
const i18nFr = await api('/api/public/i18n/sources?lang=fr');
ok(i18nFr.data.messages.freshness_fresh === 'À jour', 'espace sources servi en français');
ok((await api('/api/public/i18n/inexistant')).status === 404, 'espace inconnu → 404');

section('healthz : fraîcheur typée par source');
const hz = await api('/healthz');
ok(hz.data.firms && 'status' in hz.data.firms
  && ['fresh', 'delayed', 'stale', 'unavailable'].includes(hz.data.firms.status),
  `healthz.firms.status typé (${hz.data.firms?.status})`);
ok(hz.data.effis === null || hz.data.effis === undefined || !('status' in (hz.data.effis || {}))
  || ['fresh', 'delayed', 'stale', 'unavailable'].includes(hz.data.effis.status),
  'healthz.effis.status typé quand présent');
ok(hz.data.incidents !== null && hz.data.incidents >= 0, 'compteur d’incidents toujours présent');

// ═══ Bilan ═══════════════════════════════════════════════════════════════════
console.log(`\n═══ Plateforme mutualisée : ${passed} réussis, ${failed} échoués ═══`);
try { server.kill(); } catch {}
for (const f of [DB, `${DB}-wal`, `${DB}-shm`, 'data/platform-unit.db', 'data/platform-unit.db-wal', 'data/platform-unit.db-shm']) fs.rmSync(f, { force: true });
process.exit(failed > 0 ? 1 : 0);
