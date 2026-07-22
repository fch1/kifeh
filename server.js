// Incidents Locaux — serveur principal.
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
// Derrière un reverse proxy : décommenter pour que req.ip soit l'IP réelle.
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(express.json({ limit: '100kb' }));

app.use('/api/public', publicRouter);
app.use('/api/declare', declareRouter);
app.use('/api/manage', manageRouter);
app.use('/api/admin', adminRouter);
app.use('/api/events', eventsRouter);
if (config.isDev) app.use('/api/dev', devRouter);

app.use(express.static(path.join(__dirname, 'public'), { maxAge: config.isDev ? 0 : '1h' }));

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

app.listen(config.port, () => {
  console.log(`Kifeh كيفاه — http://localhost:${config.port} (${config.isDev ? 'développement' : 'production'})`);
  if (creds) {
    console.log('──────────────────────────────────────────────');
    console.log(`Compte administrateur initial : ${creds.username} / ${creds.password}`);
    console.log('Changez ce mot de passe (ou définissez ADMIN_PASSWORD).');
    console.log('──────────────────────────────────────────────');
  }
  if (config.isDev) console.log('Mode dev : OTP et e-mails visibles sur /api/dev/outbox');
});
