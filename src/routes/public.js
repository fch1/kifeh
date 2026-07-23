// API publiques : carte, recherche, détail, confirmation « je suis aussi
// concerné », signalement de contenu, géocodage. AUCUNE donnée sensible ne
// sort d'ici : les requêtes SQL ne sélectionnent jamais lat/lng exacts,
// adresse exacte ni contact.
import { Router } from 'express';
import { db, getSettingNum } from '../db.js';
import { uuid, hmac, encrypt } from '../services/crypto.js';
import { isEmail, isPhone, normalizePhone, isFiniteNum, cleanText } from '../middleware/security.js';
import { clientIp, countEvents, recordEvent, ipRateLimit } from '../middleware/rateLimit.js';
import { searchAddress, reverseGeocode } from '../services/geocode.js';
import { createVerification, verifyCode } from '../services/otp.js';
import { broadcast } from './events.js';
import { audit } from '../services/audit.js';
import { getLang, msg } from '../i18n.js';
import { config } from '../config.js';

export const publicRouter = Router();

// Colonnes publiques UNIQUEMENT.
const PUBLIC_COLS = `public_id, type, status, severity,
  CASE WHEN hidden_description = 1 THEN '' ELSE description END AS description,
  temporal_status, started_at, ended_at, time_approximate,
  public_lat AS lat, public_lng AS lng, public_area AS area,
  confirmations_count, created_at, updated_at`;

const nowIso = () => new Date().toISOString();

// --- Incidents visibles dans une zone de carte -----------------------------
publicRouter.get('/incidents', (req, res) => {
  const q = req.query;
  const conds = [];
  const params = {};

  // Statuts visibles publiquement : actifs + résolus récents.
  const resolvedH = getSettingNum('resolved_visible_h');
  if (q.status === 'active') conds.push(`status = 'active'`);
  else if (q.status === 'resolved') {
    conds.push(`status = 'resolved' AND updated_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-${resolvedH} hours')`);
  } else {
    conds.push(`(status = 'active' OR (status = 'resolved' AND updated_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-${resolvedH} hours')))`);
  }

  if (q.type && ['electricity', 'water', 'fire', 'internet', 'other'].includes(q.type)) {
    conds.push('type = @type'); params.type = q.type;
  }
  if (q.types) {
    const list = String(q.types).split(',').filter((t) => ['electricity', 'water', 'fire', 'internet', 'other'].includes(t));
    if (list.length) conds.push(`type IN (${list.map((t) => `'${t}'`).join(',')})`);
  }
  if (q.since && !Number.isNaN(Date.parse(q.since))) {
    conds.push('started_at >= @since'); params.since = new Date(q.since).toISOString();
  }
  if (q.until && !Number.isNaN(Date.parse(q.until))) {
    conds.push('started_at <= @until'); params.until = new Date(q.until).toISOString();
  }
  // Bornes de la zone de carte (bounding box).
  if (['minLat', 'maxLat', 'minLng', 'maxLng'].every((k) => isFiniteNum(q[k], -180, 180))) {
    conds.push('public_lat BETWEEN @minLat AND @maxLat AND public_lng BETWEEN @minLng AND @maxLng');
    params.minLat = Number(q.minLat); params.maxLat = Number(q.maxLat);
    params.minLng = Number(q.minLng); params.maxLng = Number(q.maxLng);
  }

  const rows = db.prepare(
    `SELECT ${PUBLIC_COLS} FROM incidents WHERE ${conds.join(' AND ')}
     ORDER BY started_at DESC LIMIT 500`
  ).all(params);

  res.json({ count: rows.length, incidents: rows });
});

// --- Détail public ---------------------------------------------------------
publicRouter.get('/incidents/:publicId', (req, res) => {
  const row = db.prepare(
    `SELECT ${PUBLIC_COLS} FROM incidents WHERE public_id = ?
     AND status IN ('active','resolved','expired')`
  ).get(String(req.params.publicId));
  if (!row) return res.status(404).json({ error: msg(req, 'incident_not_found') });

  const attachments = db.prepare(
    `SELECT id FROM attachments WHERE incident_id = (SELECT id FROM incidents WHERE public_id = ?)
     AND public = 1 AND moderation_status = 'approved' AND clean_path IS NOT NULL`
  ).all(String(req.params.publicId)).map((a) => `/api/public/attachments/${a.id}`);

  res.json({ ...row, attachments });
});

// Médias publics : uniquement les versions nettoyées ET approuvées.
publicRouter.get('/attachments/:id', (req, res) => {
  const att = db.prepare(
    `SELECT clean_path FROM attachments WHERE id = ? AND public = 1 AND moderation_status = 'approved' AND clean_path IS NOT NULL`
  ).get(String(req.params.id));
  if (!att) return res.status(404).end();
  res.sendFile(att.clean_path, { root: process.cwd() });
});

// --- « Je suis aussi concerné » (avec vérification de contact) --------------
publicRouter.post('/confirm/start', ipRateLimit('confirm_ip', 10, 60), async (req, res) => {
  const b = req.body || {};
  const incident = db.prepare(`SELECT id, public_id FROM incidents WHERE public_id = ? AND status = 'active'`)
    .get(String(b.publicId || ''));
  if (!incident) return res.status(404).json({ error: msg(req, 'incident_closed_or_missing') });
  if (b.consent !== true) return res.status(400).json({ error: msg(req, 'consent_required') });

  let channel, contact;
  if (b.method === 'sms') {
    if (!isPhone(b.phone || '')) return res.status(400).json({ error: msg(req, 'invalid_phone') });
    channel = 'sms'; contact = normalizePhone(b.phone);
  } else {
    if (!isEmail(b.email || '')) return res.status(400).json({ error: msg(req, 'invalid_email') });
    channel = 'email_code'; contact = String(b.email).toLowerCase().trim();
  }
  const contactHash = hmac(contact);

  const already = db.prepare(`SELECT 1 FROM confirmations WHERE incident_id = ? AND contact_hash = ?`)
    .get(incident.id, contactHash);
  if (already) return res.status(400).json({ error: msg(req, 'already_confirmed') });

  let reporter = db.prepare(`SELECT * FROM reporters WHERE contact_hash = ? ORDER BY created_at DESC LIMIT 1`).get(contactHash);
  if (reporter?.blocked_until && Date.parse(reporter.blocked_until) > Date.now()) {
    return res.status(429).json({ error: msg(req, 'contact_suspended') });
  }
  const lang = getLang(req);
  if (!reporter) {
    const rid = uuid();
    db.prepare(`INSERT INTO reporters(id, channel, contact_encrypted, contact_hash, consent_given_at, lang)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(rid, channel === 'sms' ? 'sms' : 'email', encrypt(contact), contactHash, nowIso(), lang);
    reporter = db.prepare(`SELECT * FROM reporters WHERE id = ?`).get(rid);
  }

  try {
    const v = await createVerification(reporter, incident, channel, contact, lang);
    res.json({ verificationId: v.verificationId });
  } catch {
    res.status(502).json({ error: msg(req, 'send_failed') });
  }
});

publicRouter.post('/confirm/verify', (req, res) => {
  const b = req.body || {};
  const result = verifyCode(String(b.verificationId || ''), String(b.code || ''), getLang(req));
  if (result.error) return res.status(400).json(result);

  const incident = db.prepare(`SELECT id, public_id, confirmations_count FROM incidents WHERE id = ?`).get(result.incidentId);
  if (!incident) return res.status(404).json({ error: msg(req, 'incident_not_found') });
  const reporter = db.prepare(`SELECT contact_hash FROM reporters WHERE id = ?`).get(result.reporterId);

  try {
    db.prepare(`INSERT INTO confirmations(id, incident_id, contact_hash, approx_lat, approx_lng)
                VALUES (?, ?, ?, ?, ?)`)
      .run(uuid(), incident.id, reporter.contact_hash,
        isFiniteNum(req.body.approxLat, -90, 90) ? Math.round(Number(req.body.approxLat) * 100) / 100 : null,
        isFiniteNum(req.body.approxLng, -180, 180) ? Math.round(Number(req.body.approxLng) * 100) / 100 : null);
  } catch {
    return res.status(400).json({ error: msg(req, 'already_confirmed') });
  }
  db.prepare(`UPDATE incidents SET confirmations_count = confirmations_count + 1,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(incident.id);
  broadcast('incident', { publicId: incident.public_id, confirmations: incident.confirmations_count + 1 });
  res.json({ ok: true, confirmations: incident.confirmations_count + 1 });
});

// Confirmation directe (uniquement quand la vérification OTP est désactivée) :
// une confirmation par IP et par incident, sans collecte de contact.
publicRouter.post('/confirm/direct', ipRateLimit('confirm_ip', 10, 60), (req, res) => {
  if (getSettingNum('verification_required') !== 0) {
    return res.status(403).json({ error: msg(req, 'invalid_params') });
  }
  const incident = db.prepare(`SELECT id, public_id, confirmations_count FROM incidents WHERE public_id = ? AND status = 'active'`)
    .get(String(req.body?.publicId || ''));
  if (!incident) return res.status(404).json({ error: msg(req, 'incident_closed_or_missing') });
  try {
    db.prepare(`INSERT INTO confirmations(id, incident_id, contact_hash) VALUES (?, ?, ?)`)
      .run(uuid(), incident.id, hmac(`ipconfirm:${incident.id}:${clientIp(req)}`));
  } catch {
    return res.status(400).json({ error: msg(req, 'already_confirmed') });
  }
  db.prepare(`UPDATE incidents SET confirmations_count = confirmations_count + 1,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(incident.id);
  broadcast('incident', { publicId: incident.public_id, confirmations: incident.confirmations_count + 1 });
  res.json({ ok: true, confirmations: incident.confirmations_count + 1 });
});

// --- Signalement d'un contenu incorrect ------------------------------------
publicRouter.post('/report', ipRateLimit('report_ip', 5, 60), (req, res) => {
  const b = req.body || {};
  const incident = db.prepare(`SELECT id FROM incidents WHERE public_id = ?`).get(String(b.publicId || ''));
  if (!incident) return res.status(404).json({ error: msg(req, 'incident_not_found') });
  const reason = ['wrong_location', 'not_real', 'inappropriate', 'resolved', 'other'].includes(b.reason) ? b.reason : 'other';
  db.prepare(`INSERT INTO reports(id, incident_id, reason, detail) VALUES (?, ?, ?, ?)`)
    .run(uuid(), incident.id, reason, cleanText(b.detail, 500) || null);
  audit('public', 'content_reported', incident.id, { reason }, clientIp(req));
  res.json({ ok: true, message: msg(req, 'report_thanks') });
});

// --- Géocodage (proxy côté serveur : cache + pas d'exposition des IP) -------
publicRouter.get('/geocode/search', ipRateLimit('search_ip', 30, 5), async (req, res) => {
  const q = cleanText(String(req.query.q || ''), 200);
  if (q.length < 3) return res.json({ results: [] });
  res.json({ results: await searchAddress(q, 5, getLang(req)) });
});

publicRouter.get('/geocode/reverse', ipRateLimit('search_ip', 30, 5), async (req, res) => {
  const { lat, lng } = req.query;
  if (!isFiniteNum(lat, -90, 90) || !isFiniteNum(lng, -180, 180)) {
    return res.status(400).json({ error: msg(req, 'invalid_params') });
  }
  res.json({ result: await reverseGeocode(Number(lat), Number(lng), getLang(req)) });
});

// --- Configuration publique (catégories actives…) ---------------------------
publicRouter.get('/config', (req, res) => {
  res.json({
    otherCategoryEnabled: getSettingNum('other_category_enabled') === 1,
    verificationRequired: getSettingNum('verification_required') !== 0,
    sandbox: config.isSandbox,
    gaId: config.isSandbox ? '' : config.gaId, // pas de mesure d'audience dans la sandbox
  });
});

// --- Statistiques publiques minimales (compteur d'accueil) ------------------
publicRouter.get('/stats', (req, res) => {
  const active = db.prepare(`SELECT COUNT(*) AS n FROM incidents WHERE status = 'active'`).get().n;
  const byType = db.prepare(`SELECT type, COUNT(*) AS n FROM incidents WHERE status = 'active' GROUP BY type`).all();
  res.json({ active, byType: Object.fromEntries(byType.map((r) => [r.type, r.n])) });
});
