// API publiques : carte, recherche, détail, confirmation « je suis aussi
// concerné », signalement de contenu, géocodage. AUCUNE donnée sensible ne
// sort d'ici : les requêtes SQL ne sélectionnent jamais lat/lng exacts,
// adresse exacte ni contact.
import { Router } from 'express';
import { db, getSetting, getSettingNum } from '../db.js';
import { publicConfidenceList } from '../services/firms.js';
import { uuid, hmac, encrypt } from '../services/crypto.js';
import { isEmail, isPhone, normalizePhone, isFiniteNum, isIsoDate, cleanText } from '../middleware/security.js';
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
  confirmations_count, COALESCE(published_at, created_at) AS published_at,
  created_at, updated_at,
  (SELECT MAX(se.last_detected_at) FROM satellite_events se
   WHERE se.linked_incident_id = incidents.id AND se.status != 'false_positive') AS satellite_last_seen`;

const nowIso = () => new Date().toISOString();

// Distance approximative en km entre deux points (haversine).
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Identifiant pseudonymisé du contributeur : identifiant d'appareil fourni par
// le client (durable) sinon repli sur l'adresse IP — jamais stocké en clair.
function contributorHash(req, incidentId, prefix) {
  const deviceId = String(req.body?.deviceId || '').slice(0, 64);
  return /^[A-Za-z0-9_-]{16,64}$/.test(deviceId)
    ? hmac(`${prefix}:${incidentId}:device:${deviceId}`)
    : hmac(`${prefix}:${incidentId}:ip:${clientIp(req)}`);
}

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
  // Filtre « période » : basé sur la date de PUBLICATION du signalement.
  if (q.publishedSince && !Number.isNaN(Date.parse(q.publishedSince))) {
    conds.push('COALESCE(published_at, created_at) >= @pubSince');
    params.pubSince = new Date(q.publishedSince).toISOString();
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

  // Signal communautaire : signalements de fin en attente + seuil incendie.
  const resolutionReports = db.prepare(
    `SELECT COUNT(*) AS n FROM resolution_reports
     WHERE incident_id = (SELECT id FROM incidents WHERE public_id = ?) AND status = 'pending'`
  ).get(String(req.params.publicId)).n;
  const fireThreshold = getSettingNum('fire_confirm_threshold');

  res.json({
    ...row, attachments,
    resolutionReports,
    resolutionThreshold: getSettingNum('resolution_threshold'),
    fireThreshold,
    communityConfirmed: row.type === 'fire' ? row.confirmations_count >= fireThreshold : row.confirmations_count >= 1,
  });
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
// UNE confirmation par personne (identifiant d'appareil, repli IP) et par
// incident — jamais de doublon d'incident, jamais de double comptage.
// Pour un incendie : vérification de proximité si la position est partagée.
publicRouter.post('/confirm/direct', ipRateLimit('confirm_ip', 10, 60), (req, res) => {
  if (getSettingNum('verification_required') !== 0) {
    return res.status(403).json({ error: msg(req, 'invalid_params') });
  }
  const incident = db.prepare(`SELECT id, public_id, type, public_lat, public_lng, confirmations_count
                               FROM incidents WHERE public_id = ? AND status = 'active'`)
    .get(String(req.body?.publicId || ''));
  if (!incident) return res.status(404).json({ error: msg(req, 'incident_closed_or_missing') });

  const b = req.body || {};
  const hasPos = isFiniteNum(b.approxLat, -90, 90) && isFiniteNum(b.approxLng, -180, 180);
  let verificationStatus = 'unverified';
  if (hasPos) {
    const d = distanceKm(Number(b.approxLat), Number(b.approxLng), incident.public_lat, incident.public_lng);
    if (incident.type === 'fire' && d > getSettingNum('fire_confirm_max_km')) {
      return res.status(400).json({ error: msg(req, 'too_far_fire'), tooFar: true });
    }
    verificationStatus = 'nearby';
  }

  try {
    db.prepare(`INSERT INTO confirmations(id, incident_id, contact_hash, approx_lat, approx_lng,
                                          confirmation_type, verification_status)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(uuid(), incident.id, contributorHash(req, incident.id, 'ipconfirm'),
        hasPos ? Math.round(Number(b.approxLat) * 100) / 100 : null,
        hasPos ? Math.round(Number(b.approxLng) * 100) / 100 : null,
        incident.type === 'fire' ? 'fire_seen' : 'affected', verificationStatus);
  } catch {
    return res.status(400).json({ error: msg(req, 'already_confirmed'), alreadyConfirmed: true });
  }
  db.prepare(`UPDATE incidents SET confirmations_count = confirmations_count + 1,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(incident.id);
  const confirmations = incident.confirmations_count + 1;
  const fireThreshold = getSettingNum('fire_confirm_threshold');
  broadcast('incident', { publicId: incident.public_id, confirmations });
  res.json({
    ok: true, confirmations, fireThreshold,
    communityConfirmed: incident.type === 'fire' ? confirmations >= fireThreshold : true,
  });
});

// --- « Signaler que cet incident est terminé » ------------------------------
// Un signalement par personne ; clôture automatique au seuil configuré
// (résolution communautaire), avec heure de fin médiane proposée.
publicRouter.post('/incidents/:publicId/resolution', ipRateLimit('resolution_ip', 10, 60), (req, res) => {
  if (getSetting('community_resolution_enabled') === '0') {
    return res.status(403).json({ error: msg(req, 'invalid_params') });
  }
  const incident = db.prepare(`SELECT id, public_id, started_at, confirmations_count FROM incidents
                               WHERE public_id = ? AND status = 'active'`)
    .get(String(req.params.publicId));
  if (!incident) return res.status(404).json({ error: msg(req, 'incident_closed_or_missing') });

  const b = req.body || {};
  // « Terminé maintenant » → heure serveur ; sinon validation stricte de
  // l'heure choisie : postérieure au début, jamais dans le futur.
  const isNow = b.isNow === true || !b.proposedEndedAt;
  let proposedEndedAt = nowIso();
  if (!isNow) {
    if (!isIsoDate(b.proposedEndedAt)) return res.status(400).json({ error: msg(req, 'invalid_end') });
    const ts = Date.parse(b.proposedEndedAt);
    if (ts <= Date.parse(incident.started_at)) {
      return res.status(400).json({ error: msg(req, 'end_before_start') });
    }
    if (ts > Date.now() + 60_000) return res.status(400).json({ error: msg(req, 'end_in_future') });
    proposedEndedAt = new Date(ts).toISOString();
  }

  try {
    db.prepare(`INSERT INTO resolution_reports(id, incident_id, contributor_hash, proposed_ended_at, is_now, comment)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(uuid(), incident.id, contributorHash(req, incident.id, 'resolution'),
        proposedEndedAt, isNow ? 1 : 0, cleanText(b.comment, 300) || null);
  } catch {
    return res.status(400).json({ error: msg(req, 'resolution_already'), alreadyReported: true });
  }

  const pending = db.prepare(`SELECT proposed_ended_at FROM resolution_reports
                              WHERE incident_id = ? AND status = 'pending' ORDER BY created_at`).all(incident.id);
  const threshold = getSettingNum('resolution_threshold');
  let resolved = false;
  if (pending.length >= threshold) {
    // Heure de fin : la plus récente proposée, sinon maintenant.
    const proposed = pending.map((r) => r.proposed_ended_at).filter(Boolean).sort();
    const endedAt = proposed.length ? proposed[proposed.length - 1] : nowIso();
    db.prepare(`UPDATE incidents SET status = 'resolved', temporal_status = 'finished', ended_at = ?,
                resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), resolution_source = 'community',
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(endedAt, incident.id);
    db.prepare(`UPDATE resolution_reports SET status = 'applied' WHERE incident_id = ? AND status = 'pending'`)
      .run(incident.id);
    audit('community', 'incident_resolved_by_reports', incident.id, { reports: pending.length });
    broadcast('incident', { publicId: incident.public_id, status: 'resolved' });
    resolved = true;
  } else {
    audit('public', 'resolution_reported', incident.id, { count: pending.length }, clientIp(req));
    broadcast('incident', { publicId: incident.public_id });
  }
  res.json({ ok: true, message: msg(req, 'resolution_recorded'), reports: pending.length, threshold, resolved });
});

// --- Proposition de correction de localisation (visiteur) --------------------
// N'applique JAMAIS la correction directement : elle est enregistrée pour
// modération (le déclarant, lui, corrige directement via son lien de gestion).
publicRouter.post('/incidents/:publicId/location-correction', ipRateLimit('correction_ip', 5, 60), (req, res) => {
  const incident = db.prepare(`SELECT id, public_id, public_lat, public_lng, public_area FROM incidents
                               WHERE public_id = ? AND status IN ('active','resolved')`)
    .get(String(req.params.publicId));
  if (!incident) return res.status(404).json({ error: msg(req, 'incident_not_found') });
  const b = req.body || {};
  if (!isFiniteNum(b.lat, -90, 90) || !isFiniteNum(b.lng, -180, 180)) {
    return res.status(400).json({ error: msg(req, 'invalid_location') });
  }
  db.prepare(`INSERT INTO location_corrections
      (id, incident_id, prev_lat, prev_lng, new_lat, new_lng, prev_address, new_address,
       submitted_by, contributor_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public', ?, 'pending')`)
    .run(uuid(), incident.id, incident.public_lat, incident.public_lng,
      Number(b.lat), Number(b.lng), incident.public_area,
      cleanText(b.address, 300) || null, contributorHash(req, incident.id, 'correction'));
  audit('public', 'location_correction_proposed', incident.id, null, clientIp(req));
  res.json({ ok: true, message: msg(req, 'correction_thanks') });
});

// --- Détections satellitaires NASA FIRMS ------------------------------------
// Données importées et stockées côté serveur (l'API FIRMS n'est JAMAIS appelée
// depuis le navigateur, la clé n'est jamais exposée). Anomalies thermiques —
// jamais présentées comme confirmation officielle d'incendie.
publicRouter.get('/satellite/events', (req, res) => {
  if (getSetting('nasa_firms_public_layer_enabled') === '0') {
    return res.json({ count: 0, events: [], lastSyncAt: null });
  }
  const confList = publicConfidenceList();
  const wanted = String(req.query.confidence || '');
  const conf = wanted === 'high' ? ['high'] : confList;
  const rows = db.prepare(
    `SELECT id, centroid_lat AS lat, centroid_lng AS lng, uncertainty_radius_m,
            first_detected_at, last_detected_at, max_confidence, max_frp,
            detection_count, satellite_count, satellites, confirmations_count, status
     FROM satellite_events
     WHERE status IN ('active','no_new_detection')
       AND linked_incident_id IS NULL
       AND max_confidence IN (${conf.map(() => '?').join(',')})
     ORDER BY last_detected_at DESC LIMIT 300`
  ).all(...conf);
  res.json({
    count: rows.length,
    events: rows,
    lastSyncAt: getSetting('firms_last_success_at') || null,
  });
});

publicRouter.get('/satellite/events/:id', (req, res) => {
  const ev = db.prepare(
    `SELECT id, centroid_lat AS lat, centroid_lng AS lng, uncertainty_radius_m,
            first_detected_at, last_detected_at, max_confidence, max_frp,
            detection_count, satellite_count, satellites, confirmations_count, status
     FROM satellite_events WHERE id = ? AND status != 'false_positive'`
  ).get(String(req.params.id));
  if (!ev) return res.status(404).json({ error: msg(req, 'incident_not_found') });
  res.json({ ...ev, lastSyncAt: getSetting('firms_last_success_at') || null });
});

// « Je vois cet incendie / je suis concerné » sur un événement satellite :
// confirmation rattachée à l'événement EXISTANT — jamais de doublon.
publicRouter.post('/satellite/events/:id/feedback', ipRateLimit('sat_feedback_ip', 10, 60), (req, res) => {
  const ev = db.prepare(`SELECT * FROM satellite_events WHERE id = ? AND status IN ('active','no_new_detection')`)
    .get(String(req.params.id));
  if (!ev) return res.status(404).json({ error: msg(req, 'incident_closed_or_missing') });
  const kind = ['confirm', 'not_fire', 'error'].includes(req.body?.kind) ? req.body.kind : 'confirm';
  try {
    db.prepare(`INSERT INTO satellite_event_feedback(id, event_id, kind, contributor_hash) VALUES (?, ?, ?, ?)`)
      .run(uuid(), ev.id, kind, contributorHash(req, ev.id, `satfb-${kind}`));
  } catch {
    return res.status(400).json({ error: msg(req, 'already_confirmed'), alreadyConfirmed: true });
  }
  let confirmations = ev.confirmations_count;
  if (kind === 'confirm') {
    confirmations += 1;
    db.prepare(`UPDATE satellite_events SET confirmations_count = confirmations_count + 1,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(ev.id);
  } else {
    audit('public', 'satellite_event_feedback', ev.id, { kind }, clientIp(req));
  }
  broadcast('incident', { satellite: true });
  res.json({ ok: true, confirmations, threshold: getSettingNum('fire_confirm_threshold') });
});

// --- Coupures officielles STEG (uniquement si la couche officielle est
// activée ET que les enregistrements viennent d'une source autorisée) --------
publicRouter.get('/steg/outages', (req, res) => {
  if (getSetting('steg_official_layer_enabled') !== '1') return res.json({ count: 0, outages: [] });
  const rows = db.prepare(
    `SELECT id, official_status, planned, reason, affected_governorate, affected_delegation,
            affected_locality, lat, lng, started_at, estimated_restoration_at, ended_at,
            published_at, source_updated_at
     FROM steg_official_outages
     WHERE official_status IN ('planned','ongoing','restoration_in_progress')
     ORDER BY COALESCE(started_at, published_at) DESC LIMIT 200`
  ).all();
  res.json({ count: rows.length, outages: rows });
});

// --- Annuaire de contacts tunisiens vérifiés --------------------------------
// Source unique des numéros affichés (jamais de numéro en dur côté frontend,
// jamais de numéro étranger). Filtré par type d'incident, trié par priorité.
publicRouter.get('/contacts', (req, res) => {
  const type = ['electricity', 'water', 'fire', 'internet', 'other'].includes(req.query.type)
    ? String(req.query.type) : null;
  const rows = db.prepare(`SELECT id, name_fr, name_ar, phone_display, phone_tel, incident_types,
                                  coverage, region, note_fr, note_ar, priority
                           FROM contacts WHERE is_active = 1 ORDER BY priority, name_fr`).all();
  const list = rows.filter((c) => !type || c.incident_types.split(',').includes(type));
  res.json({ contacts: list });
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
    satelliteLayer: getSetting('nasa_firms_public_layer_enabled') !== '0',
    stegOfficialLayer: getSetting('steg_official_layer_enabled') === '1',
    communityResolution: getSetting('community_resolution_enabled') !== '0',
  });
});

// --- Statistiques publiques minimales (compteur d'accueil) ------------------
publicRouter.get('/stats', (req, res) => {
  const active = db.prepare(`SELECT COUNT(*) AS n FROM incidents WHERE status = 'active'`).get().n;
  const byType = db.prepare(`SELECT type, COUNT(*) AS n FROM incidents WHERE status = 'active' GROUP BY type`).all();
  res.json({ active, byType: Object.fromEntries(byType.map((r) => [r.type, r.n])) });
});
