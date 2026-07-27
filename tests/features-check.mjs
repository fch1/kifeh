// Tests des fonctionnalités communautaires (juillet 2026) :
// confirmations sans doublon, seuil incendie, fin d'incident communautaire,
// corrections de localisation, annuaire tunisien, filtre par période,
// numéros à 8 chiffres, préservation des données entre « déploiements ».
// Usage : node tests/features-check.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 3998;
const BASE = `http://localhost:${PORT}`;
const DB = 'data/features-test.db';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
}
function section(t) { console.log(`\n■ ${t}`); }

// Simule une personne différente : appareil distinct + adresse IP distincte
// (le verrou anti-abus refuse tout dénominateur déjà utilisé sur l'incident).
const asPerson = (n) => ({ 'X-Forwarded-For': `10.20.${Math.floor(n / 250)}.${(n % 250) + 1}` });

async function api(method, url, body, headers = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const draftBody = (over = {}) => ({
  type: 'electricity', lat: 36.8065, lng: 10.1815,
  locationSource: 'gps', gpsAccuracy: 12, deviceLat: 36.8064, deviceLng: 10.1813,
  address: 'Avenue Habib Bourguiba, Tunis', publicArea: 'Tunis Centre',
  temporalStatus: 'ongoing', startedAt: new Date(Date.now() - 30 * 60000).toISOString(),
  timeApproximate: false, description: `Test communautaire ${Math.random().toString(36).slice(2, 8)}`,
  severity: 'moderate', fillSeconds: 25,
  idempotencyKey: `k-${Math.random()}`,
  ...over,
});

// Publication directe (OTP désactivé dans cet environnement de test).
async function publish(over = {}) {
  const d = await api('POST', '/api/declare/draft', draftBody(over));
  if (d.status !== 200) return { error: d.data.error };
  const p = await api('POST', '/api/declare/publish-unverified', {
    incidentId: d.data.incidentId, draftToken: d.data.draftToken,
  });
  return { ...p.data, incidentId: d.data.incidentId };
}

const device = (n) => `test-device-${String(n).padStart(4, '0')}xxxx`;

function startServer(extraEnv = {}) {
  const server = spawn('node', ['server.js'], {
    env: {
      ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
      BASE_URL: BASE, ADMIN_PASSWORD: 'test-admin-password-1', ADMIN_USERNAME: 'admin',
      SANDBOX_ENABLED: '0', VERIFICATION_REQUIRED: '0',
      MAX_DECLARATIONS_PER_IP_PER_H: '100', MIN_FORM_FILL_S: '2',
      TRUST_PUBLISH_THRESHOLD: '10',
      RESOLUTION_MODE: 'threshold', // cette suite valide le mode « seuil de 3 »
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  server.stdout.on('data', () => {});
  return server;
}

async function main() {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
  let server = startServer();
  await new Promise((r) => setTimeout(r, 1300));

  // ── Numéros tunisiens ─────────────────────────────────────────────────────
  section('Validation des numéros tunisiens');
  const { isPhone, normalizePhone } = await import('../src/middleware/security.js');
  ok(isPhone('20 123 456') && normalizePhone('20 123 456') === '+21620123456', 'numéro local 8 chiffres accepté et normalisé en +216');
  ok(isPhone('+216 20 123 456') && normalizePhone('+216 20 123 456') === '+21620123456', 'format international accepté');
  ok(normalizePhone('00216 20 123 456') === '+21620123456', '00216 normalisé en +216');
  ok(!isPhone('12345'), 'numéro trop court refusé');

  // ── Annuaire de contacts ──────────────────────────────────────────────────
  section('Annuaire tunisien vérifié');
  const fire = await api('GET', '/api/public/contacts?type=fire');
  ok(fire.data.contacts?.[0]?.id === 'protection_civile' && fire.data.contacts[0].phone_tel === '198',
    'incendie : Protection civile 198 en premier');
  const ids = fire.data.contacts.map((c) => c.id);
  ok(ids.includes('samu') && ids.includes('police_secours') && ids.includes('garde_nationale'),
    'incendie : SAMU 190, Police 197, Garde nationale 193 présents');
  const elec = await api('GET', '/api/public/contacts?type=electricity');
  ok(elec.data.contacts.some((c) => c.phone_tel === '80100444'), 'électricité : urgences STEG 80 100 444');
  ok(elec.data.contacts.some((c) => c.phone_tel === '+21671239222'), 'électricité : STEG 71 239 222');
  const water = await api('GET', '/api/public/contacts?type=water');
  ok(water.data.contacts.some((c) => c.phone_tel === '80100319'), 'eau : SONEDE 80 100 319');
  const all = await api('GET', '/api/public/contacts');
  const numbers = all.data.contacts.map((c) => c.phone_tel).join(' ');
  ok(!/\b(911|112|999|15|17|18)\b/.test(numbers), 'aucun numéro d’urgence étranger dans l’annuaire');
  const arOk = all.data.contacts.every((c) => c.name_ar && /[؀-ۿ]/.test(c.name_ar));
  ok(arOk, 'chaque contact a un nom en arabe');

  // ── Confirmations sans doublon ────────────────────────────────────────────
  section('« Je suis aussi concerné » — un seul comptage par personne');
  const inc = await publish();
  ok(inc.ok && inc.status === 'active', 'incident test publié');
  const c1 = await api('POST', '/api/public/confirm/direct', { publicId: inc.publicId, deviceId: device(1) }, asPerson(1));
  ok(c1.status === 200 && c1.data.confirmations === 1, 'première confirmation comptée (1)');
  const c1b = await api('POST', '/api/public/confirm/direct', { publicId: inc.publicId, deviceId: device(1) }, asPerson(1));
  ok(c1b.status === 400 && c1b.data.alreadyConfirmed, 'double clic / requête répétée refusée');
  const detail1 = await api('GET', `/api/public/incidents/${inc.publicId}`);
  ok(detail1.data.confirmations_count === 1, 'compteur toujours à 1 après la tentative en double');
  const c2 = await api('POST', '/api/public/confirm/direct', { publicId: inc.publicId, deviceId: device(2) }, asPerson(2));
  ok(c2.data.confirmations === 2, 'deuxième personne comptée (2)');
  const list = await api('GET', '/api/public/incidents?status=active');
  ok(list.data.incidents.filter((x) => x.public_id === inc.publicId).length === 1,
    'aucun doublon d’incident créé par les confirmations');

  // ── Incendie : seuil communautaire de 3 ───────────────────────────────────
  section('Incendie — confirmé par la communauté à partir de 3');
  const fireInc = await publish({ type: 'fire', lat: 36.9, lng: 10.2, description: `Feu test ${Math.random().toString(36).slice(2, 6)}` });
  const df0 = await api('GET', `/api/public/incidents/${fireInc.publicId}`);
  ok(df0.data.fireThreshold === 3 && df0.data.communityConfirmed === false, 'incendie non confirmé au départ (0/3)');
  const f1 = await api('POST', '/api/public/confirm/direct', { publicId: fireInc.publicId, deviceId: device(11) }, asPerson(11));
  ok(f1.data.communityConfirmed === false && f1.data.confirmations === 1, '1 confirmation sur 3 → pas encore confirmé');
  await api('POST', '/api/public/confirm/direct', { publicId: fireInc.publicId, deviceId: device(12) }, asPerson(12));
  const f3 = await api('POST', '/api/public/confirm/direct', { publicId: fireInc.publicId, deviceId: device(13) }, asPerson(13));
  ok(f3.data.communityConfirmed === true && f3.data.confirmations === 3, '3 confirmations → confirmé par la communauté');
  const farAway = await api('POST', '/api/public/confirm/direct',
    { publicId: fireInc.publicId, deviceId: device(14), approxLat: 48.85, approxLng: 2.35 }, asPerson(14));
  ok(farAway.status === 400 && farAway.data.tooFar, 'confirmation à 1 500 km refusée (contrôle de proximité)');
  const near = await api('POST', '/api/public/confirm/direct',
    { publicId: fireInc.publicId, deviceId: device(15), approxLat: 36.91, approxLng: 10.21 }, asPerson(15));
  ok(near.status === 200, 'confirmation à proximité acceptée');

  // ── Fin d'incident communautaire ──────────────────────────────────────────
  section('« Signaler que cet incident est terminé » — seuil de 3');
  const endInc = await publish({ lat: 35.8, lng: 10.6 });
  const r1 = await api('POST', `/api/public/incidents/${endInc.publicId}/resolution`,
    { deviceId: device(21), proposedEndedAt: new Date().toISOString(), comment: 'Courant revenu' }, asPerson(21));
  ok(r1.status === 200 && r1.data.reports === 1 && !r1.data.resolved, '1er signalement enregistré, incident toujours actif');
  const r1b = await api('POST', `/api/public/incidents/${endInc.publicId}/resolution`, { deviceId: device(21) }, asPerson(21));
  ok(r1b.status === 400 && r1b.data.alreadyReported, 'signalement en double refusé');
  const r2 = await api('POST', `/api/public/incidents/${endInc.publicId}/resolution`, { deviceId: device(22) }, asPerson(22));
  ok(r2.data.reports === 2 && !r2.data.resolved, '2e signalement : toujours pas de clôture');
  const still = await api('GET', `/api/public/incidents/${endInc.publicId}`);
  ok(still.data.status === 'active' && still.data.resolutionReports === 2, 'détail : 2 signalements visibles, statut actif');
  const r3 = await api('POST', `/api/public/incidents/${endInc.publicId}/resolution`, { deviceId: device(23) }, asPerson(23));
  ok(r3.data.resolved === true, '3e signalement indépendant → clôture automatique');
  const after = await api('GET', `/api/public/incidents/${endInc.publicId}`);
  ok(after.data.status === 'resolved' && after.data.ended_at, 'incident résolu avec heure de fin');

  // ── Réouverture par un modérateur ────────────────────────────────────────
  section('Réouverture par un modérateur');
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-password-1' }),
  });
  const loginData = await login.json();
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  const reopen = await fetch(`${BASE}/api/admin/incidents/${endInc.publicId}/reopen`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF': loginData.csrf },
  });
  ok(reopen.status === 200, 'réouverture admin acceptée');
  const reopened = await api('GET', `/api/public/incidents/${endInc.publicId}`);
  ok(reopened.data.status === 'active', 'incident de nouveau actif après réouverture');

  // ── Corrections de localisation ───────────────────────────────────────────
  section('Correction de localisation');
  const locInc = await publish({ lat: 34.74, lng: 10.76 });
  const before = await api('GET', `/api/public/incidents/${locInc.publicId}`);
  // 1. Visiteur : proposition en modération, l'incident ne bouge PAS.
  const prop = await api('POST', `/api/public/incidents/${locInc.publicId}/location-correction`,
    { deviceId: device(31), lat: 34.75, lng: 10.77, address: 'Route de Gabès, Sfax' });
  ok(prop.status === 200, 'proposition de correction (visiteur) enregistrée');
  const unchanged = await api('GET', `/api/public/incidents/${locInc.publicId}`);
  ok(unchanged.data.lat === before.data.lat && unchanged.data.lng === before.data.lng,
    'position inchangée tant que la proposition n’est pas validée');
  const corrList = await fetch(`${BASE}/api/admin/corrections`, { headers: { Cookie: cookie, 'X-CSRF': loginData.csrf } });
  const corrData = await corrList.json();
  const pending = corrData.corrections.find((c) => c.public_id === locInc.publicId);
  ok(Boolean(pending), 'proposition visible dans la file de modération');
  const approve = await fetch(`${BASE}/api/admin/corrections/${pending.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF': loginData.csrf },
  });
  ok(approve.status === 200, 'proposition approuvée par un modérateur');
  const moved = await api('GET', `/api/public/incidents/${locInc.publicId}`);
  ok(moved.data.lat !== before.data.lat || moved.data.lng !== before.data.lng, 'position mise à jour après validation');
  const stillOne = await api('GET', '/api/public/incidents?status=active');
  ok(stillOne.data.incidents.filter((x) => x.public_id === locInc.publicId).length === 1,
    'la correction n’a créé aucun doublon d’incident');
  // 2. Déclarant : correction directe via son lien de gestion.
  const ownInc = await publish({ lat: 33.88, lng: 10.09 });
  const token = new URL(ownInc.manageUrl).searchParams.get('token');
  const own = await api('POST', '/api/manage/update-location',
    { token, lat: 33.9, lng: 10.11, address: 'Rue Ibn Khaldoun, Gabès', publicArea: 'Gabès Centre' });
  ok(own.status === 200, 'déclarant : correction appliquée directement');
  const ownView = await api('GET', `/api/manage/incident?token=${token}`);
  ok(Math.abs(ownView.data.lat - 33.9) < 1e-6 && ownView.data.address === 'Rue Ibn Khaldoun, Gabès',
    'nouvelle position et adresse enregistrées');
  const ownPub = await api('GET', `/api/public/incidents/${ownInc.publicId}`);
  ok(Math.abs(ownPub.data.lat - 33.9) > 1e-9, 'position publique toujours anonymisée (différente de la position exacte)');

  // ── Filtre par période (date de publication) ──────────────────────────────
  section('Filtre par période');
  const perInc = await publish({ lat: 36.4, lng: 10.6, startedAt: new Date(Date.now() - 20 * 3600_000).toISOString() });
  const recent = await api('GET', `/api/public/incidents?publishedSince=${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}`);
  ok(recent.data.incidents.some((x) => x.public_id === perInc.publicId),
    'incident commencé il y a 20 h mais PUBLIÉ à l’instant visible dans « dernière heure »');
  const old = await api('GET', `/api/public/incidents?publishedSince=${encodeURIComponent(new Date(Date.now() + 3600_000).toISOString())}`);
  ok(!old.data.incidents.some((x) => x.public_id === perInc.publicId), 'borne de période exclusive respectée');
  ok(recent.data.incidents.every((x) => x.published_at), 'published_at exposé sur chaque incident');

  // ── Préservation des données à travers un redémarrage/déploiement ─────────
  section('Préservation des données (simulation de redéploiement)');
  const countBefore = (await api('GET', '/api/public/incidents')).data.count;
  server.kill();
  await new Promise((r) => setTimeout(r, 600));
  server = startServer();
  await new Promise((r) => setTimeout(r, 1300));
  const countAfter = (await api('GET', '/api/public/incidents')).data.count;
  ok(countAfter === countBefore && countAfter > 0,
    `tous les incidents présents après redémarrage (${countAfter}/${countBefore})`);
  const survivor = await api('GET', `/api/public/incidents/${inc.publicId}`);
  ok(survivor.data.public_id === inc.publicId && survivor.data.confirmations_count === 2,
    'identifiants, relations et compteurs de confirmation intacts');

  console.log('\n────────────────────────────');
  console.log(`${passed} réussis · ${failed} échoués`);
  server.kill();
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
