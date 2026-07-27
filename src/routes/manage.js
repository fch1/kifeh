// Gestion d'une déclaration par son auteur, via lien signé (jeton 256 bits
// haché en base, révocable, expirant). Aucune session ni compte.
import { Router } from 'express';
import { db, getSetting, getSettingNum, touchIncident } from '../db.js';
import { sha256, uuid } from '../services/crypto.js';
import { isIsoDate, isFiniteNum, cleanText, containsSuspiciousContent } from '../middleware/security.js';
import { anonymizeCoords } from '../services/anonymize.js';
import { ipRateLimit, clientIp } from '../middleware/rateLimit.js';
import { schedulePurge } from '../services/scheduler.js';
import { broadcast } from './events.js';
import { audit } from '../services/audit.js';
import { msg } from '../i18n.js';
import { resolveCountry } from '../countries/index.js';

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
    countryCode: i.country_code || 'TN', // pays de l'incident (géocodage, fuseau)
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
  if (Date.parse(endedAt) > Date.now() + 60_000) {
    return res.status(400).json({ error: msg(req, 'end_in_future') });
  }
  db.prepare(`UPDATE incidents SET status = 'resolved', temporal_status = 'finished', ended_at = ?,
              resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), resolution_source = 'creator',
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

// Corriger la localisation (déclarant vérifié via son lien de gestion) :
// appliquée DIRECTEMENT sur l'incident existant — jamais de nouvel incident.
// L'ancienne position est conservée dans l'historique (location_corrections),
// et la position publique reste anonymisée.
manageRouter.post('/update-location', (req, res) => {
  const i = tokenAuth(req, res);
  if (!i) return;
  const b = req.body || {};
  if (!isFiniteNum(b.lat, -90, 90) || !isFiniteNum(b.lng, -180, 180)) {
    return res.status(400).json({ error: msg(req, 'invalid_location') });
  }
  const lat = Number(b.lat), lng = Number(b.lng);
  // La correction reste dans le MÊME pays que l'incident : un point situé dans
  // le polygone d'un autre pays pris en charge est refusé (jamais de bascule
  // silencieuse de pays via une « correction » de position).
  if (getSetting('multi_country_enabled') === '1') {
    const resolved = resolveCountry(lat, lng);
    if (resolved && resolved !== (i.country_code || 'TN')) {
      return res.status(400).json({ error: msg(req, 'country_mismatch'), code: 'country_mismatch' });
    }
  }
  const pub = anonymizeCoords(lat, lng, i.id, getSettingNum('anonymize_radius_m'));
  const address = cleanText(b.address, 300) || null;
  const publicArea = cleanText(b.publicArea, 200) || null;

  db.transaction(() => {
    db.prepare(`INSERT INTO location_corrections
        (id, incident_id, prev_lat, prev_lng, new_lat, new_lng, prev_address, new_address,
         submitted_by, status, reviewed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reporter', 'applied', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
      .run(uuid(), i.id, i.lat, i.lng, lat, lng, i.address, address);
    db.prepare(`UPDATE incidents SET lat = ?, lng = ?, public_lat = ?, public_lng = ?,
                address = ?, public_area = COALESCE(?, public_area) WHERE id = ?`)
      .run(lat, lng, pub.lat, pub.lng, address, publicArea, i.id);
  })();
  touchIncident(i.id);
  audit('reporter', 'location_corrected', i.id);
  broadcast('incident', { publicId: i.public_id });
  res.json({ ok: true, message: msg(req, 'correction_applied'), lat, lng, area: publicArea || i.public_area });
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
