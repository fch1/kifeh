// Vérification du cloisonnement sandbox : /sandbox = même app, données séparées.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
for (const f of ['data/sbx-main.db', 'data/sandbox.db']) { fs.rmSync(f, { force: true }); fs.rmSync(f + '-wal', { force: true }); fs.rmSync(f + '-shm', { force: true }); }
const server = spawn('node', ['server.js'], {
  env: { ...process.env, NODE_ENV: 'production', PORT: '3995', DB_PATH: 'data/sbx-main.db',
         BASE_URL: 'http://localhost:3995', ADMIN_PASSWORD: 'sbx-1234', SANDBOX_ENABLED: '1',
         SANDBOX_VERIFICATION_REQUIRED: '0' },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 4500));
const B = 'http://localhost:3995';
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${l}`); };
async function api(m, u, b) { const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})) }; }
try {
  const h = await api('GET', '/sandbox/healthz');
  ok(h.data.ok === true, 'sandbox démarrée et joignable via /sandbox');
  const cfgS = await api('GET', '/sandbox/api/public/config');
  ok(cfgS.data.sandbox === true, 'la sandbox se déclare comme telle (bandeau de test)');
  ok(cfgS.data.verificationRequired === false, 'SANDBOX_VERIFICATION_REQUIRED=0 : OTP désactivé dans la sandbox uniquement');
  const cfgP = await api('GET', '/api/public/config');
  ok(cfgP.data.sandbox === false && cfgP.data.verificationRequired === true, 'la prod garde sa propre configuration');
  const page = await fetch(B + '/sandbox/declare.html');
  ok(page.status === 200 && (await page.text()).includes('Kifeh'), 'pages statiques servies sous /sandbox');
  // Déclaration DANS la sandbox
  const d = await api('POST', '/sandbox/api/declare/draft', {
    type: 'water', lat: 36.4, lng: 10.6, deviceLat: 36.4001, deviceLng: 10.6001,
    temporalStatus: 'ongoing', startedAt: new Date(Date.now() - 1800e3).toISOString(),
    description: 'Incident fictif sandbox', severity: 'moderate', fillSeconds: 20, idempotencyKey: 'sbx-1',
  });
  const p = await api('POST', '/sandbox/api/declare/publish-unverified', { incidentId: d.data.incidentId, draftToken: d.data.draftToken });
  ok(p.data.ok === true && p.data.status === 'active', 'déclaration publiée dans la sandbox (sans OTP)');
  ok((p.data.manageUrl || '').includes('/sandbox/manage.html'), 'lien de gestion préfixé /sandbox');
  const bbox = 'minLat=36&maxLat=37&minLng=10&maxLng=11';
  const mapS = await api('GET', `/sandbox/api/public/incidents?${bbox}`);
  ok(mapS.data.incidents.some((i) => i.public_id === p.data.publicId), 'incident visible sur la carte SANDBOX');
  const mapP = await api('GET', `/api/public/incidents?${bbox}`);
  ok(!mapP.data.incidents.some((i) => i.public_id === p.data.publicId) && mapP.data.count === 0,
    'CLOISONNEMENT : rien n’apparaît sur la carte de production');
  ok(fs.existsSync('data/sandbox.db'), 'base de données sandbox séparée sur disque');
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
}
console.log(`\n${pass} réussis · ${fail} échoués`);
process.exit(fail ? 1 : 0);
