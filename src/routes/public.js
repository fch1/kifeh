// API publiques : carte, recherche, détail, confirmation « je suis aussi
// concerné », signalement de contenu, géocodage. AUCUNE donnée sensible ne
// sort d'ici : les requêtes SQL ne sélectionnent jamais lat/lng exacts,
// adresse exacte ni contact.
import { Router } from 'express';
import { db, getSetting, getSettingNum } from '../db.js';
import { publicConfidenceList } from '../services/firms.js';
import { uuid, hmac, encrypt } from '../services/crypto.js';
import { isEmail, isFiniteNum, isIsoDate, cleanText } from '../middleware/security.js';
import { clientIp, countEvents, recordEvent, ipRateLimit } from '../middleware/rateLimit.js';
import { searchAddress, reverseGeocode } from '../services/geocode.js';
import { lookupDfci, dfciPublicDisplay } from '../services/dfci.js';
import { createVerification, verifyCode } from '../services/otp.js';
import { broadcast } from './events.js';
import { audit } from '../services/audit.js';
import { getLang, msg } from '../i18n.js';
import { config } from '../config.js';
import { requestCountry, enabledCountries, getProfile, resolveCountry, isPhoneFor, normalizePhoneFor } from '../countries/index.js';
import { publicVapidKey, sendTestPush } from '../services/push.js';

export const publicRouter = Router();

// Colonnes publiques UNIQUEMENT.
const PUBLIC_COLS = `public_id, type, status, severity,
  CASE WHEN hidden_description = 1 THEN '' ELSE description END AS description,
  temporal_status, started_at, ended_at, time_approximate,
  public_lat AS lat, public_lng AS lng, public_area AS area,
  COALESCE(country_code, 'TN') AS countryCode,
  confirmations_count, COALESCE(published_at, created_at) AS published_at,
  still_active_at, resolved_at, created_at, updated_at,
  (SELECT MAX(se.last_detected_at) FROM satellite_events se
   WHERE se.linked_incident_id = incidents.id AND se.status != 'false_positive') AS satellite_last_seen`;

// Cloisonnement par pays : actif seulement quand le multi-pays est activé —
// sinon comportement historique inchangé (tout est tunisien).
const multiCountry = () => getSetting('multi_country_enabled') === '1';
// Clé de réglage du dernier import FIRMS réussi, par pays (TN garde la clé
// historique pour ne perdre aucun état déjà en production).
const firmsSuccessKey = (c) => (c === 'TN' ? 'firms_last_success_at' : `firms_last_success_at_${c.toLowerCase()}`);

const nowIso = () => new Date().toISOString();

// Distance approximative en km entre deux points (haversine).
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Identifiants pseudonymisés du contributeur : TOUS ses dénominateurs
// (appareil s'il est fourni, adresse IP toujours) — jamais stockés en clair.
// Règle : au moins un dénominateur pour contribuer, et un dénominateur déjà
// utilisé ne peut JAMAIS resservir sur le même incident (même avec un autre
// appareil derrière la même IP, ou la même IP sans identifiant d'appareil).
function contributorHashes(req, incidentId, prefix) {
  const deviceId = String(req.body?.deviceId || '').slice(0, 64);
  const hashes = [];
  if (/^[A-Za-z0-9_-]{16,64}$/.test(deviceId)) {
    hashes.push(hmac(`${prefix}:${incidentId}:device:${deviceId}`));
  }
  hashes.push(hmac(`${prefix}:${incidentId}:ip:${clientIp(req)}`));
  return hashes; // [0] = principal (appareil si présent), dernier = IP
}
// Compatibilité : hachage principal seul (fraîcheur, réouverture…).
function contributorHash(req, incidentId, prefix) {
  return contributorHashes(req, incidentId, prefix)[0];
}
// Un des dénominateurs a-t-il déjà servi sur cet incident dans cette table ?
// hashCol : colonne du hachage principal ('contact_hash' ou 'contributor_hash').
function denominatorUsed(table, refCol, hashCol, refId, hashes) {
  const ph = hashes.map(() => '?').join(',');
  return Boolean(db.prepare(
    `SELECT 1 FROM ${table} WHERE ${refCol} = ?
     AND (${hashCol} IN (${ph}) OR secondary_hash IN (${ph})) LIMIT 1`
  ).get(refId, ...hashes, ...hashes));
}

// --- Incidents visibles dans une zone de carte -----------------------------
publicRouter.get('/incidents', (req, res) => {
  const q = req.query;
  const conds = [];
  const params = {};

  // Pays demandé (clients historiques sans paramètre → Tunisie).
  if (multiCountry()) {
    conds.push(`COALESCE(country_code, 'TN') = @country`);
    params.country = requestCountry(req);
  }

  // Statuts visibles publiquement : actifs + TERMINÉS récents (résolus ou
  // expirés, dans la fenêtre d'historique). Un incident expiré n'est pas une
  // donnée perdue : il reste consultable, clairement marqué comme terminé.
  const historyH = Math.max(1, getSettingNum('history_visible_days') || 7) * 24;
  const endedCond = `(status IN ('resolved','expired')
    AND updated_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-${historyH} hours'))`;
  if (q.status === 'active') conds.push(`status = 'active'`);
  else if (q.status === 'resolved') conds.push(endedCond);
  else conds.push(`(status = 'active' OR ${endedCond})`);

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

  // Repère DFCI : PUBLIC uniquement pour un feu français avec un code valide
  // ET le drapeau d'affichage actif (déploiement progressif). Jamais la
  // version du référentiel ni l'horodatage — juste le code et sa précision.
  let dfci = null;
  if (row.type === 'fire' && dfciPublicDisplay()) {
    const d = db.prepare(`SELECT dfci_code, dfci_precision, dfci_ambiguous, country_code
                          FROM incidents WHERE public_id = ?`).get(String(req.params.publicId));
    if (d?.dfci_code && (d.country_code || 'TN') === 'FR') {
      dfci = { code: d.dfci_code, precision: d.dfci_precision || '2km', indicative: Boolean(d.dfci_ambiguous) };
    }
  }

  res.json({
    ...row, attachments,
    resolutionReports,
    resolutionThreshold: getSettingNum('resolution_threshold'),
    fireThreshold,
    communityConfirmed: row.type === 'fire' ? row.confirmations_count >= fireThreshold : row.confirmations_count >= 1,
    dfci,
  });
});

// ── Prévisualisation du repère DFCI (étape de localisation d'un feu FR) ─────
// AUCUNE persistance ; le serveur RECALCULE toujours pendant la création du
// brouillon — cette API ne sert qu'à afficher le repère avant la soumission.
publicRouter.post('/location/dfci', ipRateLimit('dfci_ip', 30, 5), (req, res) => {
  const b = req.body || {};
  if (!isFiniteNum(b.lat, -90, 90) || !isFiniteNum(b.lng, -180, 180)) {
    return res.status(400).json({ error: msg(req, 'invalid_params') });
  }
  const r = lookupDfci({
    lat: Number(b.lat), lng: Number(b.lng),
    countryCode: String(b.country || ''), incidentType: String(b.type || ''),
    gpsAccuracy: isFiniteNum(b.gpsAccuracy, 0, 100_000) ? Number(b.gpsAccuracy) : null,
  });
  if (!r.available) return res.json({ available: false });
  res.json({
    available: true,
    dfci: { code: r.code, precision: r.precision, indicative: Boolean(r.ambiguous || r.lowAccuracy) },
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
  const incident = db.prepare(`SELECT id, public_id, country_code FROM incidents WHERE public_id = ? AND status = 'active'`)
    .get(String(b.publicId || ''));
  if (!incident) return res.status(404).json({ error: msg(req, 'incident_closed_or_missing') });
  if (b.consent !== true) return res.status(400).json({ error: msg(req, 'consent_required') });

  let channel, contact;
  if (b.method === 'sms') {
    // Format téléphonique du PAYS DE L'INCIDENT (jamais de la langue).
    const ctyCode = incident.country_code || 'TN';
    if (!isPhoneFor(b.phone || '', ctyCode)) {
      return res.status(400).json({ error: msg(req, ctyCode === 'FR' ? 'invalid_phone_fr' : 'invalid_phone') });
    }
    channel = 'sms'; contact = normalizePhoneFor(b.phone, ctyCode);
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

  // Verrou sur TOUS les dénominateurs : appareil ET adresse IP — aucun des
  // deux ne peut resservir sur cet incident (même via un autre appareil).
  const hashes = contributorHashes(req, incident.id, 'ipconfirm');
  if (denominatorUsed('confirmations', 'incident_id', 'contact_hash', incident.id, hashes)) {
    return res.status(400).json({ error: msg(req, 'already_confirmed'), alreadyConfirmed: true });
  }
  try {
    db.prepare(`INSERT INTO confirmations(id, incident_id, contact_hash, secondary_hash, approx_lat, approx_lng,
                                          confirmation_type, verification_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuid(), incident.id, hashes[0], hashes[1] || null,
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

// --- « C'est toujours en cours » --------------------------------------------
// Actualise la fraîcheur communautaire de l'incident EXISTANT (aucun doublon,
// aucun nouveau compteur) — une actualisation par personne par demi-heure.
publicRouter.post('/incidents/:publicId/still-active', ipRateLimit('still_ip', 20, 60), (req, res) => {
  const incident = db.prepare(`SELECT id, public_id, temporal_status FROM incidents
                               WHERE public_id = ? AND status = 'active'`)
    .get(String(req.params.publicId));
  if (!incident) return res.status(404).json({ error: msg(req, 'incident_closed_or_missing') });
  // Fraîcheur : une actualisation par demi-heure, verrou sur TOUS les dénominateurs.
  const stillHashes = contributorHashes(req, incident.id, 'still');
  if (stillHashes.some((h) => countEvents('still_active', h, 30) > 0)) {
    return res.status(400).json({ error: msg(req, 'already_confirmed'), alreadyReported: true });
  }
  for (const h of stillHashes) recordEvent('still_active', h);
  const now = nowIso();
  db.prepare(`UPDATE incidents SET still_active_at = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(now, incident.id);
  broadcast('incident', { publicId: incident.public_id });
  res.json({ ok: true, stillActiveAt: now });
});

// --- Réouverture communautaire d'un incident clôturé par erreur --------------
publicRouter.post('/incidents/:publicId/reopen', ipRateLimit('reopen_ip', 5, 60), (req, res) => {
  const incident = db.prepare(`SELECT id, public_id, resolved_at, resolution_source FROM incidents
                               WHERE public_id = ? AND status = 'resolved'`)
    .get(String(req.params.publicId));
  if (!incident) return res.status(404).json({ error: msg(req, 'incident_not_found') });
  // Réouverture possible dans les 24 h suivant une clôture (créateur ou communauté).
  if (incident.resolved_at && Date.now() - Date.parse(incident.resolved_at) > 24 * 3600_000) {
    return res.status(400).json({ error: msg(req, 'reopen_too_old') });
  }
  // Réouverture : verrou 24 h sur TOUS les dénominateurs.
  const reopenHashes = contributorHashes(req, incident.id, 'reopen');
  if (reopenHashes.some((h) => countEvents('reopen', h, 24 * 60) > 0)) {
    return res.status(400).json({ error: msg(req, 'already_confirmed'), alreadyReported: true });
  }
  for (const h of reopenHashes) recordEvent('reopen', h);
  const ttlH = getSettingNum('active_incident_ttl_h') || 24;
  db.prepare(`UPDATE incidents SET status = 'active', temporal_status = 'ongoing', ended_at = NULL,
              resolved_at = NULL, resolution_source = NULL,
              still_active_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              expires_at = strftime('%Y-%m-%dT%H:%M:%fZ','now', '+' || ? || ' hours'),
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .run(String(ttlH), incident.id);
  db.prepare(`UPDATE resolution_reports SET status = 'dismissed' WHERE incident_id = ? AND status IN ('pending','applied')`)
    .run(incident.id);
  audit('public', 'incident_reopened_by_community', incident.id, null, clientIp(req));
  broadcast('incident', { publicId: incident.public_id, status: 'active' });
  res.json({ ok: true, message: msg(req, 'reopened_ok') });
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

  // Même verrou multi-dénominateurs que les confirmations.
  const resHashes = contributorHashes(req, incident.id, 'resolution');
  if (denominatorUsed('resolution_reports', 'incident_id', 'contributor_hash', incident.id, resHashes)) {
    return res.status(400).json({ error: msg(req, 'resolution_already'), alreadyReported: true });
  }
  try {
    db.prepare(`INSERT INTO resolution_reports(id, incident_id, contributor_hash, secondary_hash, proposed_ended_at, is_now, comment)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(uuid(), incident.id, resHashes[0], resHashes[1] || null,
        proposedEndedAt, isNow ? 1 : 0, cleanText(b.comment, 300) || null);
  } catch {
    return res.status(400).json({ error: msg(req, 'resolution_already'), alreadyReported: true });
  }

  const pending = db.prepare(`SELECT proposed_ended_at FROM resolution_reports
                              WHERE incident_id = ? AND status = 'pending' ORDER BY created_at`).all(incident.id);
  // Mode « immediate » (défaut) : la clôture s'applique dès la première
  // confirmation — l'incident reste réouvrable pendant 24 h si c'était une
  // erreur. Mode « threshold » : seuil de signalements indépendants.
  const immediate = (getSetting('resolution_mode') || 'immediate') !== 'threshold';
  const threshold = immediate ? 1 : getSettingNum('resolution_threshold');
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
  const country = requestCountry(req);
  const countryCond = multiCountry() ? `AND COALESCE(country_code, 'TN') = ?` : '';
  const rows = db.prepare(
    `SELECT id, centroid_lat AS lat, centroid_lng AS lng, uncertainty_radius_m,
            COALESCE(activity_radius_m, uncertainty_radius_m) AS activityRadiusM,
            first_detected_at, last_detected_at, max_confidence, max_frp,
            detection_count, satellite_count, satellites, confirmations_count, status
     FROM satellite_events
     WHERE status IN ('active','no_new_detection')
       AND linked_incident_id IS NULL
       AND max_confidence IN (${conf.map(() => '?').join(',')})
       ${countryCond}
     ORDER BY last_detected_at DESC LIMIT 300`
  ).all(...conf, ...(countryCond ? [country] : []));
  res.json({
    count: rows.length,
    events: rows,
    lastSyncAt: getSetting(firmsSuccessKey(country)) || null,
  });
});

publicRouter.get('/satellite/events/:id', (req, res) => {
  const ev = db.prepare(
    `SELECT id, centroid_lat AS lat, centroid_lng AS lng, uncertainty_radius_m,
            COALESCE(activity_radius_m, uncertainty_radius_m) AS activityRadiusM,
            first_detected_at, last_detected_at, max_confidence, max_frp,
            detection_count, satellite_count, satellites, confirmations_count, status
     FROM satellite_events WHERE id = ? AND status != 'false_positive'`
  ).get(String(req.params.id));
  if (!ev) return res.status(404).json({ error: msg(req, 'incident_not_found') });
  res.json({ ...ev, lastSyncAt: getSetting(firmsSuccessKey(requestCountry(req))) || null });
});

// « Je vois cet incendie / je suis concerné » sur un événement satellite :
// confirmation rattachée à l'événement EXISTANT — jamais de doublon.
publicRouter.post('/satellite/events/:id/feedback', ipRateLimit('sat_feedback_ip', 10, 60), (req, res) => {
  const ev = db.prepare(`SELECT * FROM satellite_events WHERE id = ? AND status IN ('active','no_new_detection')`)
    .get(String(req.params.id));
  if (!ev) return res.status(404).json({ error: msg(req, 'incident_closed_or_missing') });
  const kind = ['confirm', 'not_fire', 'error'].includes(req.body?.kind) ? req.body.kind : 'confirm';
  // Verrou multi-dénominateurs, par type de retour.
  const fbHashes = contributorHashes(req, ev.id, `satfb-${kind}`);
  const fbUsed = db.prepare(
    `SELECT 1 FROM satellite_event_feedback WHERE event_id = ? AND kind = ?
     AND (contributor_hash IN (${fbHashes.map(() => '?').join(',')})
       OR secondary_hash IN (${fbHashes.map(() => '?').join(',')})) LIMIT 1`
  ).get(ev.id, kind, ...fbHashes, ...fbHashes);
  if (fbUsed) return res.status(400).json({ error: msg(req, 'already_confirmed'), alreadyConfirmed: true });
  try {
    db.prepare(`INSERT INTO satellite_event_feedback(id, event_id, kind, contributor_hash, secondary_hash) VALUES (?, ?, ?, ?, ?)`)
      .run(uuid(), ev.id, kind, fbHashes[0], fbHashes[1] || null);
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

// --- Annuaire de contacts d'urgence vérifiés (par pays) ----------------------
// Source unique des numéros affichés (jamais de numéro en dur côté frontend).
// STRICTEMENT cloisonné : jamais un numéro tunisien en France, ni l'inverse.
publicRouter.get('/contacts', (req, res) => {
  const type = ['electricity', 'water', 'fire', 'internet', 'other'].includes(req.query.type)
    ? String(req.query.type) : null;
  const country = requestCountry(req);
  const rows = db.prepare(`SELECT id, name_fr, name_ar, phone_display, phone_tel, incident_types,
                                  coverage, region, note_fr, note_ar, priority
                           FROM contacts WHERE is_active = 1 AND COALESCE(country_code, 'TN') = ?
                           ORDER BY priority, name_fr`).all(country);
  const list = rows.filter((c) => !type || c.incident_types.split(',').includes(type));
  res.json({ contacts: list, country });
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
  res.json({ results: await searchAddress(q, 5, getLang(req), requestCountry(req)) });
});

publicRouter.get('/geocode/reverse', ipRateLimit('search_ip', 30, 5), async (req, res) => {
  const { lat, lng } = req.query;
  if (!isFiniteNum(lat, -90, 90) || !isFiniteNum(lng, -180, 180)) {
    return res.status(400).json({ error: msg(req, 'invalid_params') });
  }
  res.json({ result: await reverseGeocode(Number(lat), Number(lng), getLang(req), requestCountry(req)) });
});

// --- Pays contenant un point (pour « Utiliser ma position ») -----------------
// Renvoie le pays PRIS EN CHARGE contenant ces coordonnées, ou null — jamais
// de rattachement au pays « le plus proche ». Aucune coordonnée n'est stockée.
publicRouter.get('/resolve-country', ipRateLimit('resolve_ip', 30, 5), (req, res) => {
  const { lat, lng } = req.query;
  if (!isFiniteNum(lat, -90, 90) || !isFiniteNum(lng, -180, 180)) {
    return res.status(400).json({ error: msg(req, 'invalid_params') });
  }
  const code = resolveCountry(Number(lat), Number(lng));
  res.json({ country: code && (multiCountry() ? enabledCountries() : ['TN']).includes(code) ? code : null });
});

// --- Configuration publique (catégories actives…) ---------------------------
publicRouter.get('/config', (req, res) => {
  res.json({
    otherCategoryEnabled: getSettingNum('other_category_enabled') === 1,
    verificationRequired: getSettingNum('verification_required') !== 0,
    sandbox: config.isSandbox,
    gaId: config.isSandbox ? '' : config.gaId, // pas de mesure d'audience dans la sandbox
    satelliteLayer: getSetting('nasa_firms_public_layer_enabled') !== '0',
    communityResolution: getSetting('community_resolution_enabled') !== '0',
    resolutionMode: getSetting('resolution_mode') || 'immediate',
    // Fond de carte : fournisseurs configurés côté serveur (jamais en dur).
    tileProviders: [
      { url: getSetting('tile_primary_url'), attribution: getSetting('tile_primary_attribution') },
      { url: getSetting('tile_secondary_url'), attribution: getSetting('tile_secondary_attribution') },
    ].filter((p) => p.url),
    tileFailThreshold: getSettingNum('tile_fail_threshold') || 6,
    // Alertes de zone (Web Push) : clé publique VAPID — la clé privée reste en base.
    pushKey: publicVapidKey(),
    // Multi-pays : profils CLIENT-SÛRS uniquement (jamais de clé, jamais de
    // configuration serveur). La liste ne contient que les pays activés.
    multiCountry: multiCountry(),
    countries: (multiCountry() ? enabledCountries() : ['TN']).map((code) => {
      const p = getProfile(code);
      return {
        code,
        name: p.name,
        timezone: p.timezone,
        map: p.map,
        phonePlaceholder: p.phone.placeholder,
        callingCode: p.phone.callingCode,
        declarationsEnabled: code !== 'FR' || getSetting('fr_declarations_enabled') === '1',
        satelliteEnabled: getSetting(p.firms.enabledFlag) === '1'
          && getSetting('nasa_firms_public_layer_enabled') !== '0',
      };
    }),
  });
});

// --- Alertes de zone (Web Push — gratuit, sans service tiers) ----------------
// « M'alerter dans cette zone » : abonnement navigateur (VAPID) rattaché à un
// point ARRONDI (~1 km) + rayon + pays. Aucune donnée personnelle stockée.
publicRouter.post('/push/subscribe', ipRateLimit('push_ip', 10, 60), (req, res) => {
  const b = req.body || {};
  const sub = b.subscription || {};
  const endpoint = String(sub.endpoint || '');
  const p256dh = String(sub.keys?.p256dh || '');
  const auth = String(sub.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1024 || !p256dh || !auth) {
    return res.status(400).json({ error: msg(req, 'invalid_params') });
  }
  if (!isFiniteNum(b.lat, -90, 90) || !isFiniteNum(b.lng, -180, 180)) {
    return res.status(400).json({ error: msg(req, 'invalid_location') });
  }
  const radius = isFiniteNum(b.radiusKm, 1, 100) ? Number(b.radiusKm) : 10;
  const types = String(b.types || '').split(',')
    .filter((t) => ['electricity', 'water', 'fire', 'internet', 'other'].includes(t)).join(',');
  const country = requestCountry(req);
  const lang = getLang(req) === 'ar' ? 'ar' : 'fr';
  // Arrondi du centre (~1 km) : la zone suffit, la précision ne regarde personne.
  const lat = Math.round(Number(b.lat) * 100) / 100;
  const lng = Math.round(Number(b.lng) * 100) / 100;
  db.prepare(`INSERT INTO push_subscriptions(id, endpoint, p256dh, auth, country_code,
                center_lat, center_lng, radius_km, types, lang)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
                country_code = excluded.country_code, center_lat = excluded.center_lat,
                center_lng = excluded.center_lng, radius_km = excluded.radius_km,
                types = excluded.types, lang = excluded.lang, failures = 0`)
    .run(uuid(), endpoint, p256dh, auth, country, lat, lng, radius, types, lang);
  res.json({ ok: true, radiusKm: radius, country });
});

publicRouter.post('/push/unsubscribe', ipRateLimit('push_ip', 10, 60), (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  if (endpoint) db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint);
  res.json({ ok: true });
});

// Notification de TEST vers sa propre inscription (l'endpoint n'est connu que
// du navigateur abonné) — libellé explicite, jamais un faux incident.
publicRouter.post('/push/test', ipRateLimit('push_test_ip', 5, 60), async (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  if (!endpoint.startsWith('https://')) return res.status(400).json({ error: msg(req, 'invalid_params') });
  const r = await sendTestPush(endpoint, req.body?.lang === 'ar' ? 'ar' : 'fr');
  if (r.notFound) return res.status(404).json({ error: msg(req, 'incident_not_found') });
  res.json({ ok: r.ok });
});

// --- Télémétrie d'erreurs frontend ------------------------------------------
// Message tronqué, jamais de donnée personnelle ; visible dans les journaux
// serveur et le journal d'audit (observabilité sans service externe).
publicRouter.post('/client-error', ipRateLimit('clienterr_ip', 5, 60), (req, res) => {
  const message = cleanText(String(req.body?.message || ''), 300);
  const source = cleanText(String(req.body?.source || ''), 120);
  if (message) {
    console.error('[client]', source, '—', message);
    audit('client', 'frontend_error', null, { message: message.slice(0, 200), source });
  }
  res.json({ ok: true });
});

// --- Statistiques publiques minimales (compteur d'accueil) ------------------
publicRouter.get('/stats', (req, res) => {
  const cond = multiCountry() ? `AND COALESCE(country_code, 'TN') = ?` : '';
  const args = cond ? [requestCountry(req)] : [];
  const active = db.prepare(`SELECT COUNT(*) AS n FROM incidents WHERE status = 'active' ${cond}`).get(...args).n;
  const byType = db.prepare(`SELECT type, COUNT(*) AS n FROM incidents WHERE status = 'active' ${cond} GROUP BY type`).all(...args);
  res.json({ active, byType: Object.fromEntries(byType.map((r) => [r.type, r.n])) });
});

// --- Alertes de zone par e-mail (Resend) ------------------------------------
// Double consentement : l'abonnement n'est actif qu'après le clic dans
// l'e-mail de confirmation. Désinscription en un clic depuis chaque message.
publicRouter.post('/email-alerts/subscribe', ipRateLimit('email_sub_ip', 6, 60), async (req, res) => {
  const { emailAlertsConfigured, subscribeEmail } = await import('../services/emailAlerts.js');
  if (!emailAlertsConfigured()) return res.status(503).json({ error: msg(req, 'email_alerts_unavailable') });
  const email = String(req.body?.email || '').trim();
  if (!isEmail(email)) return res.status(400).json({ error: msg(req, 'invalid_params') });
  const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: msg(req, 'invalid_params') });
  const radiusKm = Math.max(5, Math.min(50, Number(req.body?.radiusKm) || 20));
  const lang = req.body?.lang === 'ar' ? 'ar' : 'fr';
  try {
    const r = await subscribeEmail({
      email, lat, lng, radiusKm, country: requestCountry(req),
      types: String(req.body?.types || '').slice(0, 60), lang,
    });
    res.json({ ok: true, status: r.status, message: msg(req, r.status === 'already_confirmed'
      ? 'email_already_confirmed' : 'email_check_inbox') });
  } catch (e) {
    console.error('[email-alerts]', String(e.message).replace(process.env.RESEND_API_KEY || '§', '***'));
    res.status(502).json({ error: msg(req, 'email_send_failed') });
  }
});

publicRouter.get('/email-alerts/confirm', ipRateLimit('email_confirm_ip', 30, 60), async (req, res) => {
  const { confirmEmail } = await import('../services/emailAlerts.js');
  const okConfirm = confirmEmail(req.query.token);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
    <body style="font-family:sans-serif;max-width:480px;margin:3rem auto;text-align:center">
    <h2>${okConfirm ? msg(req, 'email_confirmed_title') : msg(req, 'email_link_invalid')}</h2>
    <p>${okConfirm ? msg(req, 'email_confirmed_body') : ''}</p>
    <p><a href="/">Kifeh</a></p></body>`);
});

publicRouter.get('/email-alerts/unsubscribe', ipRateLimit('email_unsub_ip', 30, 60), async (req, res) => {
  const { unsubscribeEmail } = await import('../services/emailAlerts.js');
  const okUnsub = unsubscribeEmail(req.query.token);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
    <body style="font-family:sans-serif;max-width:480px;margin:3rem auto;text-align:center">
    <h2>${okUnsub ? msg(req, 'email_unsub_done') : msg(req, 'email_link_invalid')}</h2>
    <p><a href="/">Kifeh</a></p></body>`);
});
