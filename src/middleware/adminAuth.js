// Sessions admin : cookie signé HttpOnly + CSRF (en-tête X-CSRF) + rôles.
import { db } from '../db.js';
import { uuid, randomToken, sign, unsign } from '../services/crypto.js';

const SESSION_TTL_H = 8;

export function createSession(adminId) {
  const id = uuid();
  const csrf = randomToken(16);
  db.prepare(`INSERT INTO admin_sessions(id, admin_id, csrf, expires_at)
              VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now','+${SESSION_TTL_H} hours'))`)
    .run(id, adminId, csrf);
  return { cookie: sign(id), csrf };
}

export function destroySession(sessionId) {
  db.prepare('DELETE FROM admin_sessions WHERE id = ?').run(sessionId);
}

function readSession(req) {
  const raw = (req.headers.cookie || '').split(';').map((s) => s.trim())
    .find((s) => s.startsWith('admin_session='));
  if (!raw) return null;
  const id = unsign(decodeURIComponent(raw.split('=').slice(1).join('=')));
  if (!id) return null;
  const row = db.prepare(
    `SELECT s.id AS session_id, s.csrf, a.id AS admin_id, a.username, a.role
     FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
     WHERE s.id = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).get(id);
  return row || null;
}

// Capacités par rôle.
const CAPS = {
  admin:     ['review', 'exact_location', 'merge', 'moderate', 'suspend', 'config', 'export', 'stats', 'audit', 'attachments'],
  moderator: ['review', 'exact_location', 'merge', 'moderate', 'suspend', 'stats', 'audit', 'attachments'],
  operator:  ['review', 'exact_location', 'stats', 'attachments'],
  analyst:   ['stats'],
};

export function can(role, cap) { return (CAPS[role] || []).includes(cap); }

export function requireAdmin(cap = null) {
  return (req, res, next) => {
    const session = readSession(req);
    if (!session) return res.status(401).json({ error: 'Authentification requise.' });
    // CSRF sur toutes les mutations.
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-csrf'] !== session.csrf) {
      return res.status(403).json({ error: 'Jeton CSRF invalide.' });
    }
    if (cap && !can(session.role, cap)) {
      return res.status(403).json({ error: 'Votre rôle ne permet pas cette action.' });
    }
    req.admin = session;
    next();
  };
}
