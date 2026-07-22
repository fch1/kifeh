// Journalisation des actions sensibles. Jamais de donnée personnelle en clair.
import { db } from '../db.js';
import { hmac } from './crypto.js';

export function audit(actor, action, target = null, detail = null, ip = null) {
  db.prepare('INSERT INTO audit_log(actor, action, target, detail, ip_hash) VALUES (?, ?, ?, ?, ?)')
    .run(actor, action, target, detail ? JSON.stringify(detail) : null, ip ? hmac(ip) : null);
}
