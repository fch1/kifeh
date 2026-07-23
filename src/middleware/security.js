// En-têtes de sécurité + validation d'entrées utilitaire.
export function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; " +
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.google-analytics.com https://*.googletagmanager.com; " +
      "style-src 'self' 'unsafe-inline'; " +
      "script-src 'self' https://www.googletagmanager.com; " +
      "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com; " +
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

// E.164 : indicatif international obligatoire.
export function isPhone(v) {
  return typeof v === 'string' && /^\+[1-9]\d{6,14}$/.test(v.replace(/[\s.-]/g, ''));
}

export function normalizePhone(v) { return String(v).replace(/[\s.-]/g, ''); }

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
