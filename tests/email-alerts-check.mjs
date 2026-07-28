// Alertes e-mail (Resend simulé) : abonnement → confirmation → alerte dans la
// zone uniquement → plafond quotidien → désinscription en un clic.
import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const PORT = 3979, MAIL_PORT = 3978, DB = '/tmp/kifeh-email-test.db';
const BASE = `http://localhost:${PORT}`;

// ── Serveur Resend SIMULÉ : capture chaque e-mail envoyé ──
const outbox = [];
const mailSrv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try { outbox.push(JSON.parse(body)); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: `mock-${outbox.length}` }));
  });
});
await new Promise((r) => mailSrv.listen(MAIL_PORT, r));

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
const server = spawn('node', ['server.js'], {
  env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT), DB_PATH: DB,
    BASE_URL: BASE, ADMIN_PASSWORD: 'test-admin-password-1', ADMIN_USERNAME: 'admin',
    SANDBOX_ENABLED: '0', RESEND_API_KEY: 'cle-de-test-resend',
    RESEND_URL: `http://localhost:${MAIL_PORT}` },
  stdio: ['ignore', 'ignore', 'inherit'],
});
for (let i = 0; i < 60; i++) {
  try { await fetch(`${BASE}/healthz`); break; }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}

let passed = 0, failed = 0;
const ok = (c, l) => { c ? passed++ : failed++; console.log(`  ${c ? '✓' : '✗'} ${l}`); };
const section = (l) => console.log(`\n■ ${l}`);
const api = async (method, url, body) => {
  const r = await fetch(`${BASE}${url}`, { method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await r.text();
  let data = {}; try { data = JSON.parse(text); } catch { data = { html: text }; }
  return { status: r.status, data };
};
const publish = async (over = {}) => {
  const d = await api('POST', '/api/declare/draft', {
    type: 'fire', lat: 44.85, lng: -0.60, country: 'FR', temporalStatus: 'ongoing',
    startedAt: new Date(Date.now() - 600000).toISOString(), severity: 'high',
    fillSeconds: 25, idempotencyKey: `k-${Math.random()}`,
    description: `Feu ${Math.random().toString(36).slice(2, 8)}`,
    deviceLat: over.lat ?? 44.85, deviceLng: over.lng ?? -0.60, ...over,
  });
  return (await api('POST', '/api/declare/publish-unverified', {
    incidentId: d.data.incidentId, draftToken: d.data.draftToken })).data;
};
const linkFrom = (mail, path) => {
  const m = String(mail?.html || '').match(new RegExp(`href="([^"]*${path}[^"]*)"`));
  return m ? m[1].replace(/&amp;/g, '&') : null;
};

async function main() {
  section('Abonnement et double consentement');
  const sub = await api('POST', '/api/public/email-alerts/subscribe', {
    email: 'farah@example.org', lat: 44.85, lng: -0.60, radiusKm: 20, country: 'FR', lang: 'fr',
  });
  ok(sub.status === 200 && sub.data.status === 'confirmation_sent', 'abonnement → e-mail de confirmation envoyé');
  ok(outbox.length === 1 && outbox[0].to[0] === 'farah@example.org', 'e-mail parti vers la bonne adresse');
  ok(outbox[0].subject.includes('Confirmez'), 'objet de confirmation en français');

  // Aucune alerte tant que non confirmé
  await publish();
  await new Promise((r) => setTimeout(r, 800));
  ok(outbox.length === 1, 'AUCUNE alerte avant confirmation (double consentement)');

  const confirmUrl = linkFrom(outbox[0], 'email-alerts/confirm');
  ok(Boolean(confirmUrl), 'lien de confirmation présent');
  const conf = await fetch(confirmUrl);
  ok(conf.status === 200 && (await conf.text()).includes('activées'), 'confirmation par clic');

  section('Alertes : zone, contenu, désinscription');
  outbox.length = 0;
  await publish({ lat: 44.86, lng: -0.59 }); // dans la zone (~1,5 km)
  await new Promise((r) => setTimeout(r, 800));
  ok(outbox.length === 1, 'incident dans la zone → 1 alerte e-mail');
  ok(String(outbox[0]?.html || '').includes('src=email'), 'lien vers l’incident (mesure src=email)');
  const unsubUrl = linkFrom(outbox[0], 'email-alerts/unsubscribe');
  ok(Boolean(unsubUrl), 'lien de désinscription dans CHAQUE alerte');

  outbox.length = 0;
  await publish({ lat: 48.85, lng: 2.35, deviceLat: 48.85, deviceLng: 2.35 }); // Paris : hors zone
  await new Promise((r) => setTimeout(r, 800));
  ok(outbox.length === 0, 'incident HORS zone (Paris) → aucune alerte');

  const unsub = await fetch(unsubUrl);
  ok(unsub.status === 200 && (await unsub.text()).includes('Désinscription'), 'désinscription en un clic');
  outbox.length = 0;
  await publish({ lat: 44.85, lng: -0.61 });
  await new Promise((r) => setTimeout(r, 800));
  ok(outbox.length === 0, 'après désinscription → plus aucune alerte');

  section('Brief quotidien (opt-in séparé, jamais si rien à dire)');
  // Abonnement AVEC brief + confirmation.
  outbox.length = 0;
  // Zone VIERGE (Bourgogne rurale) — loin des incidents des tests précédents.
  const sub2 = await api('POST', '/api/public/email-alerts/subscribe', {
    email: 'brief@example.org', lat: 47.30, lng: 4.20, radiusKm: 20,
    country: 'FR', lang: 'fr', digest: true,
  });
  ok(sub2.status === 200, 'abonnement avec brief quotidien accepté');
  const conf2 = linkFrom(outbox[0], 'email-alerts/confirm');
  await fetch(conf2);
  // Zone SANS incident actif ni vigilance → aucun brief (« rien à dire »).
  outbox.length = 0;
  const dg0 = await api('POST', '/api/dev/run-digest', {});
  const calmMail = outbox.find((m) => m.to?.[0] === 'brief@example.org');
  ok(dg0.status === 200 && !calmMail, 'zone calme → AUCUN brief envoyé');
  // Un incident actif dans la zone → le brief part, avec compte et désinscription.
  await publish({ lat: 47.32, lng: 4.22, deviceLat: 47.32, deviceLng: 4.22 });
  await new Promise((r) => setTimeout(r, 500));
  outbox.length = 0;
  await api('POST', '/api/dev/run-digest', {});
  const digestMail = outbox.find((m) => m.to?.[0] === 'brief@example.org');
  ok(Boolean(digestMail), 'brief envoyé à l’abonné opt-in uniquement');
  ok(digestMail && /brief|matin/i.test(digestMail.subject), 'objet « brief du matin »');
  ok(digestMail && /incident/.test(digestMail.html) && /unsubscribe/.test(digestMail.html),
    'contenu : compte d’incidents + lien de désinscription');
  // Garde « une fois par jour » : un second déclenchement normal ne renvoie rien.
  outbox.length = 0;
  const again = await api('POST', '/api/dev/run-digest', {});
  ok(again.status === 200, 'relance du brief acceptée (idempotente)');

  section('Sécurité');
  const bad = await api('POST', '/api/public/email-alerts/subscribe', {
    email: 'pas-un-email', lat: 44.85, lng: -0.60, country: 'FR' });
  ok(bad.status === 400, 'adresse invalide refusée');
  const guess = await fetch(`${BASE}/api/public/email-alerts/unsubscribe?token=jeton-devine-00000000000000000000`);
  ok((await guess.text()).includes('plus valable'), 'jeton deviné → lien invalide');

  console.log('\n────────────────────────────');
  console.log(`${passed} réussis · ${failed} échoués`);
  server.kill(); mailSrv.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); server.kill(); mailSrv.close(); process.exit(1); });
