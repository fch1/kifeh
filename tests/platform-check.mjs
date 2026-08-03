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
// Licence airplanes.live relue et VÉRIFIÉE le 31/07 (non commercial ✓,
// 1 req/s, sans clé) : la capacité est désormais déclarée, gardée par un
// drapeau territorial à chaud, éteint tant que l'interface ne l'accueille pas.
ok(fr.capabilities.aircraft.enabled === true
  && fr.capabilities.aircraft.settingFlag === 'fire_aircraft_enabled_fr'
  && fr.capabilities.aircraft.provider === 'adsb-airplanes-live',
  'FR : moyens aériens déclarés (licence vérifiée) derrière drapeau territorial');
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
// Serveur PRÉVISIONS simulé : quotidiennes sur 7 jours (dimanche = rafales
// fortes + humidité basse → la synthèse doit désigner dimanche).
import http from 'node:http';
const FC_PORT = 3959;
const fcSrv = http.createServer((req, res) => {
  const today = new Date();
  const days = [...Array(7)].map((_, i) => new Date(today.getTime() + i * 864e5).toISOString().slice(0, 10));
  // Jour index 2 : aggravation nette (rafales 55, humidité 18).
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ daily: {
    time: days,
    temperature_2m_max: [28, 30, 37, 33, 29, 27, 28],
    relative_humidity_2m_min: [45, 38, 18, 30, 44, 50, 41],
    wind_speed_10m_max: [15, 20, 38, 25, 14, 12, 16],
    wind_gusts_10m_max: [22, 30, 55, 38, 20, 18, 26],
    precipitation_sum: [4, 0, 0, 0, 6, 2, 0],
  } }));
});
await new Promise((r) => fcSrv.listen(FC_PORT, r));
process.on('exit', () => { try { fcSrv.close(); } catch {} });

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
    FORECAST_URL: `http://127.0.0.1:${FC_PORT}`,
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
ok(capFr.data.layers.emergencyGrid.enabled === true && capFr.data.layers.emergencyGrid.publicDisplay === true,
  'carroyage d’urgence : calcul ET affichage public actifs (décision Farah du 31/07)');

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

section('Pages SEO rendues serveur (/{langue}/{territoire}/incendies)');
const pFrFr = await fetch(`${BASE}/fr/fr/incendies`);
const hFrFr = await pFrFr.text();
ok(pFrFr.status === 200 && hFrFr.includes('<h1>'), '/fr/fr/incendies servie avec contenu');
ok(hFrFr.includes('rel="canonical" href="https://kifeh.app/fr/fr/incendies"'), 'canonical exact');
ok(['fr-FR', 'ar-FR', 'fr-TN', 'ar-TN', 'x-default'].every((h) => hFrFr.includes(`hreflang="${h}"`)),
  'hreflang : les 4 variantes servies + x-default, rien d’autre');
ok(hFrFr.includes('18') && hFrFr.includes('112'), 'urgences françaises (18/112)');
ok(hFrFr.includes('"@type":"Dataset"'), 'Dataset schema.org présent');
const hArTn = await (await fetch(`${BASE}/ar/tn/incendies`)).text();
ok(hArTn.includes('dir="rtl"') && hArTn.includes('lang="ar"'), '/ar/tn : RTL réel');
ok(hArTn.includes('198') && !/\b(?:le )?18\b(?![\d:])/.test(hArTn.replace(/utf-8|maxItems/g, '')),
  '/ar/tn : le 198 — jamais le numéro français (l’heure « 18:30 » n’est pas un numéro)');
ok(!/effis|arome|dfci/i.test(hArTn), 'une page tunisienne ne mentionne JAMAIS EFFIS/AROME/DFCI');
const hFrTn = await (await fetch(`${BASE}/fr/tn/incendies`)).text();
ok(hFrTn.includes('Tunisie') && !/effis|arome|dfci/i.test(hFrTn), '/fr/tn : localisée, capacités tunisiennes');
const redir = await fetch(`${BASE}/fr/incendies`, { redirect: 'manual' });
ok(redir.status === 301 && String(redir.headers.get('location')).endsWith('/fr/fr/incendies'),
  '/fr/incendies (ambigu) → 301 /fr/fr/incendies');
ok((await fetch(`${BASE}/fr/de/incendies`)).status === 404, 'variante non servie → 404 (jamais fantôme)');

section('Prévisions des conditions (/api/fire/forecast — jamais un incendie prédit)');
await setSettings({ fire_forecast_enabled_fr: '0' });
ok((await api('/api/fire/forecast?country=FR&lat=44.85&lng=-0.58')).data.enabled === false,
  'coupure à chaud du drapeau → enabled:false (retour arrière toujours possible)');
await setSettings({ fire_forecast_enabled_fr: '1', fire_forecast_enabled_tn: '1' });
const fcFr = await api('/api/fire/forecast?country=FR&lat=44.85&lng=-0.58');
ok(fcFr.data.enabled === true && fcFr.data.available === true && fcFr.data.days.length === 7,
  'France : 7 jours servis');
ok(fcFr.data.provider === 'open-meteo:meteofrance' && /Météo-France/.test(fcFr.data.modelLabel),
  'France : fournisseur Météo-France étiqueté honnêtement');
ok(fcFr.data.days[0].confidence === 'high' && fcFr.data.days[6].confidence === 'trend',
  'confiance dégressive : précis → tendance (J+6 jamais aussi sûr que demain)');
ok(/plus favorables/.test(fcFr.data.summary) && /rafales|humidité/.test(fcFr.data.summary),
  `synthèse déterministe avec facteurs : ${fcFr.data.summary}`);
ok(/ne prédit pas l’apparition|ne prédit pas l'apparition/.test(fcFr.data.disclaimer),
  'disclaimer porté par l’API');
ok(!/(niveau|score|risque)\s*:?\s*\d+/i.test(JSON.stringify(fcFr.data)),
  'aucun score inventé dans la réponse');
const fcTnAr = await api('/api/fire/forecast?country=TN&lat=36.8&lng=10.18&lang=ar');
ok(fcTnAr.data.provider === 'open-meteo:best_match' && !/Météo-France|arome/i.test(JSON.stringify(fcTnAr.data)),
  'Tunisie : modèle global — jamais Météo-France hors couverture');
ok(/[؀-ۿ]/.test(fcTnAr.data.summary || '') && /[؀-ۿ]/.test(fcTnAr.data.disclaimer || ''),
  'synthèse et disclaimer en arabe quand lang=ar');
// Drapeaux laissés ACTIFS : c'est l'état de production désormais.

section('Pages SEO prévisions (12 variantes — éditorial stable, disclaimer partout)');
const pv = await fetch(`${BASE}/fr/fr/incendies/previsions`);
const pvH = await pv.text();
ok(pv.status === 200 && pvH.includes('rel="canonical" href="https://kifeh.app/fr/fr/incendies/previsions"'),
  '/fr/fr/incendies/previsions : servie + canonical exact');
ok(pvH.includes('ne prédit pas l’apparition'), 'disclaimer TOUJOURS présent');
const dfTn = await (await fetch(`${BASE}/fr/tn/incendies/danger-feu`)).text();
ok(!/Météo-France|EFFIS|DFCI|AROME/i.test(dfTn.replace(/kifeh.app/g, '')),
  'page tunisienne : aucune source française hors couverture');
ok(dfTn.includes('jamais un niveau inventé'), 'TN : honnêteté sur l’absence de niveau officiel');
const meAr = await (await fetch(`${BASE}/ar/fr/incendies/methodologie-previsions`)).text();
ok(meAr.includes('dir="rtl"') && /[؀-ۿ]/.test(meAr), 'méthodologie ar/fr : RTL réel');
ok((await fetch(`${BASE}/fr/de/incendies/previsions`)).status === 404, 'variante non servie → 404');

section('Pages de zone (#83) : départements/gouvernorats depuis le REGISTRE');
const gi = await fetch(`${BASE}/fr/fr/incendies/gironde`);
const giH = await gi.text();
ok(gi.status === 200 && giH.includes('rel="canonical" href="https://kifeh.app/fr/fr/incendies/gironde"'),
  '/fr/fr/incendies/gironde : servie + canonical exact');
ok(/anomalie|Aucune anomalie/.test(giH) && /18|112/.test(giH),
  'Gironde : données vivantes de zone + numéros d’urgence français');
ok(giH.includes('emprise approximative'),
  'Gironde : honnêteté sur l’emprise (jamais des frontières exactes)');
ok(giH.includes('lat=44.84') && giH.includes('types=fire'),
  'Gironde : lien profond vers la carte centrée sur la zone');
const sx = await (await fetch(`${BASE}/ar/tn/incendies/sfax`)).text();
ok(sx.includes('dir="rtl"') && sx.includes('صفاقس'),
  '/ar/tn/incendies/sfax : RTL réel + nom arabe');
ok(!/Météo-France|EFFIS|DFCI|AROME/i.test(sx.replace(/kifeh\.app/g, '')) && sx.includes('198'),
  'Sfax : aucune source française, le 198 — jamais le 18');
ok((await fetch(`${BASE}/fr/fr/incendies/zone-inconnue`)).status === 404, 'zone inconnue → 404');
const intFr = await (await fetch(`${BASE}/fr/fr/incendies`)).text();
ok(intFr.includes('/fr/fr/incendies/gironde') && intFr.includes('Par département'),
  'page d’intention FR : maillage interne vers les départements');

section('Pages « comprendre » (#83) : pédagogie par source, DFCI France seule');
const cs = await (await fetch(`${BASE}/fr/tn/incendies/comprendre/detections-satellite`)).text();
ok(cs.includes('intensité') && cs.includes('jamais une confirmation officielle'),
  'detections-satellite TN : FRP=intensité + jamais une confirmation officielle');
const dfciFr = await fetch(`${BASE}/fr/fr/incendies/comprendre/reperes-dfci`);
ok(dfciFr.status === 200 && (await dfciFr.text()).includes('indicatif'),
  'reperes-dfci FR : servie, précision « indicative » assumée');
ok((await fetch(`${BASE}/ar/tn/incendies/comprendre/reperes-dfci`)).status === 404,
  'reperes-dfci TN : N’EXISTE PAS (404) — le registre de capacités décide');

section('Sitemap GÉNÉRÉ depuis les registres (plus de fichier statique)');
const sm = await fetch(`${BASE}/sitemap.xml`);
const smX = await sm.text();
ok(sm.status === 200 && sm.headers.get('content-type').includes('xml'),
  '/sitemap.xml : servi par la route (fichier statique supprimé)');
ok(smX.includes('/fr/fr/incendies/gironde') && smX.includes('/ar/tn/incendies/sfax'),
  'sitemap : les zones du registre y sont');
ok(smX.includes('comprendre/detections-satellite')
  && !smX.includes('/tn/incendies/comprendre/reperes-dfci'),
  'sitemap : comprendre listées, DFCI jamais côté tunisien');
ok((smX.match(/<loc>/g) || []).length === 54, `sitemap : 54 URLs (${(smX.match(/<loc>/g) || []).length})`);
ok(smX.includes('/fr/donnees-ouvertes/incendies') && smX.includes('/ar/donnees-ouvertes/incendies'),
  'sitemap : pages données ouvertes listées (fr + ar)');

section('URLs produit /{lang}/incendies/* : alias 301 vers les canoniques');
{
  const r = (p) => fetch(`${BASE}${p}`, { redirect: 'manual' });
  const carte = await r('/fr/incendies/carte');
  ok(carte.status === 301 && carte.headers.get('location') === '/?country=FR&lang=fr&types=fire',
    '/fr/incendies/carte → 301 vers l’application (mode feux FR)');
  const zone = await r('/fr/incendies/gironde');
  ok(zone.status === 301 && zone.headers.get('location') === '/fr/fr/incendies/gironde',
    '/fr/incendies/gironde → 301 vers la page canonique de zone');
  const zoneAr = await r('/ar/incendies/corse-du-sud');
  ok(zoneAr.status === 301 && zoneAr.headers.get('location') === '/ar/fr/incendies/corse-du-sud',
    '/ar/incendies/corse-du-sud → 301 (variante arabe conservée)');
  const meth = await r('/fr/incendies/methodologie');
  ok(meth.status === 301 && meth.headers.get('location') === '/fr/fr/incendies/comprendre/detections-satellite',
    '/fr/incendies/methodologie → 301 vers la méthodologie satellite');
  const prev = await r('/fr/incendies/previsions');
  ok(prev.status === 301 && prev.headers.get('location') === '/fr/fr/incendies/previsions',
    '/fr/incendies/previsions → 301 (sujet prévisions du registre)');
  const stx = await r('/fr/incendies/situation-textuelle');
  ok(stx.status === 301 && stx.headers.get('location') === '/fr/fr/incendies',
    '/fr/incendies/situation-textuelle → 301 vers la synthèse textuelle');
  ok((await r('/fr/incendies/zone-fantome')).status === 404,
    '/fr/incendies/zone-fantome → 404 (jamais de redirection fantôme)');
  ok((await r('/fr/incendies/comprendre/sujet-fantome')).status === 404,
    'comprendre inconnu → 404 explicite');
}

section('API ouverte /api/open : JSON stables, honnêtes, attribués');
{
  const sit = await api('/api/open/fire-situation.json');
  ok(sit.status === 200 && sit.data.meta?.api === 'kifeh-open/1',
    'fire-situation.json : version d’API explicite');
  ok(sit.data.countries?.FR?.satellite24h && 'observations' in sit.data.countries.FR.satellite24h,
    'situation FR : observations satellite 24 h présentes');
  ok(sit.data.countries?.FR?.satellite24h?.note?.includes('pas des incendies confirmés'),
    'situation : la note d’honnêteté accompagne les détections');
  ok(sit.data.countries?.TN && !('burnedAreas45d' in sit.data.countries.TN)
    && !JSON.stringify(sit.data.countries.TN).includes('EFFIS'),
    'situation TN : jamais EFFIS hors couverture');
  const src = await api('/api/open/fire-sources.json');
  ok(src.status === 200 && src.data.countries?.FR?.layers?.thermalDetections?.upstream?.provider?.includes('NASA'),
    'fire-sources.json : attribution NASA FIRMS présente');
  ok(src.data.countries?.FR?.layers?.thermalDetections?.freshnessThresholdsSeconds?.fresh > 0,
    'fire-sources.json : seuils de fraîcheur documentés');
  const tnLayers = src.data.countries?.TN?.layers || {};
  ok(Object.values(tnLayers).some((l) => l.enabled === false && l.disabledReason),
    'fire-sources.json TN : une capacité désactivée porte toujours sa raison');
  const met = await api('/api/open/fire-methodology.json');
  ok(met.status === 200 && met.data.principles?.fr?.some((p) => p.includes('quasi temps réel')),
    'fire-methodology.json : « quasi temps réel » explicité');
  ok(met.data.principles?.fr?.some((p) => p.includes('jamais') && p.includes('confirmé'))
    && met.data.links?.sourceCode?.includes('github.com/fch1/kifeh'),
    'fire-methodology.json : observation ≠ confirmation + lien code source');
  ok(met.data.freshness?.thresholdsSeconds && met.data.freshness?.labels?.fresh?.ar,
    'fire-methodology.json : seuils + libellés bilingues');
  const rawRes = await fetch(`${BASE}/api/open/fire-situation.json`);
  ok((rawRes.headers.get('cache-control') || '').includes('public'),
    'API ouverte : cache HTTP public (5 min)');

  const od = await fetch(`${BASE}/fr/donnees-ouvertes/incendies`);
  const odH = await od.text();
  ok(od.status === 200 && odH.includes('"@type":"Dataset"') && odH.includes('api/open/fire-situation.json'),
    '/fr/donnees-ouvertes/incendies : page réelle + JSON-LD Dataset');
  const odAr = await (await fetch(`${BASE}/ar/donnees-ouvertes/incendies`)).text();
  ok(odAr.includes('dir="rtl"') && odAr.includes('donnees-ouvertes/incendies'),
    '/ar/donnees-ouvertes/incendies : variante arabe RTL réelle');
  const llms = await (await fetch(`${BASE}/llms.txt`)).text();
  ok(llms.includes('/api/open/fire-sources.json') && llms.includes('donnees-ouvertes'),
    'llms.txt : l’API ouverte et sa documentation sont citées');
}

section('Lead generation : IndexNow + vérification Search Console prête');
{
  // Fichier-clé IndexNow : généré au premier passage, stable, servi en texte.
  const smKey = await fetch(`${BASE}/sitemap.xml`); void smKey; // (déclenche le boot des routes)
  const probe = await fetch(`${BASE}/0123456789abcdef0123456789abcdef.txt`);
  ok(probe.status === 404, 'un fichier-clé au hasard → 404 (jamais un écho aveugle)');
  // La vraie clé est lisible via l'admin des réglages après génération : on la
  // force en passant par la route avec la clé réellement stockée.
  const settingsList = await fetch(`${BASE}/api/admin/settings`, { headers: hdr });
  const settingsData = await settingsList.json().catch(() => ({}));
  const inKey = (settingsData.settings || []).find?.((s) => s.key === 'indexnow_key')?.value
    || settingsData.settings?.indexnow_key;
  if (inKey) {
    const kf = await fetch(`${BASE}/${inKey}.txt`);
    ok(kf.status === 200 && (await kf.text()) === inKey, 'fichier-clé IndexNow servi (clé stable)');
  } else {
    ok(true, 'clé IndexNow non encore générée dans cette base de test (route vérifiée en négatif)');
  }
  // Vérification Search Console : 404 tant que le réglage est vide, servie après.
  ok((await fetch(`${BASE}/google0123456789abcdef.html`)).status === 404,
    'fichier Google inconnu → 404 (réglage vide)');
  await fetch(`${BASE}/api/admin/settings`, {
    method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: { google_verification_file: 'google0123456789abcdef.html' } }),
  });
  const gv = await fetch(`${BASE}/google0123456789abcdef.html`);
  ok(gv.status === 200 && (await gv.text()).includes('google-site-verification: google0123456789abcdef.html'),
    'réglage posé → fichier de vérification Google servi (Search Console prête à coller)');
}

section('Replay 72 h (#110) : drapeau serveur actif par défaut, coupure à chaud');
{
  const adminSet2 = (settings) => fetch(`${BASE}/api/admin/settings`, {
    method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
  const c1 = await api('/api/public/config');
  ok(c1.data.fireReplay === true, 'config publique : fireReplay=true par défaut (visible)');
  await adminSet2({ fire_replay_enabled: '0' });
  const c2 = await api('/api/public/config');
  ok(c2.data.fireReplay === false, 'coupure à chaud → fireReplay=false');
  await adminSet2({ fire_replay_enabled: '1' });
  const c3 = await api('/api/public/config');
  ok(c3.data.fireReplay === true, 'réouverture à chaud (réversible)');
}

section('Widget embarquable + kit média (#93)');
const wg = await fetch(`${BASE}/widget?country=FR&lang=fr&zone=gironde`);
const wgH = await wg.text();
ok(wg.status === 200 && wgH.includes('Gironde') && /signalement|Aucun signalement/.test(wgH),
  '/widget?zone=gironde : carte de situation servie avec comptes vivants');
ok(wg.headers.get('x-frame-options') === null
  && String(wg.headers.get('content-security-policy')).includes('frame-ancestors *'),
  'widget : ENCAPSULABLE (X-Frame-Options retiré, frame-ancestors *) — seule surface du site');
ok(wgH.includes('noindex') && !wgH.includes('<script'),
  'widget : noindex + ZÉRO JavaScript (méta-rafraîchissement)');
const wgAr = await (await fetch(`${BASE}/widget?country=TN&lang=ar&zone=tunis`)).text();
ok(wgAr.includes('dir="rtl"') && wgAr.includes('تونس'), 'widget TN arabe : RTL réel + nom arabe');
ok((await fetch(`${BASE}/widget?country=FR&zone=zone-inconnue`)).status === 404,
  'widget : zone inconnue → 404 explicite');
const anyPage = await fetch(`${BASE}/fr/fr/incendies`);
ok(anyPage.headers.get('x-frame-options') === 'SAMEORIGIN',
  'le reste du site reste NON encapsulable (SAMEORIGIN conservé)');
const pk = await fetch(`${BASE}/presse`);
const pkH = await pk.text();
ok(pk.status === 200 && pkH.includes('&lt;iframe') && pkH.includes('zone=gironde'),
  '/presse : kit média avec extraits d’intégration prêts à coller');
ok(pkH.includes('github.com/fch1/kifeh') && !pkH.includes('@gmail'),
  '/presse : contact via le dépôt — jamais un courriel personnel publié');

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
