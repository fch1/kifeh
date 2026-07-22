// Kifeh كيفاه — serveur principal.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './src/config.js';
import { bootstrapAdmin } from './src/db.js';
import { securityHeaders } from './src/middleware/security.js';
import { publicRouter } from './src/routes/public.js';
import { declareRouter } from './src/routes/declare.js';
import { manageRouter } from './src/routes/manage.js';
import { adminRouter } from './src/routes/admin.js';
import { eventsRouter } from './src/routes/events.js';
import { devRouter } from './src/routes/dev.js';
import { startScheduler } from './src/services/scheduler.js';
import { msg } from './src/i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
// Derrière un reverse proxy (Render, nginx…) : req.ip = IP réelle du client.
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(express.json({ limit: '100kb' }));

// Sonde de santé (Render : Settings → Health Check Path = /healthz →
// déploiements sans coupure : l'ancienne instance sert jusqu'à ce que la
// nouvelle soit prête, plus de 502 pendant les mises à jour).
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use('/api/public', publicRouter);
app.use('/api/declare', declareRouter);
app.use('/api/manage', manageRouter);
app.use('/api/admin', adminRouter);
app.use('/api/events', eventsRouter);
if (config.isDev) app.use('/api/dev', devRouter);

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    // Les pages HTML sont revalidées à chaque visite (mises à jour immédiates) ;
    // les ressources rarement modifiées (polices, Leaflet, logo) restent en cache.
    if (filePath.endsWith('.html')) res.set('Cache-Control', 'no-cache');
    else if (filePath.includes('vendor') || filePath.includes('img')) res.set('Cache-Control', 'public, max-age=2592000');
    else res.set('Cache-Control', config.isDev ? 'no-cache' : 'public, max-age=600');
  },
}));

// Gestion d'erreurs : jamais de détail interne exposé.
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: msg(req, 'content_too_large') });
  }
  console.error('[error]', err?.message);
  res.status(500).json({ error: msg(req, 'internal_error') });
});

const creds = bootstrapAdmin();
startScheduler();

const HOST = '0.0.0.0';
const PORT = Number(config.port);

if (!Number.isInteger(PORT) || PORT <= 0) {
  throw new Error(`Port invalide : ${config.port}`);
}

const server = app.listen(PORT, HOST, () => {
  const address = server.address();

  console.log(
    `Kifeh كيفاه — serveur actif sur ${HOST}:${address.port} ` +
    `(${config.isDev ? 'développement' : 'production'})`
  );

  if (creds) {
    console.log('──────────────────────────────────────────────');
    console.log(`Compte administrateur initial : ${creds.username}`);

    // Ne jamais afficher le mot de passe en production.
    if (config.isDev) {
      console.log(`Mot de passe initial : ${creds.password}`);
    }

    console.log('Définissez ADMIN_PASSWORD dans les variables d’environnement.');
    console.log('──────────────────────────────────────────────');
  }

  if (config.isDev) {
    console.log('Mode dev : OTP et e-mails visibles sur /api/dev/outbox');
  }
});

server.on('error', (error) => {
  console.error('[server:error]', error);
  process.exit(1);
});
