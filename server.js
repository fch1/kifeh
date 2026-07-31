// Kifeh كيفاه — serveur principal.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config, captureBaseUrl } from './src/config.js';
import { db, bootstrapAdmin } from './src/db.js';
import { securityHeaders } from './src/middleware/security.js';
import { publicRouter } from './src/routes/public.js';
import { fireSituationRouter } from './src/routes/fireSituation.js';
import { fireRouter } from './src/routes/fire.js';
import { safetyRouter } from './src/routes/safety.js';
import { declareRouter } from './src/routes/declare.js';
import { manageRouter } from './src/routes/manage.js';
import { adminRouter } from './src/routes/admin.js';
import { eventsRouter } from './src/routes/events.js';
import { devRouter } from './src/routes/dev.js';
import { startScheduler } from './src/services/scheduler.js';
import { effisStatus } from './src/services/effis.js';
import { roadsStatus } from './src/services/roads.js';
import { dfciEnabled, dfciReferenceLoaded, dfciReferenceVersion } from './src/services/dfci.js';
import { classifyFreshness } from './src/services/sourceFreshness.js';
import { msg } from './src/i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
// Derrière un reverse proxy (Render, nginx…) : req.ip = IP réelle du client.
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use((req, res, next) => { captureBaseUrl(req); next(); });

// Domaine canonique : kifeh.app PAR DÉFAUT en production (les alias comme
// www.kifeh.org redirigent en 301 — un seul domaine indexé par les moteurs,
// préférences partagées). Surchargeable : CANONICAL_HOST=<domaine>, ou
// CANONICAL_HOST=off pour désactiver. La sonde /healthz et l'URL interne
// onrender.com ne sont jamais redirigées (contrôles de santé Render).
app.use((req, res, next) => {
  const configured = (process.env.CANONICAL_HOST || '').trim().toLowerCase();
  const canonical = configured === 'off' ? '' : (configured || (config.isDev ? '' : 'kifeh.app'));
  if (!canonical || req.path === '/healthz' || config.isSandbox) return next();
  const host = String(req.get('host') || '').toLowerCase();
  if (host && host !== canonical && !host.startsWith('localhost') && !host.startsWith('127.')
      && !host.endsWith('.onrender.com')) {
    return res.redirect(301, `https://${canonical}${req.originalUrl}`);
  }
  next();
});

// Sonde de santé (Render : Settings → Health Check Path = /healthz →
// déploiements sans coupure : l'ancienne instance sert jusqu'à ce que la
// nouvelle soit prête, plus de 502 pendant les mises à jour).
app.get('/healthz', (req, res) => {
  // Preuve vérifiable de l'état des sauvegardes (horodatage de la dernière
  // copie « minute ») et du volume de données — sans exposer aucun contenu.
  let backupAt = null, incidents = null, firms = null;
  try {
    backupAt = db.prepare(`SELECT value FROM settings WHERE key = 'last_minute_backup_at'`).get()?.value || null;
    incidents = db.prepare(`SELECT COUNT(*) AS n FROM incidents WHERE status != 'deleted'`).get().n;
    // État NASA FIRMS : clé présente ? synchro tentée/réussie ? (jamais la clé
    // elle-même ni le détail des erreurs — de simples indicateurs).
    const g = (k) => db.prepare(`SELECT value FROM settings WHERE key = ?`).get(k)?.value || null;
    const lastSuccess = g('firms_last_success_at');
    firms = {
      keyConfigured: Boolean(config.firms.mapKey),
      lastSync: g('firms_last_sync_at'),
      lastSuccess,
      // hasError = vraie panne (aucune synchro réussie depuis 45 min), pas un
      // simple raté passager sur une source pendant un cycle.
      hasError: Boolean(g('firms_last_error'))
        && (!lastSuccess || Date.now() - Date.parse(lastSuccess) > 45 * 60_000),
      detections: db.prepare(`SELECT COUNT(*) AS n FROM satellite_detections`).get().n,
    };
  } catch { /* la sonde reste valide même sans ces informations */ }
  // Sauvegarde hors-site : configurée ? dernière copie ? (aucun secret exposé).
  let offsite = null;
  try {
    const g = (k) => db.prepare(`SELECT value FROM settings WHERE key = ?`).get(k)?.value || null;
    offsite = {
      configured: Boolean(process.env.GITHUB_BACKUP_TOKEN),
      lastBackupAt: g('offsite_backup_at'),
      hasError: Boolean(g('offsite_backup_error')),
    };
  } catch { /* idem */ }
  // Vigilance Météo-France : configurée ? dernier import ? (aucun secret).
  let vigilance = null;
  try {
    const g = (k) => db.prepare(`SELECT value FROM settings WHERE key = ?`).get(k)?.value || null;
    vigilance = {
      configured: Boolean(process.env.METEOFRANCE_API_KEY),
      lastSuccess: g('vigilance_last_success_at'),
      hasError: Boolean(g('vigilance_last_error')),
    };
  } catch { /* idem */ }
  // Alertes e-mail : configurées ? combien d'abonnés confirmés ? (aucune adresse exposée)
  let emailAlerts = null;
  try {
    emailAlerts = {
      configured: Boolean(process.env.RESEND_API_KEY),
      confirmed: db.prepare(`SELECT COUNT(*) AS n FROM email_alert_subscriptions WHERE confirmed_at IS NOT NULL`).get().n,
    };
  } catch { /* idem */ }
  // Copernicus EFFIS : dernière synchro des zones brûlées ? (indicateurs seuls)
  let effis = null;
  try { effis = effisStatus(); } catch { /* idem */ }
  // Bison Futé : routes barrées & entraves (indicateurs seuls).
  let roads = null;
  try { roads = roadsStatus(); } catch { /* idem */ }
  // Repère DFCI : activé ? référence chargée ? version ? (jamais le chemin
  // local). hasError = activé SANS référentiel (postinstall silencieusement
  // raté) — condition d'alerte de la surveillance.
  let dfci = null;
  try {
    dfci = {
      enabled: dfciEnabled(),
      referenceLoaded: dfciReferenceLoaded(),
      version: dfciReferenceVersion(),
      hasError: dfciEnabled() && !dfciReferenceLoaded(),
    };
  } catch { /* idem */ }
  // Fraîcheur LISIBLE de chaque source : ageSeconds (audit) + statut TYPÉ
  // fresh/delayed/stale/unavailable (seuils centralisés — sourceFreshness).
  const withAge = (s, sourceKey) => {
    if (!s || typeof s !== 'object') return s;
    const ageSeconds = s.lastSuccess
      ? Math.max(0, Math.round((Date.now() - Date.parse(s.lastSuccess)) / 1000)) : null;
    const status = sourceKey ? classifyFreshness(sourceKey, ageSeconds) : undefined;
    return status ? { ...s, ageSeconds, status } : { ...s, ageSeconds };
  };
  res.json({
    ok: true, backupAt, incidents,
    firms: withAge(firms, 'thermalDetections'), offsite,
    vigilance: withAge(vigilance, 'officialAlerts'),
    emailAlerts, effis: withAge(effis, 'burnedAreas'),
    roads: withAge(roads, 'roadEvents'), dfci,
  });
});

// ── Sandbox (/sandbox) — environnement de test totalement cloisonné ─────────
// Activé par SANDBOX_ENABLED=1 : un second processus identique tourne en
// interne avec SA PROPRE base de données et SES PROPRES fichiers ; ce proxy
// lui transmet tout ce qui commence par /sandbox. Rien n'est partagé avec la
// production. Monté AVANT express.json pour transmettre les corps tels quels.
if (config.sandboxEnabled && !config.isSandbox) {
  const sandboxDb = path.join(path.dirname(config.dbPath), 'sandbox.db');
  const sandboxUploads = `${config.uploadsDir.replace(/\/$/, '')}-sandbox`;
  let sandboxChild = null;
  let shuttingDown = false;
  const startSandbox = () => {
    const child = sandboxChild = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      env: {
        ...process.env,
        SANDBOX: '1', SANDBOX_ENABLED: '',
        PORT: String(config.sandboxPort),
        DB_PATH: sandboxDb,
        UPLOADS_DIR: sandboxUploads,
        BASE_URL: process.env.BASE_URL ? `${process.env.BASE_URL}/sandbox` : '',
      },
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (shuttingDown) return;
      console.error(`[sandbox] processus arrêté (code ${code}), relance dans 3 s`);
      setTimeout(startSandbox, 3000);
    });
  };
  startSandbox();
  const stopAll = () => { shuttingDown = true; try { sandboxChild?.kill(); } catch {} process.exit(0); };
  process.on('SIGTERM', stopAll);
  process.on('SIGINT', stopAll);

  app.use('/sandbox', (req, res) => {
    const targetPath = req.originalUrl.replace(/^\/sandbox/, '') || '/';
    const proxyReq = http.request({
      host: '127.0.0.1', port: config.sandboxPort, path: targetPath,
      method: req.method,
      headers: { ...req.headers }, // Host d'origine conservé : la sandbox déduit sa vraie URL publique
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, { ...proxyRes.headers, 'X-Robots-Tag': 'noindex' });
      proxyRes.pipe(res);
    });
    proxyReq.on('error', () => {
      if (!res.headersSent) res.status(503).json({ error: 'Sandbox en cours de démarrage — réessayez dans quelques secondes.' });
    });
    req.pipe(proxyReq);
  });
} else if (!config.isSandbox) {
  app.use('/sandbox', (req, res) => res.status(404).json({ error: 'Sandbox non activée (définir SANDBOX_ENABLED=1).' }));
}

app.use(express.json({ limit: '100kb' }));

app.use('/api/public', publicRouter);
app.use('/api/fire-situation', fireSituationRouter); // « Situation incendie » (France)
app.use('/api/fire', fireRouter); // « Feux FR » Lot 1 : instantané + timeline (replay honnête)
app.use('/api/safety', safetyRouter); // « Mon statut de sécurité » (personnel, privé)
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
    `Kifeh كيفاه${config.isSandbox ? ' [SANDBOX]' : ''} — serveur actif sur ${HOST}:${address.port} ` +
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
