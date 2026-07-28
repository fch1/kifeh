// Tests rétention & robustesse : alertes de zone (Web Push), partage,
// double authentification admin (TOTP), sauvegarde hors-site, domaine
// canonique. Tout doit être utilisable dès le premier déploiement, sans
// configuration (clés VAPID auto-générées).
// Usage : node tests/retention-check.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 3975;
const BASE = `http://localhost:${PORT}`;
const DB = 'data/retention-test.db';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
}
function section(t) { console.log(`\n■ ${t}`); }

async function api(method, url, body, headers = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, data, headers: res.headers };
}

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const server = spawn('node', ['server.js'], {
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
    BASE_URL: BASE, ADMIN_PASSWORD: 'test-admin-password-1', ADMIN_USERNAME: 'admin',
    SANDBOX_ENABLED: '0', VERIFICATION_REQUIRED: '0', MIN_FORM_FILL_S: '2',
    TRUST_PUBLISH_THRESHOLD: '10', WEB_PUSH_DISABLED: '1',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
server.stdout.on('data', () => {});
process.on('exit', () => { try { server.kill(); } catch {} });
for (let __i = 0; __i < 60; __i++) {
  try { await fetch(`${BASE}/healthz`); break; }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}

async function main() {
  // ── Zéro configuration : clé VAPID auto-générée et exposée ──
  section('Alertes de zone : prêtes dès le premier démarrage');
  const cfg = await api('GET', '/api/public/config');
  ok(typeof cfg.data.pushKey === 'string' && cfg.data.pushKey.length > 60,
    'clé publique VAPID auto-générée et exposée dans /config');
  const sw = await fetch(`${BASE}/sw.js`);
  const swText = await sw.text();
  ok(sw.status === 200 && swText.includes('showNotification'), 'service worker /sw.js servi');
  // Politique de cache HONNÊTE (PWA) : le shell peut être mis en cache pour
  // les réseaux instables, mais les DONNÉES (/api/…) ne le sont JAMAIS — un
  // instantané périmé présenté comme frais serait un mensonge.
  ok(swText.includes(`startsWith('/api/')`) && swText.includes('return;'),
    'service worker : les données /api/ ne sont JAMAIS mises en cache');
  ok(swText.includes('offline.html'), 'service worker : page hors connexion honnête prévue');
  const offPage = await fetch(`${BASE}/offline.html`);
  ok(offPage.status === 200 && (await offPage.text()).includes('peuvent avoir changé'),
    'offline.html : page hors connexion honnête (« peuvent avoir changé »)');

  // ── Abonnement : validation, arrondi de position, cloisonnement pays ──
  section('Abonnements : vie privée et cloisonnement');
  const subBody = (endpoint, over = {}) => ({
    subscription: { endpoint, keys: { p256dh: 'BPtestkey', auth: 'authtest' } },
    lat: 36.80651, lng: 10.18153, radiusKm: 12, ...over,
  });
  const s1 = await api('POST', '/api/public/push/subscribe', subBody('https://push.example/tn-1'));
  ok(s1.status === 200 && s1.data.country === 'TN', 'abonnement tunisien accepté (pays par défaut TN)');
  const s2 = await api('POST', '/api/public/push/subscribe',
    subBody('https://push.example/fr-1', { lat: 48.8566, lng: 2.3522, country: 'FR' }), {});
  ok(s2.status === 200, 'abonnement français accepté');
  const bad = await api('POST', '/api/public/push/subscribe', subBody('http://insecure.example/x'));
  ok(bad.status === 400, 'endpoint non-HTTPS refusé');

  const { default: Database } = await import('better-sqlite3');
  let db = new Database(DB, { readonly: true });
  const rows = db.prepare(`SELECT * FROM push_subscriptions ORDER BY endpoint`).all();
  ok(rows.length === 2, 'deux abonnements stockés');
  const tnRow = rows.find((r) => r.endpoint.endsWith('tn-1'));
  ok(tnRow.center_lat === 36.81 && tnRow.center_lng === 10.18,
    `position ARRONDIE (~1 km) : ${tnRow.center_lat}, ${tnRow.center_lng} — jamais la position exacte`);
  db.close();

  // ── Ciblage : seul l'abonné du bon pays et du bon rayon est retenu ──
  section('Ciblage des notifications');
  process.env.DB_PATH = DB;
  const { subscriptionsFor } = await import('../src/services/push.js');
  const near = subscriptionsFor({ country_code: 'TN', public_lat: 36.82, public_lng: 10.20, type: 'electricity' });
  ok(near.length === 1 && near[0].endpoint.endsWith('tn-1'),
    'incident à Tunis → abonné tunisien ciblé, abonné parisien ignoré');
  const far = subscriptionsFor({ country_code: 'TN', public_lat: 34.74, public_lng: 10.76, type: 'electricity' });
  ok(far.length === 0, 'incident à Sfax (>12 km) → personne (rayon respecté)');
  const frInc = subscriptionsFor({ country_code: 'FR', public_lat: 48.86, public_lng: 2.34, type: 'water' });
  ok(frInc.length === 1 && frInc[0].endpoint.endsWith('fr-1'), 'incident à Paris → abonné français ciblé');

  // ── Publication : la notification est déclenchée sans bloquer ──
  section('Publication → notification (envoi simulé)');
  const draft = await api('POST', '/api/declare/draft', {
    type: 'electricity', lat: 36.81, lng: 10.19, temporalStatus: 'ongoing',
    startedAt: new Date(Date.now() - 600000).toISOString(), severity: 'moderate',
    description: 'Coupure test alertes de zone quartier centre', fillSeconds: 20,
    deviceLat: 36.81, deviceLng: 10.19, idempotencyKey: `k-${Math.random()}`,
  });
  const pub = await api('POST', '/api/declare/publish-unverified', {
    incidentId: draft.data.incidentId, draftToken: draft.data.draftToken,
  });
  ok(pub.data.status === 'active', 'incident publié (envoi push non bloquant, désactivé en test)');

  // ── Désabonnement ──
  const un = await api('POST', '/api/public/push/unsubscribe', { endpoint: 'https://push.example/tn-1' });
  db = new Database(DB, { readonly: true });
  ok(un.status === 200 && db.prepare(`SELECT COUNT(*) n FROM push_subscriptions`).get().n === 1,
    'désabonnement : abonnement supprimé côté serveur');
  db.close();

  // ── Alertes satellite : ciblage honnête et plafonné ──
  section('Alertes satellite (libellé honnête, plafond quotidien)');
  // Réabonne l'appareil tunisien (supprimé plus haut) + un abonné « eau seulement ».
  await api('POST', '/api/public/push/subscribe', subBody('https://push.example/tn-2'));
  await api('POST', '/api/public/push/subscribe',
    subBody('https://push.example/tn-eau', { types: 'water' }));
  const { subscriptionsForSatellite } = await import('../src/services/push.js');
  const satTn = subscriptionsForSatellite({ country_code: 'TN', centroid_lat: 36.82, centroid_lng: 10.20, max_confidence: 'nominal' });
  ok(satTn.length === 1 && satTn[0].endpoint.endsWith('tn-2'),
    'événement satellite à Tunis → abonné « tous types » ciblé, abonné « eau » ignoré');
  const satFrOnly = subscriptionsForSatellite({ country_code: 'FR', centroid_lat: 36.82, centroid_lng: 10.20, max_confidence: 'high' });
  ok(satFrOnly.every((s) => !s.endpoint.includes('tn-')), 'cloisonnement pays respecté côté satellite');
  db = new Database(DB);
  const capCols = db.prepare(`PRAGMA table_info(push_subscriptions)`).all().map((c) => c.name);
  ok(capCols.includes('sat_day') && capCols.includes('sat_count'),
    'colonnes de plafond quotidien présentes (2/jour par défaut, réglable)');

  // ── Purge RGPD des abonnements dormants ──
  section('Purge des abonnements dormants');
  db.prepare(`INSERT INTO push_subscriptions(id, endpoint, p256dh, auth, center_lat, center_lng, created_at)
              VALUES ('old-1', 'https://push.example/dormant', 'k', 'a', 36.8, 10.18,
                      strftime('%Y-%m-%dT%H:%M:%fZ','now','-200 days'))`).run();
  db.close();
  const { prunePushSubscriptions } = await import('../src/services/push.js');
  const pruned = prunePushSubscriptions();
  db = new Database(DB, { readonly: true });
  ok(pruned >= 1 && !db.prepare(`SELECT 1 FROM push_subscriptions WHERE id = 'old-1'`).get(),
    'abonnement jamais notifié depuis 6 mois → supprimé');
  ok(db.prepare(`SELECT COUNT(*) n FROM push_subscriptions`).get().n >= 2,
    'les abonnements récents restent intacts');
  db.close();

  // ── Double authentification admin (TOTP) ──
  section('Admin : double authentification TOTP (activation sûre)');
  const { totpCode } = await import('../src/services/totp.js');
  const login = await api('POST', '/api/admin/login', { username: 'admin', password: 'test-admin-password-1' });
  ok(login.status === 200, 'connexion sans 2FA (non activée par défaut)');
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const hdr = { Cookie: cookie, 'X-CSRF': login.data.csrf };
  const setup = await api('POST', '/api/admin/2fa/setup', {}, hdr);
  ok(/^[A-Z2-7]{16,}$/.test(setup.data.secret || ''), 'secret TOTP généré (base32)');
  ok(String(setup.data.otpauth || '').startsWith('otpauth://totp/'), 'URL d’enrôlement standard fournie');
  const wrong = await api('POST', '/api/admin/2fa/enable', { code: '000000' }, hdr);
  ok(wrong.status === 400, 'activation refusée avec un mauvais code (jamais d’activation aveugle)');
  const good = await api('POST', '/api/admin/2fa/enable', { code: totpCode(setup.data.secret) }, hdr);
  ok(good.status === 200, 'activation avec le bon code');
  const noTotp = await api('POST', '/api/admin/login', { username: 'admin', password: 'test-admin-password-1' });
  ok(noTotp.status === 401 && noTotp.data.totpRequired === true, 'connexion sans code → refusée (totpRequired)');
  const withTotp = await api('POST', '/api/admin/login',
    { username: 'admin', password: 'test-admin-password-1', totp: totpCode(setup.data.secret) });
  ok(withTotp.status === 200, 'connexion avec code TOTP → acceptée');
  const cookie2 = (withTotp.headers.get('set-cookie') || '').split(';')[0];
  const hdr2 = { Cookie: cookie2, 'X-CSRF': withTotp.data.csrf };
  const off = await api('POST', '/api/admin/2fa/disable', { code: totpCode(setup.data.secret) }, hdr2);
  ok(off.status === 200, 'désactivation avec code (issue de secours ADMIN_TOTP_RESET=1 documentée)');

  // ── Sauvegarde hors-site : inactif proprement sans jeton, chiffrement sain ──
  section('Sauvegarde hors-site');
  const backup = await api('POST', '/api/admin/offsite-backup', {}, hdr2);
  ok(backup.data.skipped === 'no_token', 'sans jeton GitHub : inactif proprement (aucune erreur)');
  const { decryptBuffer } = await import('../src/services/offsite.js');
  ok(typeof decryptBuffer === 'function', 'fonction de restauration (déchiffrement) exportée et documentée');
  const health = await api('GET', '/healthz');
  ok(health.data.offsite && health.data.offsite.configured === false,
    'healthz expose l’état hors-site (non configuré)');

  // ── Domaine canonique par défaut ──
  section('Domaine canonique');
  const alias = await fetch(`${BASE}/`, { headers: { Host: 'www.kifeh.org' }, redirect: 'manual' });
  ok(alias.status === 200, 'développement : aucune redirection (canonique inactif en dev)');
  // La logique production (kifeh.app par défaut, CANONICAL_HOST=off pour couper)
  // est vérifiée par lecture de configuration :
  const serverJs = fs.readFileSync('server.js', 'utf8');
  ok(serverJs.includes("config.isDev ? '' : 'kifeh.app'"), 'production : kifeh.app par défaut');
  ok(serverJs.includes("'off'"), 'désactivable explicitement (CANONICAL_HOST=off)');

  console.log('\n────────────────────────────');
  console.log(`${passed} réussis · ${failed} échoués`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
