// Gestion d'une déclaration par son auteur, via lien signé (jeton 256 bits
// haché en base, révocable, expirant). Aucune session ni compte.
import { Router } from 'express';
import { db, getSettingNum, touchIncident } from '../db.js';
import { sha256, uuid } from '../services/crypto.js';
import { isIsoDate, cleanText, containsSuspiciousContent } from '../middleware/security.js';
import { ipRateLimit, clientIp } from '../middleware/rateLimit.js';
import { schedulePurge } from '../services/scheduler.js';
import { broadcast } from './events.js';
import { audit } from '../services/audit.js';
import { msg } from '../i18n.js';

export const manageRouter = Router();
manageRouter.use(ipRateLimit('manage_ip', 60, 60));

function tokenAuth(req, res) {
  const token = String(req.query.token || req.body?.token || '');
  if (!token) { res.status(401).json({ error: msg(req, 'link_invalid') }); return null; }
  const row = db.prepare(
    `SELECT i.* FROM incidents i JOIN manage_tokens t ON t.incident_id = i.id
     WHERE t.token_hash = ? AND t.revoked = 0 AND t.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).get(sha256(token));
  if (!row || row.status === 'deleted') {
    res.status(403).json({ error: msg(req, 'manage_link_invalid') });
    return null;
  }
  return row;
}

// Vue « ma déclaration » : le déclarant voit SA propre adresse/position exacte.
manageRouter.get('/incident', (req, res) => {
  const i = tokenAuth(req, res);
  if (!i) return;
  res.json({
    publicId: i.public_id, type: i.type, status: i.status, severity: i.severity,
    description: i.description, comment: i.comment, affectedCount: i.affected_count,
    temporalStatus: i.temporal_status, startedAt: i.started_at, endedAt: i.ended_at,
    timeApproximate: Boolean(i.time_approximate),
    address: i.address, area: i.public_area, lat: i.lat, lng: i.lng,
    expiresAt: i.expires_at, confirmations: i.confirmations_count,
    createdAt: i.created_at, updatedAt: i.updated_at,
  });
});

// « L'incident est toujours en cours » → prolonge l'expiration.
manageRouter.post('/still-ongoing', (req, res) => {
  const i = tokenAuth(req, res);
  if (!i) return;
  if (i.status !== 'active' || i.temporal_status !== 'ongoing') {
    return res.status(400).json({ error: msg(req, 'not_ongoing') });
  }
  const ttlH = getSettingNum('active_incident_ttl_h');
  const newExpiry = new Date(Date.now() + ttlH * 3600_000).toISOString();
  db.prepare(`UPDATE incidents SET expires_at = ?, reminder_sent_at = NULL WHERE id = ?`).run(newExpiry, i.id);
  touchIncident(i.id);
  broadcast('incident', { publicId: i.public_id, status: 'active' });
  res.json({ ok: true, expiresAt: newExpiry });
});

// Clôturer : heure de fin (contrôle fin ≥ début) → statut resolved.
manageRouter.post('/close', (req, res) => {
  const i = tokenAuth(req, res);
  if (!i) return;
  if (!['active', 'pending_review', 'verified'].includes(i.status)) {
    return res.status(400).json({ error: msg(req, 'cannot_close') });
  }
  const endedAt = req.body?.endedAt && isIsoDate(req.body.endedAt)
    ? new Date(req.body.endedAt).toISOString() : new Date().toISOString();
  if (Date.parse(endedAt) < Date.parse(i.started_at)) {
    return res.status(400).json({ error: msg(req, 'end_before_start') });
  }
  db.prepare(`UPDATE incidents SET status = 'resolved', temporal_status = 'finished', ended_at = ?,
              time_approximate = CASE WHEN ? THEN 1 ELSE time_approximate END WHERE id = ?`)
    .run(endedAt, req.body?.timeApproximate ? 1 : 0, i.id);
  touchIncident(i.id);
  schedulePurge(i.reporter_id);
  audit('reporter', 'incident_closed', i.id, null, clientIp(req));
  broadcast('incident', { publicId: i.public_id, status: 'resolved' });
  res.json({ ok: true, status: 'resolved', endedAt });
});

// Mettre à jour la description.
manageRouter.post('/update', (req, res) => {
  const i = tokenAuth(req, res);
  if (!i) return;
  const description = cleanText(req.body?.description, 500);
  if (!description) return res.status(400).json({ error: msg(req, 'desc_empty') });
  if (containsSuspiciousContent(description)) return res.status(400).json({ error: msg(req, 'desc_no_links') });
  db.prepare(`UPDATE incidents SET description = ?, hidden_description = 0 WHERE id = ?`).run(description, i.id);
  touchIncident(i.id);
  broadcast('incident', { publicId: i.public_id });
  res.json({ ok: true });
});

// Signaler une erreur de localisation (transmis aux opérateurs).
manageRouter.post('/location-issue', (req, res) => {
  const i = tokenAuth(req, res);
  if (!i) return;
  db.prepare(`INSERT INTO reports(id, incident_id, reason, detail) VALUES (?, ?, 'wrong_location', ?)`)
    .run(uuid(), i.id, cleanText(req.body?.detail, 500) || 'Erreur de localisation signalée par le déclarant');
  audit('reporter', 'location_issue', i.id);
  res.json({ ok: true, message: msg(req, 'location_thanks') });
});

// Suppression par le déclarant (droit à l'effacement).
manageRouter.post('/delete', (req, res) => {
  const i = tokenAuth(req, res);
  if (!i) return;
  db.prepare(`UPDATE incidents SET status = 'deleted', description = '', comment = NULL, address = NULL WHERE id = ?`).run(i.id);
  db.prepare(`UPDATE manage_tokens SET revoked = 1 WHERE incident_id = ?`).run(i.id);
  touchIncident(i.id);
  schedulePurge(i.reporter_id);
  audit('reporter', 'incident_deleted', i.id, null, clientIp(req));
  broadcast('incident', { publicId: i.public_id, status: 'deleted' });
  res.json({ ok: true });
});
