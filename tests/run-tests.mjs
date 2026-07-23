// Tests de bout en bout : lance le serveur sur une base vierge et déroule
// les scénarios clés (section 16 du cahier des charges).
// Usage : npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const DB = 'data/test.db';
const ADMIN_PASSWORD = 'test-admin-password-1';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
}
function section(t) { console.log(`\n■ ${t}`); }

async function api(method, url, body, headers = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, data, headers: res.headers };
}

async function outboxLast(kind) {
  const { data } = await api('GET', '/api/dev/outbox');
  return data.outbox.find((m) => m.kind === kind);
}
function extractOtp(text) { return (text.match(/\b(\d{6})\b/) || [])[1]; }

const draftBody = (over = {}) => ({
  type: 'electricity', lat: 48.8566, lng: 2.3522,
  locationSource: 'gps', gpsAccuracy: 12, deviceLat: 48.8565, deviceLng: 2.3520,
  address: '10 rue de Rivoli, Paris', publicArea: 'Paris Centre, Paris, 75004',
  temporalStatus: 'ongoing', startedAt: new Date(Date.now() - 30 * 60000).toISOString(),
  timeApproximate: false, description: `Coupure de courant dans le quartier (cas ${Math.random().toString(36).slice(2, 8)})`,
  severity: 'moderate', fillSeconds: 25,
  idempotencyKey: `k-${Math.random()}`,
  ...over,
});

let phoneSeq = 100000;
const newPhone = () => `+3361234${phoneSeq++}`;

// Parcours complet SMS → incident actif. Renvoie { publicId, manageUrl, incidentId }.
async function declareFull(over = {}, contactOver = {}) {
  const d = await api('POST', '/api/declare/draft', draftBody(over));
  if (d.status !== 200) return { error: d.data.error, status: d.status };
  const c = await api('POST', '/api/declare/contact', {
    incidentId: d.data.incidentId, draftToken: d.data.draftToken,
    method: 'sms', phone: newPhone(), consent: true, ...contactOver,
  });
  if (c.status !== 200) return { error: c.data.error, status: c.status, draft: d.data };
  const sms = await outboxLast('sms');
  const v = await api('POST', '/api/declare/verify', {
    verificationId: c.data.verificationId, code: extractOtp(sms.text),
  });
  return { ...v.data, incidentId: d.data.incidentId, draft: d.data, verificationId: c.data.verificationId };
}

// ---------------------------------------------------------------------------
async function main() {
  fs.rmSync(DB, { force: true });
  fs.rmSync(`${DB}-wal`, { force: true });
  fs.rmSync(`${DB}-shm`, { force: true });

  const server = spawn('node', ['server.js'], {
    env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
           BASE_URL: BASE, ADMIN_PASSWORD, ADMIN_USERNAME: 'admin', SANDBOX_ENABLED: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  server.stdout.on('data', () => {});
  await new Promise((r) => setTimeout(r, 1200));

  let adminCookie = '', csrf = '';
  try {
    // ── Connexion admin + assouplissement des limites pour les tests ──
    section('Administration : connexion et configuration');
    const login = await api('POST', '/api/admin/login', { username: 'admin', password: ADMIN_PASSWORD });
    ok(login.status === 200, 'connexion admin');
    csrf = login.data.csrf;
    adminCookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const adminH = { Cookie: adminCookie, 'X-CSRF': csrf };
    const badLogin = await api('POST', '/api/admin/login', { username: 'admin', password: 'mauvais' });
    ok(badLogin.status === 401, 'mauvais mot de passe rejeté');
    const setr = await api('POST', '/api/admin/settings', { settings: {
      max_declarations_per_ip_per_h: '1000', max_declarations_per_contact_per_day: '1000',
      min_form_fill_s: '5', otp_resend_delay_s: '1', max_otp_sends_per_ip_per_h: '1000',
    } }, adminH);
    ok(setr.status === 200, 'mise à jour de la configuration');
    const noCsrf = await api('POST', '/api/admin/settings', { settings: {} }, { Cookie: adminCookie });
    ok(noCsrf.status === 403, 'mutation sans jeton CSRF rejetée');

    // ── Parcours nominal : incident qui vient de commencer (SMS) ──
    section('Déclaration : incident en cours, vérification SMS');
    const r1 = await declareFull();
    ok(r1.ok === true, 'parcours complet OTP SMS');
    ok(/^INC-[A-Z0-9]{6}$/.test(r1.publicId || ''), `identifiant public (${r1.publicId})`);
    ok(r1.status === 'active', 'statut actif après vérification');
    ok((r1.manageUrl || '').includes('/manage.html?token='), 'lien de gestion fourni');
    const smsLink = await outboxLast('sms');
    ok(smsLink.text.includes('manage.html?token='), 'lien de gestion envoyé par SMS');

    // ── Anonymisation et absence de fuite de données ──
    section('Confidentialité : carte publique');
    const map = await api('GET', '/api/public/incidents?minLat=48&maxLat=49&minLng=2&maxLng=3');
    const pub = map.data.incidents.find((i) => i.public_id === r1.publicId);
    ok(Boolean(pub), 'incident visible sur la carte');
    const dist = Math.hypot((pub.lat - 48.8566) * 111320, (pub.lng - 2.3522) * 111320 * Math.cos(48.85 * Math.PI / 180));
    ok(dist > 80 && dist < 320, `position anonymisée (décalage ${Math.round(dist)} m)`);
    const keys = Object.keys(pub).join(',');
    ok(!keys.includes('address') && !keys.includes('reporter') && !keys.includes('trust'),
      'aucune donnée sensible exposée publiquement');
    const detail = await api('GET', `/api/public/incidents/${r1.publicId}`);
    ok(detail.status === 200 && !('comment' in detail.data), 'détail public sans champs privés');

    // ── Double soumission (idempotence) ──
    section('Anti-abus : double soumission');
    const key = `same-${Math.random()}`;
    const a1 = await api('POST', '/api/declare/draft', draftBody({ idempotencyKey: key }));
    const a2 = await api('POST', '/api/declare/draft', draftBody({ idempotencyKey: key }));
    ok(a1.data.incidentId === a2.data.incidentId, 'même clé d’idempotence → même brouillon');

    // ── Honeypot et remplissage trop rapide ──
    const hp = await api('POST', '/api/declare/draft', draftBody({ website: 'http://spam' }));
    ok(hp.status === 400, 'honeypot rempli → rejet');
    const fast = await api('POST', '/api/declare/draft', draftBody({ fillSeconds: 1 }));
    ok(fast.status === 400, 'remplissage trop rapide → rejet');

    // ── Validation des périodes ──
    section('Périodes');
    const endBefore = await api('POST', '/api/declare/draft', draftBody({
      temporalStatus: 'finished',
      startedAt: new Date().toISOString(),
      endedAt: new Date(Date.now() - 3600_000).toISOString(),
    }));
    ok(endBefore.status === 400, 'fin antérieure au début → rejet');
    const finished = await declareFull({
      temporalStatus: 'finished', lat: 45.75, lng: 4.85,
      startedAt: new Date(Date.now() - 7200_000).toISOString(),
      endedAt: new Date(Date.now() - 3600_000).toISOString(),
      timeApproximate: true,
    });
    ok(finished.ok === true, 'déclaration d’un incident déjà terminé (heure approximative)');
    const future = await api('POST', '/api/declare/draft', draftBody({
      startedAt: new Date(Date.now() + 7200_000).toISOString() }));
    ok(future.status === 400, 'début dans le futur → rejet');

    // ── OTP incorrect / expiré / renvoi ──
    section('OTP : erreurs et expiration');
    const d2 = await api('POST', '/api/declare/draft', draftBody({ lat: 43.6, lng: 1.44 }));
    const c2 = await api('POST', '/api/declare/contact', {
      incidentId: d2.data.incidentId, draftToken: d2.data.draftToken,
      method: 'sms', phone: newPhone(), consent: true,
    });
    const bad = await api('POST', '/api/declare/verify', { verificationId: c2.data.verificationId, code: '000000' });
    ok(bad.status === 400 && bad.data.error.includes('incorrect'), 'code OTP incorrect → erreur explicite');
    for (let i = 0; i < 5; i++) await api('POST', '/api/declare/verify', { verificationId: c2.data.verificationId, code: '000000' });
    const blocked = await api('POST', '/api/declare/verify', { verificationId: c2.data.verificationId, code: '000000' });
    ok(blocked.data.error.toLowerCase().includes('bloqu'), 'blocage après tentatives répétées');
    // Expiration : on force la date en base.
    const d3 = await api('POST', '/api/declare/draft', draftBody({ lat: 47.2, lng: -1.55 }));
    const c3 = await api('POST', '/api/declare/contact', {
      incidentId: d3.data.incidentId, draftToken: d3.data.draftToken,
      method: 'sms', phone: newPhone(), consent: true,
    });
    const Database = (await import('better-sqlite3')).default;
    const tdb = new Database(DB);
    tdb.prepare(`UPDATE verifications SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?`).run(c3.data.verificationId);
    const sms3 = await outboxLast('sms');
    const expired = await api('POST', '/api/declare/verify', { verificationId: c3.data.verificationId, code: extractOtp(sms3.text) });
    ok(expired.status === 400 && expired.data.expired === true, 'code OTP expiré → demande de renvoi');
    await new Promise((r) => setTimeout(r, 1100));
    const rs = await api('POST', '/api/declare/resend', { verificationId: c3.data.verificationId });
    ok(rs.status === 200, 'renvoi d’un nouveau code (SMS non reçu)');
    const sms4 = await outboxLast('sms');
    const v4 = await api('POST', '/api/declare/verify', { verificationId: c3.data.verificationId, code: extractOtp(sms4.text) });
    ok(v4.data.ok === true, 'vérification avec le nouveau code');

    // ── Lien e-mail à usage unique ──
    section('Vérification par lien e-mail');
    const d5 = await api('POST', '/api/declare/draft', draftBody({ lat: 44.84, lng: -0.58, type: 'water' }));
    const c5 = await api('POST', '/api/declare/contact', {
      incidentId: d5.data.incidentId, draftToken: d5.data.draftToken,
      method: 'email_link', email: `test${Date.now()}@exemple.fr`, consent: true,
    });
    ok(c5.status === 200, 'envoi du lien e-mail');
    const mail = await outboxLast('email');
    const url = new URL(mail.text.match(/https?:\S+/)[0]);
    const vid = url.searchParams.get('vid'), t = url.searchParams.get('t');
    const link1 = await api('POST', '/api/declare/verify-link', { vid, t });
    ok(link1.data.ok === true, 'validation via le lien');
    const link2 = await api('POST', '/api/declare/verify-link', { vid, t });
    ok(link2.status === 400 && link2.data.error.includes('déjà'), 'lien déjà utilisé → rejet (usage unique)');

    // ── Doublons + « je suis aussi concerné » ──
    section('Doublons et confirmations');
    const dup = await api('POST', '/api/declare/check-duplicates', {
      type: 'electricity', lat: 48.8570, lng: 2.3530, startedAt: new Date().toISOString(),
    });
    ok(dup.data.similar.length >= 1 && dup.data.similar[0].publicId === r1.publicId,
      'incident similaire détecté à proximité');
    const cs = await api('POST', '/api/public/confirm/start', {
      publicId: r1.publicId, method: 'sms', phone: newPhone(), consent: true,
    });
    ok(cs.status === 200, 'démarrage de la confirmation');
    const smsC = await outboxLast('sms');
    const cv = await api('POST', '/api/public/confirm/verify', {
      verificationId: cs.data.verificationId, code: extractOtp(smsC.text),
    });
    ok(cv.data.ok === true && cv.data.confirmations === 1, 'confirmation comptabilisée');
    const cs2 = await api('POST', '/api/public/confirm/start', {
      publicId: r1.publicId, method: 'sms', phone: `+3361234${phoneSeq - 1}`, consent: true,
    });
    ok(cs2.status === 400, 'double confirmation par le même contact → rejet');

    // ── Gestion par le déclarant ──
    section('Gestion et clôture');
    const token = new URL(r1.manageUrl).searchParams.get('token');
    const gi = await api('GET', `/api/manage/incident?token=${token}`);
    ok(gi.status === 200 && gi.data.address, 'le déclarant voit sa propre adresse exacte');
    const still = await api('POST', '/api/manage/still-ongoing', { token });
    ok(still.status === 200, '« toujours en cours » prolonge l’expiration');
    const badClose = await api('POST', '/api/manage/close', { token, endedAt: '2019-01-01T00:00:00Z' });
    ok(badClose.status === 400, 'clôture avec fin antérieure au début → rejet');
    const close = await api('POST', '/api/manage/close', { token, endedAt: new Date().toISOString() });
    ok(close.data.status === 'resolved', 'clôture par le déclarant → résolu');
    const badToken = await api('GET', '/api/manage/incident?token=jeton-invalide');
    ok(badToken.status === 403, 'lien de gestion invalide → refus');

    // ── Expiration automatique ──
    section('Expiration automatique');
    const r6 = await declareFull({ lat: 47.32, lng: 5.04, deviceLat: 47.3201, deviceLng: 5.0401 });
    tdb.prepare(`UPDATE incidents SET expires_at = '2020-01-01T00:00:00Z' WHERE public_id = ?`).run(r6.publicId);
    ok(r6.status === 'active', 'incident publié automatiquement (score de confiance suffisant)');
    await api('POST', '/api/dev/tick');
    const after = await api('GET', `/api/public/incidents/${r6.publicId}`);
    ok(after.data.status === 'expired', 'incident actif non confirmé → expiré');

    // ── Bot : rate limiting par IP ──
    section('Anti-bot : limitation par IP');
    await api('POST', '/api/admin/settings', { settings: { max_declarations_per_ip_per_h: '3' } }, adminH);
    let last;
    for (let i = 0; i < 5; i++) last = await api('POST', '/api/declare/draft', draftBody({ lat: 50 + i * 0.01, lng: 3 }));
    ok(last.status === 429, 'volume anormal de déclarations → 429');
    await api('POST', '/api/admin/settings', { settings: { max_declarations_per_ip_per_h: '1000' } }, adminH);

    // ── Description avec lien → rejet ──
    const spam = await api('POST', '/api/declare/draft', draftBody({ description: 'Cliquez ici http://arnaque.example' }));
    ok(spam.status === 429 || spam.status === 400, 'description contenant un lien → rejet');

    // ── Incendie : gravité danger immédiat ──
    section('Incendie');
    const fire = await declareFull({ type: 'fire', severity: 'immediate_danger', lat: 43.3, lng: 5.4, deviceLat: 43.3001, deviceLng: 5.4001 });
    ok(fire.ok === true, 'déclaration incendie enregistrée');

    // ── Admin : modération ──
    section('Administration : modération');
    const list = await api('GET', '/api/admin/incidents?status=resolved', null, adminH);
    ok(list.status === 200 && list.data.incidents.length >= 1, 'liste des incidents résolus');
    const det = await api('GET', `/api/admin/incidents/${r1.publicId}`, null, adminH);
    ok(det.data.lat != null && det.data.address, 'localisation exacte visible pour le rôle autorisé');
    const audit = await api('GET', '/api/admin/audit', null, adminH);
    ok(audit.data.log.some((l) => l.action === 'view_exact_location'), 'consultation de la localisation exacte journalisée');
    const rej = await api('POST', `/api/admin/incidents/${fire.publicId}/reject`, { reason: 'test' }, adminH);
    ok(rej.status === 200, 'rejet d’un incident');
    const merged = await api('POST', `/api/admin/incidents/${finished.publicId}/merge`, { mainId: r1.publicId }, adminH);
    ok(merged.status === 200, 'fusion de doublons');
    const stats = await api('GET', '/api/admin/stats', null, adminH);
    ok(stats.status === 200 && Array.isArray(stats.data.byType), 'statistiques agrégées');
    const anon = await api('GET', '/api/admin/incidents');
    ok(anon.status === 401, 'admin sans session → 401');

    // ── Suppression par le déclarant ──
    section('Droit à l’effacement');
    const r7 = await declareFull({ lat: 48.11, lng: -1.68, deviceLat: 48.1101, deviceLng: -1.6801 });
    const tok7 = new URL(r7.manageUrl).searchParams.get('token');
    const del = await api('POST', '/api/manage/delete', { token: tok7 });
    ok(del.status === 200, 'suppression par le déclarant');
    const gone = await api('GET', `/api/public/incidents/${r7.publicId}`);
    ok(gone.status === 404, 'incident supprimé invisible publiquement');

    // ── Type « coupure internet » + parcours en arabe ──
    section('Coupure internet + langue arabe');
    const dAr = await api('POST', '/api/declare/draft', draftBody({
      type: 'internet', lat: 36.8065, lng: 10.1815, deviceLat: 36.8066, deviceLng: 10.1816,
      description: `Internet maq'touaa fil houma (cas ${Math.random().toString(36).slice(2, 8)})`,
    }), { 'X-Lang': 'ar' });
    ok(dAr.status === 200, 'brouillon de type internet accepté');
    const cAr = await api('POST', '/api/declare/contact', {
      incidentId: dAr.data.incidentId, draftToken: dAr.data.draftToken,
      method: 'sms', phone: newPhone(), consent: true,
    }, { 'X-Lang': 'ar' });
    ok(cAr.status === 200, 'contact accepté (X-Lang: ar)');
    const smsAr = await outboxLast('sms');
    ok(/[\u0600-\u06FF]/.test(smsAr.text), 'SMS OTP envoyé en arabe');
    const vAr = await api('POST', '/api/declare/verify', {
      verificationId: cAr.data.verificationId, code: extractOtp(smsAr.text),
    }, { 'X-Lang': 'ar' });
    ok(vAr.data.ok === true && vAr.data.incident.type === 'internet', 'incident internet publié');
    const smsMg = await outboxLast('sms');
    ok(/[\u0600-\u06FF]/.test(smsMg.text) && smsMg.text.includes('manage.html?token='),
      'lien de gestion envoyé en arabe');
    const mapTn = await api('GET', '/api/public/incidents?types=internet&minLat=36&maxLat=37&minLng=10&maxLng=11');
    ok(mapTn.data.incidents.some((i) => i.public_id === vAr.data.publicId), 'filtre par type internet sur la carte');
    const errAr = await api('POST', '/api/declare/verify', { verificationId: cAr.data.verificationId, code: '000000' }, { 'X-Lang': 'ar' });
    ok(/[\u0600-\u06FF]/.test(errAr.data.error || ''), 'message d’erreur localisé en arabe');
    const cfg = await api('GET', '/api/public/config');
    ok(cfg.data.otherCategoryEnabled === false, 'config publique : catégorie Autre désactivée par défaut');

    // ── Brouillon révoqué après publication → nouvelle déclaration possible ──
    section('Plusieurs déclarations successives');
    const rA = await declareFull({ lat: 35.83, lng: 10.63, deviceLat: 35.8301, deviceLng: 10.6301 });
    ok(rA.ok === true, 'première déclaration publiée');
    const reuse = await api('POST', '/api/declare/contact', {
      incidentId: rA.incidentId, draftToken: rA.draft.draftToken,
      method: 'sms', phone: newPhone(), consent: true,
    });
    ok(reuse.status === 403 && reuse.data.code === 'draft_expired',
      'jeton de brouillon révoqué → code explicite pour re-création côté client');
    const rB = await declareFull({ lat: 35.84, lng: 10.64, deviceLat: 35.8401, deviceLng: 10.6401 });
    ok(rB.ok === true && rB.publicId !== rA.publicId, 'seconde déclaration créée sans blocage');
    // Réutilisation d'une clé d'idempotence dont le brouillon a été publié :
    const keyC = `kc-${Math.random()}`;
    const k1 = await api('POST', '/api/declare/draft', draftBody({ idempotencyKey: keyC, lat: 35.85, lng: 10.65 }));
    const kc = await api('POST', '/api/declare/contact', { incidentId: k1.data.incidentId, draftToken: k1.data.draftToken, method: 'sms', phone: newPhone(), consent: true });
    const smsC2 = await outboxLast('sms');
    await api('POST', '/api/declare/verify', { verificationId: kc.data.verificationId, code: extractOtp(smsC2.text) });
    const k2 = await api('POST', '/api/declare/draft', draftBody({ idempotencyKey: keyC, lat: 35.85, lng: 10.65 }));
    ok(k2.status === 200 && k2.data.incidentId !== k1.data.incidentId,
      'clé d’idempotence obsolète ignorée → nouveau brouillon valide');

    // ── Mode transitoire : vérification OTP désactivée ──
    section('Vérification désactivée (réglage admin)');
    const puvBlocked = await api('POST', '/api/declare/publish-unverified', { incidentId: 'x', draftToken: 'y' });
    ok(puvBlocked.status === 403, 'publication directe refusée quand la vérification est active');
    await api('POST', '/api/admin/settings', { settings: { verification_required: '0' } }, adminH);
    const cfgOff = await api('GET', '/api/public/config');
    ok(cfgOff.data.verificationRequired === false, 'config publique reflète la désactivation');
    const dv = await api('POST', '/api/declare/draft', draftBody({ lat: 34.74, lng: 10.76, deviceLat: 34.7401, deviceLng: 10.7601 }));
    const pv = await api('POST', '/api/declare/publish-unverified', { incidentId: dv.data.incidentId, draftToken: dv.data.draftToken });
    ok(pv.data.ok === true && pv.data.status === 'active', 'publication directe sans OTP → incident actif');
    ok((pv.data.manageUrl || '').includes('token='), 'lien de gestion fourni sans contact');
    const cd = await api('POST', '/api/public/confirm/direct', { publicId: pv.data.publicId });
    ok(cd.data.ok === true && cd.data.confirmations === 1, 'confirmation « aussi concerné » sans OTP');
    const cd2 = await api('POST', '/api/public/confirm/direct', { publicId: pv.data.publicId });
    ok(cd2.status === 400, 'double confirmation même IP → refusée');
    await api('POST', '/api/admin/settings', { settings: { verification_required: '1' } }, adminH);
    const reBlocked = await api('POST', '/api/declare/publish-unverified', { incidentId: dv.data.incidentId, draftToken: dv.data.draftToken });
    ok(reBlocked.status === 403, 'réactivation du réglage → OTP de nouveau obligatoire');

    // ── Description facultative ──
    const noDesc = await declareFull({ lat: 33.88, lng: 10.10, deviceLat: 33.8801, deviceLng: 10.1001, description: '' });
    ok(noDesc.ok === true, 'déclaration sans description acceptée');

    // ── Pages statiques ──
    section('Pages');
    for (const p of ['/', '/declare.html', '/manage.html', '/verify.html', '/admin.html', '/legal.html']) {
      const res = await fetch(`${BASE}${p}`);
      ok(res.status === 200, `page ${p}`);
    }

    tdb.close();
  } finally {
    server.kill();
  }

  console.log(`\n────────────────────────────`);
  console.log(`${passed} réussis · ${failed} échoués`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
