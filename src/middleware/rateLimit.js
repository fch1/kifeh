// Rate limiting persistant (table rate_events) par IP, contact haché ou session.
// Réponses volontairement génériques pour ne pas révéler les mécanismes anti-abus.
import { db } from '../db.js';
import { hmac } from '../services/crypto.js';
import { msg } from '../i18n.js';

export function clientIp(req) {
  // Derrière un reverse proxy de confiance, configurer app.set('trust proxy', 1)
  return req.ip || req.socket?.remoteAddress || '0.0.0.0';
}

export function recordEvent(bucket, key) {
  db.prepare('INSERT INTO rate_events(bucket, key_hash) VALUES (?, ?)').run(bucket, hmac(key));
}

export function countEvents(bucket, key, windowMinutes) {
  return db.prepare(
    `SELECT COUNT(*) AS n FROM rate_events
     WHERE bucket = ? AND key_hash = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`
  ).get(bucket, hmac(key), `-${windowMinutes} minutes`).n;
}

// Middleware générique : max `limit` évènements par `windowMinutes` pour ce bucket/IP.
export function ipRateLimit(bucket, limit, windowMinutes) {
  return (req, res, next) => {
    const ip = clientIp(req);
    if (countEvents(bucket, ip, windowMinutes) >= limit) {
      return res.status(429).json({ error: msg(req, 'too_many_requests') });
    }
    recordEvent(bucket, ip);
    next();
  };
}

// Purge périodique des évènements anciens (appelée par le scheduler).
export function pruneRateEvents() {
  db.prepare(`DELETE FROM rate_events WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days')`).run();
}
