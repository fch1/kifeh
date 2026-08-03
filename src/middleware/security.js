// En-têtes de sécurité + validation d'entrées utilitaire.
export function securityHeaders(req, res, next) {
  // HSTS : uniquement quand la requête arrive déjà en HTTPS (production
  // derrière le proxy) — jamais en développement local (http://localhost).
  if (req.secure || req.get('x-forwarded-proto') === 'https') {
    res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; " +
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org " +
      "https://*.cartocdn.com https://*.openstreetmap.fr https://*.google-analytics.com https://*.googletagmanager.com; " +
      "style-src 'self' 'unsafe-inline'; " +
      "script-src 'self' https://www.googletagmanager.com; " +
      // worker-src : MapLibre GL crée son worker de traitement depuis un blob
      // même-origine — sans cette directive, le moteur feux ne DESSINE rien
      // (leçon du 04/08 : zombie silencieux, aucune exception levée).
      "worker-src 'self' blob:; " +
      // connect-src : MapLibre télécharge les tuiles par fetch() (Leaflet
      // passe par <img> / img-src) — mêmes fournisseurs que img-src, rien
      // de plus.
      "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com " +
      "https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.cartocdn.com https://*.openstreetmap.fr; " +
      "frame-ancestors 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(self), camera=(self)',
  });
  next();
}

// Validation stricte des entrées ---------------------------------------------

export function isEmail(v) {
  return typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

// E.164 : indicatif international, OU numéro tunisien à 8 chiffres saisi sans
// +216 (accepté puis normalisé en +216XXXXXXXX avant stockage).
export function isPhone(v) {
  if (typeof v !== 'string') return false;
  const n = normalizePhone(v);
  return /^\+[1-9]\d{6,14}$/.test(n);
}

export function normalizePhone(v) {
  let n = String(v).replace(/[\s.\-()]/g, '');
  if (/^00216\d{8}$/.test(n)) n = `+${n.slice(2)}`;   // 00216… → +216…
  if (/^216\d{8}$/.test(n)) n = `+${n}`;              // 216… → +216…
  if (/^[2-9]\d{7}$/.test(n)) n = `+216${n}`;         // 8 chiffres locaux → +216…
  return n;
}

export function isFiniteNum(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max;
}

export function isIsoDate(v) {
  if (typeof v !== 'string') return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime());
}

// Retire les caractères de contrôle (sauf \n et \t), limite la longueur.
export function cleanText(v, max = 500) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
}

// Filtrage simple de contenus malveillants dans les textes publics :
// on refuse les URL et scripts dans la description publiée.
export function containsSuspiciousContent(text) {
  return /https?:\/\/|www\.|<script|javascript:|onerror=|onload=/i.test(text || '');
}
