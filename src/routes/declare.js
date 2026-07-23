// Parcours de déclaration : brouillon → contact → vérification → publication.
// Protections : honeypot, délai minimal de remplissage, limites IP/contact,
// clé d'idempotence (double soumission), détection de doublons, score de confiance.
import { Router } from 'express';
import multer from 'multer';
import { db, getSetting, getSettingNum, touchIncident } from '../db.js';
import { uuid, publicId, randomToken, sha256, hmac, encrypt, decrypt } from '../services/crypto.js';
import { isEmail, isPhone, normalizePhone, isFiniteNum, isIsoDate, cleanText, containsSuspiciousContent } from '../middleware/security.js';
import { clientIp, countEvents, recordEvent } from '../middleware/rateLimit.js';
import { anonymizeCoords } from '../services/anonymize.js';
import { findSimilar, isRepeatedText } from '../services/dedup.js';
import { computeTrustScore } from '../services/trust.js';
import { createVerification, verifyCode, resend } from '../services/otp.js';
import { storeAttachment, MAX_UPLOAD_BYTES } from '../services/media.js';
import { sendSms, sendEmail } from '../services/notifier.js';
import { broadcast } from './events.js';
import { audit } from '../services/audit.js';
import { config } from '../config.js';
import { getLang, msg } from '../i18n.js';

export const declareRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

// Clés d'idempotence en mémoire (anti double soumission), TTL 10 min.
const idempotency = new Map();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [k, v] of idempotency) if (v.at < cutoff) idempotency.delete(k);
}, 60_000).unref();

const TYPES = ['electricity', 'water', 'fire', 'internet', 'other'];
const SEVERITIES = ['low', 'moderate', 'high', 'immediate_danger'];
const nowIso = () => new Date().toISOString();

function draftAuth(req, res) {
  const { incidentId, draftToken } = req.body || {};
  if (!incidentId || !draftToken) { res.status(400).json({ error: msg(req, 'draft_invalid'), code: 'draft_expired' }); return null; }
  const row = db.prepare(
    `SELECT i.* FROM incidents i JOIN manage_tokens t ON t.incident_id = i.id
     WHERE i.id = ? AND t.token_hash = ? AND t.revoked = 0 AND t.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).get(String(incidentId), sha256(String(draftToken)));
  if (!row) { res.status(403).json({ error: msg(req, 'draft_expired'), code: 'draft_expired' }); return null; }
  return row;
}

// --- Recherche de doublons avant soumission -------------------------------
declareRouter.post('/check-duplicates', (req, res) => {
  const { type, lat, lng, startedAt } = req.body || {};
  if (!TYPES.includes(type) || !isFiniteNum(lat, -90, 90) || !isFiniteNum(lng, -180, 180) || !isIsoDate(startedAt)) {
    return res.status(400).json({ error: msg(req, 'invalid_params') });
  }
  const similar = findSimilar(type, Number(lat), Number(lng), startedAt).slice(0, 5)
    .map((s) => ({ publicId: s.public_id, type: s.type, startedAt: s.started_at,
                   area: s.public_area, confirmations: s.confirmations_count,
                   description: s.description?.slice(0, 120) || '' }));
  res.json({ similar });
});

// --- Création du brouillon -------------------------------------------------
declareRouter.post('/draft', async (req, res) => {
  const b = req.body || {};
  const ip = clientIp(req);

  // Honeypot : un humain ne remplit jamais ce champ invisible. Réponse générique.
  if (b.website) { audit('system', 'honeypot_hit', null, null, ip); return res.status(400).json({ error: msg(req, 'generic_retry') }); }

  // Délai minimal réaliste de remplissage.
  const minFill = getSettingNum('min_form_fill_s');
  const fillS = Number(b.fillSeconds);
  if (!Number.isFinite(fillS) || fillS < minFill) {
    audit('system', 'too_fast_fill', null, { fillS }, ip);
    return res.status(400).json({ error: msg(req, 'generic_check_form') });
  }

  // Limite par IP.
  if (countEvents('declare_ip', ip, 60) >= getSettingNum('max_declarations_per_ip_per_h')) {
    return res.status(429).json({ error: msg(req, 'too_many_declarations') });
  }

  // Idempotence (double soumission) — on ne ressert la réponse mise en cache
  // que si son jeton de brouillon est toujours valide (non révoqué, non expiré).
  const idemKey = String(b.idempotencyKey || '');
  if (idemKey && idempotency.has(idemKey)) {
    const cached = idempotency.get(idemKey).response;
    const stillValid = db.prepare(
      `SELECT 1 FROM manage_tokens WHERE token_hash = ? AND revoked = 0
       AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    ).get(sha256(String(cached.draftToken)));
    if (stillValid) return res.json(cached);
    idempotency.delete(idemKey);
  }

  // Validation stricte.
  if (!TYPES.includes(b.type)) return res.status(400).json({ error: msg(req, 'invalid_type') });
  if (b.type === 'other' && getSetting('other_category_enabled') !== '1') {
    return res.status(400).json({ error: msg(req, 'category_unavailable') });
  }
  if (!isFiniteNum(b.lat, -90, 90) || !isFiniteNum(b.lng, -180, 180)) {
    return res.status(400).json({ error: msg(req, 'invalid_location') });
  }
  if (!['ongoing', 'finished'].includes(b.temporalStatus)) {
    return res.status(400).json({ error: msg(req, 'invalid_temporal') });
  }
  if (!isIsoDate(b.startedAt)) return res.status(400).json({ error: msg(req, 'invalid_start') });
  if (Date.parse(b.startedAt) > Date.now() + 60_000) {
    return res.status(400).json({ error: msg(req, 'start_future') });
  }
  let endedAt = null;
  if (b.temporalStatus === 'finished') {
    if (!isIsoDate(b.endedAt)) return res.status(400).json({ error: msg(req, 'invalid_end') });
    if (Date.parse(b.endedAt) < Date.parse(b.startedAt)) {
      return res.status(400).json({ error: msg(req, 'end_before_start') });
    }
    endedAt = new Date(b.endedAt).toISOString();
  }
  if (!SEVERITIES.includes(b.severity)) return res.status(400).json({ error: msg(req, 'invalid_severity') });

  const description = cleanText(b.description, 500);
  const comment = cleanText(b.comment, 1000);
  if (containsSuspiciousContent(description)) {
    return res.status(400).json({ error: msg(req, 'desc_no_links') });
  }
  const affected = b.affectedCount == null || b.affectedCount === '' ? null
    : (isFiniteNum(b.affectedCount, 0, 1_000_000) ? Math.round(Number(b.affectedCount)) : null);

  const lat = Number(b.lat), lng = Number(b.lng);
  const radius = getSettingNum('anonymize_radius_m');
  const id = uuid();
  const pub = anonymizeCoords(lat, lng, id, radius);
  const pid = publicId();

  db.prepare(
    `INSERT INTO incidents(id, public_id, type, status, severity, description, comment, affected_count,
       temporal_status, started_at, ended_at, time_approximate, lat, lng, public_lat, public_lng,
       address, public_area, location_source, gps_accuracy)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, pid, b.type, b.severity, description, comment, affected,
    b.temporalStatus, new Date(b.startedAt).toISOString(), endedAt, b.timeApproximate ? 1 : 0,
    lat, lng, pub.lat, pub.lng,
    cleanText(b.address, 300) || null, cleanText(b.publicArea, 200) || null,
    ['gps', 'address', 'manual'].includes(b.locationSource) ? b.locationSource : 'manual',
    isFiniteNum(b.gpsAccuracy, 0, 100_000) ? Number(b.gpsAccuracy) : null);

  // Jeton de brouillon (mêmes mécanismes que le lien de gestion, TTL court).
  const draftToken = randomToken(32);
  db.prepare(`INSERT INTO manage_tokens(id, incident_id, token_hash, expires_at)
              VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 hours'))`)
    .run(uuid(), id, sha256(draftToken));

  recordEvent('declare_ip', ip);

  // Signaux anti-abus mémorisés pour le calcul du score à la publication.
  db.prepare(`UPDATE incidents SET trust_score = ? WHERE id = ?`).run(
    // Score provisoire : encode fillSeconds et texte répété via un pré-calcul.
    computeTrustScore({
      reporter: null,
      incident: { type: b.type, lat, lng, started_at: new Date(b.startedAt).toISOString() },
      gps: isFiniteNum(b.deviceLat, -90, 90) && isFiniteNum(b.deviceLng, -180, 180)
        ? { lat: Number(b.deviceLat), lng: Number(b.deviceLng) } : null,
      fillSeconds: fillS, minFillSeconds: minFill,
      repeatedText: isRepeatedText(description),
      ipDeclarations1h: countEvents('declare_ip', ip, 60),
    }), id);

  const response = { incidentId: id, publicId: pid, draftToken };
  if (idemKey) idempotency.set(idemKey, { at: Date.now(), response });
  res.json(response);
});

// --- Contact + consentement → envoi de la vérification ---------------------
declareRouter.post('/contact', async (req, res) => {
  const incident = draftAuth(req, res);
  if (!incident) return;
  const b = req.body || {};
  const ip = clientIp(req);

  if (b.consent !== true) return res.status(400).json({ error: msg(req, 'consent_required') });

  let channel, contact;
  if (b.method === 'sms') {
    if (!isPhone(b.phone || '')) return res.status(400).json({ error: msg(req, 'invalid_phone') });
    channel = 'sms'; contact = normalizePhone(b.phone);
  } else if (b.method === 'email_code' || b.method === 'email_link') {
    if (!isEmail(b.email || '')) return res.status(400).json({ error: msg(req, 'invalid_email') });
    channel = b.method; contact = String(b.email).toLowerCase().trim();
  } else {
    return res.status(400).json({ error: msg(req, 'choose_method') });
  }

  const contactHash = hmac(contact);

  // Contact suspendu ?
  const existing = db.prepare(`SELECT * FROM reporters WHERE contact_hash = ? ORDER BY created_at DESC LIMIT 1`).get(contactHash);
  if (existing?.blocked_until && Date.parse(existing.blocked_until) > Date.now()) {
    return res.status(429).json({ error: msg(req, 'contact_suspended') });
  }

  // Limites par contact et par IP pour l'envoi d'OTP.
  if (countEvents('declare_contact', contactHash, 24 * 60) >= getSettingNum('max_declarations_per_contact_per_day')) {
    return res.status(429).json({ error: msg(req, 'contact_limit') });
  }
  if (countEvents('otp_send', ip, 60) >= getSettingNum('max_otp_sends_per_ip_per_h')) {
    return res.status(429).json({ error: msg(req, 'too_many_requests') });
  }

  const lang = getLang(req);
  let reporter = existing;
  if (!reporter) {
    const rid = uuid();
    db.prepare(`INSERT INTO reporters(id, channel, contact_encrypted, contact_hash, consent_given_at, lang)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(rid, channel === 'sms' ? 'sms' : 'email', encrypt(contact), contactHash, nowIso(), lang);
    reporter = db.prepare(`SELECT * FROM reporters WHERE id = ?`).get(rid);
  } else {
    db.prepare(`UPDATE reporters SET lang = ? WHERE id = ?`).run(lang, reporter.id);
  }

  db.prepare(`UPDATE incidents SET reporter_id = ?, status = 'pending_verification' WHERE id = ?`).run(reporter.id, incident.id);
  touchIncident(incident.id);

  try {
    const v = await createVerification(reporter, incident, channel, contact, lang);
    recordEvent('otp_send', ip);
    recordEvent('declare_contact', contactHash);
    res.json({ verificationId: v.verificationId, channel });
  } catch (e) {
    console.error('[declare/contact]', e.message);
    res.status(502).json({ error: msg(req, 'send_failed') });
  }
});

// --- Renvoi du code --------------------------------------------------------
declareRouter.post('/resend', async (req, res) => {
  const { verificationId } = req.body || {};
  const v = db.prepare(`SELECT * FROM verifications WHERE id = ?`).get(String(verificationId || ''));
  if (!v) return res.status(404).json({ error: msg(req, 'verif_not_found') });
  const reporter = db.prepare(`SELECT * FROM reporters WHERE id = ?`).get(v.reporter_id);
  const result = await resend(v.id, decrypt(reporter.contact_encrypted), getLang(req));
  if (result.error) return res.status(429).json({ error: result.error });
  res.json({ ok: true });
});

// --- Vérification du code → publication ------------------------------------
declareRouter.post('/verify', async (req, res) => {
  const { verificationId, code } = req.body || {};
  const result = verifyCode(String(verificationId || ''), String(code || ''), getLang(req));
  if (result.error) return res.status(400).json(result);
  const out = await publishIncident(result.incidentId, result.reporterId, clientIp(req), getLang(req));
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

// --- Publication directe SANS vérification -----------------------------------
// Autorisée uniquement quand le réglage admin verification_required vaut 0
// (période transitoire avant la configuration SMS/e-mail). Le code OTP reste
// intact : remettre le réglage à 1 réactive la vérification instantanément.
declareRouter.post('/publish-unverified', async (req, res) => {
  if (getSettingNum('verification_required') !== 0) {
    return res.status(403).json({ error: msg(req, 'invalid_params') });
  }
  const incident = draftAuth(req, res);
  if (!incident) return;
  const out = await publishIncident(incident.id, incident.reporter_id, clientIp(req), getLang(req));
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

// --- Lien e-mail (usage unique) --------------------------------------------
declareRouter.post('/verify-link', async (req, res) => {
  const { vid, t } = req.body || {};
  const result = verifyCode(String(vid || ''), String(t || ''), getLang(req));
  if (result.error) return res.status(400).json(result);
  const out = await publishIncident(result.incidentId, result.reporterId, clientIp(req), getLang(req));
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

async function publishIncident(incidentId, reporterId, ip, lang = 'fr') {
  const incident = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(incidentId);
  if (!incident) return { error: msg(lang, 'declaration_not_found') };
  if (!['pending_verification', 'draft'].includes(incident.status)) {
    return { error: msg(lang, 'already_processed') };
  }
  const reporter = reporterId ? db.prepare(`SELECT * FROM reporters WHERE id = ?`).get(reporterId) : null;

  // Score de confiance final (le score provisoire encode déjà les signaux de
  // remplissage). Sans vérification (mode transitoire), le bonus est accordé
  // pour conserver le même comportement de publication.
  const verifiedBonus = reporter?.verified || getSettingNum('verification_required') === 0 ? 25 : 0;
  const finalScore = Math.max(0, Math.min(100, incident.trust_score + verifiedBonus));
  const threshold = getSettingNum('trust_publish_threshold');
  const similar = findSimilar(incident.type, incident.lat, incident.lng, incident.started_at)
    .filter((s) => s.id !== incident.id);

  // Publication automatique si le score de confiance est suffisant, sinon
  // validation manuelle. La fusion des doublons reste une décision de
  // modération (les similaires sont signalés côté admin via possible_duplicate).
  let status = finalScore < threshold ? 'pending_review' : 'active';
  if (status === 'active' && similar.length > 0 && incident.duplicate_of == null) {
    audit('system', 'similar_at_publish', incident.id, { similarCount: similar.length });
  }

  const ttlH = getSettingNum('active_incident_ttl_h');
  const expiresAt = incident.temporal_status === 'ongoing'
    ? new Date(Date.now() + ttlH * 3600_000).toISOString() : null;

  db.prepare(`UPDATE incidents SET status = ?, trust_score = ?, expires_at = ? WHERE id = ?`)
    .run(status, finalScore, expiresAt, incident.id);
  touchIncident(incident.id);

  // Révoque le jeton de brouillon, crée le lien de gestion durable.
  db.prepare(`UPDATE manage_tokens SET revoked = 1 WHERE incident_id = ?`).run(incident.id);
  const manageToken = randomToken(32);
  const ttlDays = getSettingNum('manage_link_ttl_days');
  db.prepare(`INSERT INTO manage_tokens(id, incident_id, token_hash, expires_at)
              VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now', ?))`)
    .run(uuid(), incident.id, sha256(manageToken), `+${ttlDays} days`);
  const manageUrl = `${config.baseUrl}/manage.html?token=${manageToken}`;

  // Envoi du lien de gestion par SMS / e-mail (si un contact existe).
  try {
    if (!reporter) throw new Error('no-contact');
    const contact = decrypt(reporter.contact_encrypted);
    const userLang = reporter.lang || lang;
    const text = msg(userLang, 'sms_manage', { publicId: incident.public_id, url: manageUrl });
    if (reporter.channel === 'sms') await sendSms(contact, text);
    else await sendEmail(contact, msg(userLang, 'email_manage_subject', { publicId: incident.public_id }), text);
  } catch { /* le lien est aussi affiché à l'écran */ }

  audit('reporter', 'incident_published', incident.id, { status }, ip);
  if (status === 'active') {
    broadcast('incident', { publicId: incident.public_id, status: 'active', type: incident.type });
  }

  return {
    ok: true,
    publicId: incident.public_id,
    status,
    manageUrl,
    incident: {
      publicId: incident.public_id, type: incident.type, status,
      area: incident.public_area, startedAt: incident.started_at,
      lat: incident.public_lat, lng: incident.public_lng,
    },
    pendingReview: status === 'pending_review',
  };
}

// --- Pièce jointe (facultative, sur brouillon authentifié) ------------------
declareRouter.post('/upload', upload.single('file'), async (req, res) => {
  req.body.incidentId = req.body.incidentId || req.query.incidentId;
  req.body.draftToken = req.body.draftToken || req.query.draftToken;
  const incident = draftAuth(req, res);
  if (!incident) return;
  if (!req.file?.buffer) return res.status(400).json({ error: msg(req, 'no_file') });
  const count = db.prepare(`SELECT COUNT(*) AS n FROM attachments WHERE incident_id = ?`).get(incident.id).n;
  if (count >= 3) return res.status(400).json({ error: msg(req, 'max_attachments') });
  try {
    const att = await storeAttachment(incident.id, req.file.buffer);
    res.json({ ok: true, attachmentId: att.id, cleaned: att.hasCleanVersion });
  } catch (e) {
    res.status(400).json({ error: e.key ? msg(req, e.key) : e.message });
  }
});
