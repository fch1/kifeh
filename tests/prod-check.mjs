// Vérification de bout en bout en MODE PRODUCTION (comme sur Render) :
// draft → contact email_code → code récupéré via Admin/Envois → verify → publié
// + email_link → verify-link + resend + SMS via outbox admin.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
fs.rmSync('data/prod.db', { force: true }); fs.rmSync('data/prod.db-wal', { force: true }); fs.rmSync('data/prod.db-shm', { force: true });
const server = spawn('node', ['server.js'], { env: { ...process.env, NODE_ENV: 'production', PORT: '3996', DB_PATH: 'data/prod.db', BASE_URL: 'http://localhost:3996', ADMIN_PASSWORD: 'check-1234', ADMIN_USERNAME: 'admin' }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));
const B = 'http://localhost:3996';
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${l}`); };
async function api(m, u, b, h = {}) { const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', ...h }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }; }
try {
  // outbox dev absente en prod
  ok((await fetch(B + '/api/dev/outbox')).status === 404, 'routes dev désactivées en production');
  // login admin
  const login = await api('POST', '/api/admin/login', { username: 'admin', password: 'check-1234' });
  ok(login.status === 200, 'connexion admin');
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const H = { Cookie: cookie, 'X-CSRF': login.data.csrf };
  const outbox = async () => (await api('GET', '/api/admin/outbox', null, H)).data.outbox;
  const draft = async (over = {}) => (await api('POST', '/api/declare/draft', {
    type: 'electricity', lat: 36.8 + Math.random() * .2, lng: 10.1 + Math.random() * .2,
    temporalStatus: 'ongoing', startedAt: new Date(Date.now() - 1800e3).toISOString(),
    description: `Vérif production ${Math.random().toString(36).slice(2)}`, severity: 'moderate',
    fillSeconds: 20, idempotencyKey: `p-${Math.random()}`,
  })).data;
  for (const [i, d] of Object.entries(await Promise.all([draft(), draft(), draft()]))) {
    void i; if (!d.incidentId) { ok(false, 'création de brouillon'); }
  }
  // — email_code complet —
  const d1 = await draft();
  const c1 = await api('POST', '/api/declare/contact', { incidentId: d1.incidentId, draftToken: d1.draftToken, method: 'email_code', email: 'a@exemple.tn', consent: true });
  ok(c1.status === 200, 'contact e-mail (code) → 200');
  const m1 = (await outbox()).find((m) => m.kind === 'email' && m.to === 'a@exemple.tn');
  ok(Boolean(m1), 'code visible dans Admin → Envois');
  const code1 = (m1?.text.match(/\b(\d{6})\b/) || [])[1];
  const v1 = await api('POST', '/api/declare/verify', { verificationId: c1.data.verificationId, code: code1 });
  ok(v1.data.ok === true && v1.data.status === 'active', 'vérification e-mail (code) → incident publié');
  // — email_link complet + renvoi —
  const d2 = await draft();
  const c2 = await api('POST', '/api/declare/contact', { incidentId: d2.incidentId, draftToken: d2.draftToken, method: 'email_link', email: 'b@exemple.tn', consent: true });
  ok(c2.status === 200, 'contact e-mail (lien) → 200');
  const m2 = (await outbox()).find((m) => m.kind === 'email' && m.to === 'b@exemple.tn');
  const url = new URL(m2.text.match(/https?:\S+/)[0]);
  const v2 = await api('POST', '/api/declare/verify-link', { vid: url.searchParams.get('vid'), t: url.searchParams.get('t') });
  ok(v2.data.ok === true, 'lien e-mail → incident publié');
  // — SMS complet —
  const d3 = await draft();
  const c3 = await api('POST', '/api/declare/contact', { incidentId: d3.incidentId, draftToken: d3.draftToken, method: 'sms', phone: '+21620555666', consent: true });
  ok(c3.status === 200, 'contact SMS → 200');
  const m3 = (await outbox()).find((m) => m.kind === 'sms' && m.to === '+21620555666');
  const code3 = (m3?.text.match(/\b(\d{6})\b/) || [])[1];
  const v3 = await api('POST', '/api/declare/verify', { verificationId: c3.data.verificationId, code: code3 });
  ok(v3.data.ok === true, 'vérification SMS → incident publié');
  // — reprise auto : contact sur brouillon révoqué → code explicite —
  const reuse = await api('POST', '/api/declare/contact', { incidentId: d3.incidentId, draftToken: d3.draftToken, method: 'sms', phone: '+21620555667', consent: true });
  ok(reuse.status === 403 && reuse.data.code === 'draft_expired', 'brouillon révoqué → code de reprise pour le client');
  // — carte —
  const map = await api('GET', '/api/public/incidents?minLat=36&maxLat=37&minLng=10&maxLng=11');
  ok(map.data.incidents.length >= 3, `incidents visibles sur la carte (${map.data.incidents.length})`);
  // — resynchronisation du mot de passe admin via l'environnement —
  server.kill();
  await new Promise((r) => setTimeout(r, 500));
  const server2 = spawn('node', ['server.js'], { env: { ...process.env, NODE_ENV: 'production', PORT: '3996', DB_PATH: 'data/prod.db', BASE_URL: 'http://localhost:3996', ADMIN_PASSWORD: 'nouveau-5678', ADMIN_USERNAME: 'admin', VERIFICATION_REQUIRED: '0' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
  try {
    const relog = await api('POST', '/api/admin/login', { username: 'admin', password: 'nouveau-5678' });
    ok(relog.status === 200, 'ADMIN_PASSWORD modifié dans l’environnement → nouveau mot de passe actif');
    const cfg2 = await api('GET', '/api/public/config');
    ok(cfg2.data.verificationRequired === false, 'VERIFICATION_REQUIRED=0 (env) désactive l’OTP sans toucher à l’admin');
  } finally { server2.kill(); }
} finally { server.kill(); }
console.log(`\n${pass} réussis · ${fail} échoués`);
process.exit(fail ? 1 : 0);
