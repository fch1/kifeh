// Back-office : file d'attente, modération, fusion de doublons, contacts,
// configuration, journal d'audit, export, statistiques. Toute consultation de
// donnée sensible est journalisée.
import { Router } from 'express';
import { db, getSetting, setSetting, touchIncident } from '../db.js';
import { scryptVerify, scryptHash, uuid, sha256 } from '../services/crypto.js';
import { createSession, destroySession, requireAdmin, can } from '../middleware/adminAuth.js';
import { ipRateLimit, clientIp } from '../middleware/rateLimit.js';
import { mergeAsDuplicate } from '../services/dedup.js';
import { anonymizeCoords } from '../services/anonymize.js';
import { cleanText, isFiniteNum } from '../middleware/security.js';
import { broadcast } from './events.js';
import { audit } from '../services/audit.js';
import { defaultSettings, config as firmsConfig } from '../config.js';
import { syncFirms } from '../services/firms.js';
import { devOutbox } from '../services/notifier.js';
import { generateTotpSecret, verifyTotp, otpauthUrl } from '../services/totp.js';
import { offsiteBackup } from '../services/offsite.js';
import { syncVigilance } from '../services/vigilance.js';

export const adminRouter = Router();

// --- Authentification ------------------------------------------------------
adminRouter.post('/login', ipRateLimit('admin_login', 10, 15), (req, res) => {
  const { username, password } = req.body || {};
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username || ''));
  if (!admin || !scryptVerify(String(password || ''), admin.password_hash)) {
    audit('system', 'admin_login_failed', null, { username: String(username || '').slice(0, 30) }, clientIp(req));
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }
  // Double authentification facultative (TOTP) — issue de secours documentée :
  // ADMIN_TOTP_RESET=1 en variable d'environnement désactive le second facteur
  // au démarrage suivant (jamais de blocage définitif du compte).
  const totpSecret = getSetting('admin_totp_secret');
  if (totpSecret) {
    if (!req.body?.totp) return res.status(401).json({ error: 'Code de double authentification requis.', totpRequired: true });
    if (!verifyTotp(totpSecret, req.body.totp)) {
      audit('system', 'admin_totp_failed', null, null, clientIp(req));
      return res.status(401).json({ error: 'Code de double authentification incorrect.', totpRequired: true });
    }
  }
  const { cookie, csrf } = createSession(admin.id);
  res.cookie?.('admin_session', cookie); // express sans cookie-parser : en-tête manuel ci-dessous
  res.set('Set-Cookie', `admin_session=${encodeURIComponent(cookie)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${8 * 3600}`);
  audit(admin.username, 'admin_login', null, null, clientIp(req));
  res.json({ ok: true, csrf, role: admin.role, username: admin.username });
});

// ── Double authentification (TOTP) — activation en 2 étapes sûres :
//    setup → secret proposé ; enable {code} → vérifié PUIS activé (jamais
//    d'activation sans preuve que l'application TOTP fonctionne).
adminRouter.post('/2fa/setup', requireAdmin(), (req, res) => {
  if (getSetting('admin_totp_secret')) return res.status(400).json({ error: 'Déjà activée.' });
  const secret = generateTotpSecret();
  setSetting('admin_totp_pending', secret);
  res.json({ secret, otpauth: otpauthUrl(secret, req.admin.username) });
});
adminRouter.post('/2fa/enable', requireAdmin(), (req, res) => {
  const pending = getSetting('admin_totp_pending');
  if (!pending) return res.status(400).json({ error: 'Aucune activation en cours.' });
  if (!verifyTotp(pending, req.body?.code)) return res.status(400).json({ error: 'Code incorrect — réessayez.' });
  setSetting('admin_totp_secret', pending);
  setSetting('admin_totp_pending', '');
  audit(req.admin.username, 'admin_2fa_enabled', null, null, clientIp(req));
  res.json({ ok: true });
});
adminRouter.post('/2fa/disable', requireAdmin(), (req, res) => {
  const secret = getSetting('admin_totp_secret');
  if (!secret) return res.status(400).json({ error: 'Non activée.' });
  if (!verifyTotp(secret, req.body?.code)) return res.status(400).json({ error: 'Code incorrect.' });
  setSetting('admin_totp_secret', '');
  audit(req.admin.username, 'admin_2fa_disabled', null, null, clientIp(req));
  res.json({ ok: true });
});

// Vigilance Météo-France : synchronisation manuelle (supervision).
adminRouter.post('/vigilance/sync', requireAdmin(), async (req, res) => {
  res.json(await syncVigilance({ force: true }));
});

// Sauvegarde hors-site : état + déclenchement manuel.
adminRouter.post('/offsite-backup', requireAdmin(), async (req, res) => {
  res.json(await offsiteBackup({ force: true }));
});

// ── « Situation incendie » : autorités officielles (liste blanche) ───────────
// Seules les autorités enregistrées et vérifiées ici peuvent publier des
// informations officielles. Jamais de source anonyme ni de réseau social.
adminRouter.get('/official/authorities', requireAdmin(), (req, res) => {
  res.json({ authorities: db.prepare(`SELECT * FROM official_authorities ORDER BY country_code, name`).all() });
});
adminRouter.post('/official/authorities', requireAdmin(), (req, res) => {
  const b = req.body || {};
  const types = ['commune', 'intercommunalite', 'prefecture', 'departement', 'sdis', 'ministere', 'fr_alert', 'autre_autorite'];
  const levels = ['commune', 'intercommunalite', 'departement', 'region', 'national'];
  if (!b.name || !types.includes(b.authorityType) || !levels.includes(b.coverageLevel)) {
    return res.status(400).json({ error: 'Nom, type d’autorité et niveau de couverture requis.' });
  }
  const id = uuid();
  db.prepare(`INSERT INTO official_authorities
      (id, country_code, name, authority_type, official_domain, coverage_level,
       coverage_codes, source_url, retrieval_method, verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admin_import', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
    .run(id, String(b.countryCode || 'FR').toUpperCase(), cleanText(b.name, 200),
      b.authorityType, cleanText(b.officialDomain, 200) || null, b.coverageLevel,
      cleanText(b.coverageCodes, 200) || null, cleanText(b.sourceUrl, 500) || null);
  audit(req.admin.username, 'official_authority_added', id, { name: b.name }, clientIp(req));
  res.json({ ok: true, id });
});

// Import d'un message officiel : source vérifiée obligatoire, texte original
// PRÉSERVÉ, possibilité de remplacer un message antérieur (supersedes).
adminRouter.post('/official/updates', requireAdmin(), (req, res) => {
  const b = req.body || {};
  const authority = db.prepare(`SELECT * FROM official_authorities WHERE id = ? AND is_active = 1`)
    .get(String(b.authorityId || ''));
  if (!authority) return res.status(400).json({ error: 'Autorité inconnue ou inactive (liste blanche obligatoire).' });
  const types = ['situation_update', 'safety_instruction', 'evacuation', 'shelter_in_place', 'road_closure',
    'access_restriction', 'fire_status', 'end_of_alert', 'prevention', 'other'];
  if (!types.includes(b.infoType)) return res.status(400).json({ error: 'Type d’information invalide.' });
  if (!b.publishedAt || Number.isNaN(Date.parse(b.publishedAt))) {
    return res.status(400).json({ error: 'Horodatage de publication requis.' });
  }
  if (!cleanText(b.summaryFr, 500)) return res.status(400).json({ error: 'Résumé français requis.' });
  let geometryJson = null;
  if (b.geometry) {
    try { geometryJson = JSON.stringify(b.geometry).slice(0, 100_000); }
    catch { return res.status(400).json({ error: 'Géométrie invalide.' }); }
    if (!cleanText(b.geometrySource, 200)) {
      return res.status(400).json({ error: 'Un périmètre doit indiquer sa source.' });
    }
  }
  const id = uuid();
  const raw = String(b.rawContent || '').slice(0, 20_000);
  db.prepare(`INSERT INTO official_updates
      (id, country_code, authority_id, source_url, source_title, raw_content,
       summary_fr, summary_ar, info_type, severity, affected_dept_codes, affected_commune_codes,
       centroid_lat, centroid_lng, radius_km, geometry_json, geometry_source,
       valid_from, valid_until, published_at, updated_at_source, source_hash, supersedes_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, authority.country_code, authority.id,
      cleanText(b.sourceUrl, 500) || null, cleanText(b.sourceTitle, 300) || null, raw || null,
      cleanText(b.summaryFr, 500), cleanText(b.summaryAr, 500) || null,
      b.infoType, ['info', 'important', 'urgent'].includes(b.severity) ? b.severity : 'info',
      cleanText(b.deptCodes, 100) || null, cleanText(b.communeCodes, 300) || null,
      isFiniteNum(b.lat, -90, 90) ? Number(b.lat) : null,
      isFiniteNum(b.lng, -180, 180) ? Number(b.lng) : null,
      isFiniteNum(b.radiusKm, 1, 500) ? Number(b.radiusKm) : null,
      geometryJson, cleanText(b.geometrySource, 200) || null,
      b.validFrom || null, b.validUntil || null,
      new Date(b.publishedAt).toISOString(), b.updatedAtSource || null,
      sha256(raw || b.summaryFr), b.supersedesId || null);
  // Le message remplacé reste en historique (jamais supprimé).
  if (b.supersedesId) {
    db.prepare(`UPDATE official_updates SET status = 'superseded',
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(String(b.supersedesId));
  }
  audit(req.admin.username, 'official_update_imported', id,
    { authority: authority.name, type: b.infoType }, clientIp(req));
  broadcast('incident', { official: true, country: authority.country_code });
  res.json({ ok: true, id });
});
adminRouter.get('/official/updates', requireAdmin(), (req, res) => {
  res.json({
    updates: db.prepare(
      `SELECT u.*, a.name AS authority_name FROM official_updates u
       JOIN official_authorities a ON a.id = u.authority_id
       ORDER BY u.published_at DESC LIMIT 100`).all(),
  });
});
adminRouter.post('/official/updates/:id/archive', requireAdmin(), (req, res) => {
  db.prepare(`UPDATE official_updates SET status = 'archived',
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(String(req.params.id));
  audit(req.admin.username, 'official_update_archived', String(req.params.id), null, clientIp(req));
  res.json({ ok: true });
});

adminRouter.post('/logout', requireAdmin(), (req, res) => {
  destroySession(req.admin.session_id);
  res.set('Set-Cookie', 'admin_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

adminRouter.get('/me', requireAdmin(), (req, res) => {
  res.json({ username: req.admin.username, role: req.admin.role, csrf: req.admin.csrf });
});

// --- File d'attente et liste ------------------------------------------------
adminRouter.get('/incidents', requireAdmin('review'), (req, res) => {
  const status = String(req.query.status || '');
  const valid = ['draft', 'pending_verification', 'verified', 'active', 'possible_duplicate',
    'pending_review', 'resolved', 'expired', 'rejected', 'deleted'];
  const where = valid.includes(status) ? 'WHERE i.status = ?' : `WHERE i.status IN ('pending_review','possible_duplicate','active')`;
  const args = valid.includes(status) ? [status] : [];
  const rows = db.prepare(
    `SELECT i.id, i.public_id, i.type, i.status, i.severity, i.description, i.started_at, i.ended_at,
            i.public_area, i.trust_score, i.confirmations_count, i.duplicate_of, i.created_at, i.updated_at,
            (SELECT COUNT(*) FROM reports r WHERE r.incident_id = i.id AND r.status = 'open') AS open_reports,
            (SELECT COUNT(*) FROM attachments a WHERE a.incident_id = i.id) AS attachments_count
     FROM incidents i ${where} ORDER BY i.created_at DESC LIMIT 200`
  ).all(...args);
  res.json({ incidents: rows });
});

// Détail complet — la localisation exacte n'est renvoyée qu'aux rôles
// autorisés, et sa consultation est journalisée.
adminRouter.get('/incidents/:id', requireAdmin('review'), (req, res) => {
  const i = db.prepare('SELECT * FROM incidents WHERE id = ? OR public_id = ?')
    .get(String(req.params.id), String(req.params.id));
  if (!i) return res.status(404).json({ error: 'Incident introuvable.' });

  const showExact = can(req.admin.role, 'exact_location');
  if (showExact) {
    audit(req.admin.username, 'view_exact_location', i.id, null, clientIp(req));
  }
  const reports = db.prepare('SELECT id, reason, detail, status, created_at FROM reports WHERE incident_id = ?').all(i.id);
  const attachments = db.prepare('SELECT id, mime, moderation_status, public, clean_path IS NOT NULL AS cleaned FROM attachments WHERE incident_id = ?').all(i.id);
  const similar = db.prepare(
    `SELECT id, public_id, status, started_at, confirmations_count FROM incidents
     WHERE type = ? AND id != ? AND status IN ('active','pending_review','possible_duplicate')
       AND ABS(public_lat - ?) < 0.01 AND ABS(public_lng - ?) < 0.015 LIMIT 10`
  ).all(i.type, i.id, i.public_lat, i.public_lng);

  res.json({
    ...i,
    lat: showExact ? i.lat : null,
    lng: showExact ? i.lng : null,
    address: showExact ? i.address : null,
    reports, attachments, similar,
    trust_score: i.trust_score,
  });
});

// --- Actions de modération -------------------------------------------------
adminRouter.post('/incidents/:id/approve', requireAdmin('review'), (req, res) => {
  const i = mustIncident(req, res); if (!i) return;
  db.prepare(`UPDATE incidents SET status = 'active' WHERE id = ?`).run(i.id);
  touchIncident(i.id);
  audit(req.admin.username, 'incident_approved', i.id, null, clientIp(req));
  broadcast('incident', { publicId: i.public_id, status: 'active' });
  res.json({ ok: true });
});

adminRouter.post('/incidents/:id/reject', requireAdmin('moderate'), (req, res) => {
  const i = mustIncident(req, res); if (!i) return;
  db.prepare(`UPDATE incidents SET status = 'rejected' WHERE id = ?`).run(i.id);
  touchIncident(i.id);
  audit(req.admin.username, 'incident_rejected', i.id, { reason: cleanText(req.body?.reason, 200) }, clientIp(req));
  broadcast('incident', { publicId: i.public_id, status: 'rejected' });
  res.json({ ok: true });
});

adminRouter.post('/incidents/:id/edit', requireAdmin('moderate'), (req, res) => {
  const i = mustIncident(req, res); if (!i) return;
  const description = cleanText(req.body?.description, 500);
  const severity = ['low', 'moderate', 'high', 'immediate_danger'].includes(req.body?.severity) ? req.body.severity : i.severity;
  db.prepare(`UPDATE incidents SET description = COALESCE(NULLIF(?, ''), description), severity = ? WHERE id = ?`)
    .run(description, severity, i.id);
  touchIncident(i.id);
  audit(req.admin.username, 'incident_edited', i.id, null, clientIp(req));
  broadcast('incident', { publicId: i.public_id });
  res.json({ ok: true });
});

adminRouter.post('/incidents/:id/hide-description', requireAdmin('moderate'), (req, res) => {
  const i = mustIncident(req, res); if (!i) return;
  db.prepare(`UPDATE incidents SET hidden_description = 1 WHERE id = ?`).run(i.id);
  touchIncident(i.id);
  audit(req.admin.username, 'description_hidden', i.id, null, clientIp(req));
  broadcast('incident', { publicId: i.public_id });
  res.json({ ok: true });
});

adminRouter.post('/incidents/:id/merge', requireAdmin('merge'), (req, res) => {
  const i = mustIncident(req, res); if (!i) return;
  const main = db.prepare('SELECT id, public_id FROM incidents WHERE id = ? OR public_id = ?')
    .get(String(req.body?.mainId || ''), String(req.body?.mainId || ''));
  if (!main || main.id === i.id) return res.status(400).json({ error: 'Incident principal invalide.' });
  mergeAsDuplicate(i.id, main.id);
  audit(req.admin.username, 'incidents_merged', i.id, { into: main.id }, clientIp(req));
  broadcast('incident', { publicId: main.public_id });
  res.json({ ok: true });
});

// Modération des pièces jointes.
adminRouter.post('/attachments/:id/moderate', requireAdmin('moderate'), (req, res) => {
  const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(String(req.params.id));
  if (!att) return res.status(404).json({ error: 'Pièce jointe introuvable.' });
  const status = ['approved', 'rejected'].includes(req.body?.status) ? req.body.status : 'rejected';
  const makePublic = status === 'approved' && req.body?.public === true && att.clean_path ? 1 : 0;
  db.prepare('UPDATE attachments SET moderation_status = ?, public = ? WHERE id = ?').run(status, makePublic, att.id);
  audit(req.admin.username, 'attachment_moderated', att.id, { status, public: makePublic }, clientIp(req));
  res.json({ ok: true });
});

// Consultation d'une pièce jointe (originale = privée) — journalisée.
adminRouter.get('/attachments/:id/file', requireAdmin('attachments'), (req, res) => {
  const att = db.prepare('SELECT * FROM attachments WHERE id = ?').get(String(req.params.id));
  if (!att) return res.status(404).end();
  audit(req.admin.username, 'view_attachment', att.id, null, clientIp(req));
  res.sendFile(att.clean_path || att.original_path, { root: process.cwd() });
});

// Suspension d'un contact abusif.
adminRouter.post('/reporters/:id/suspend', requireAdmin('suspend'), (req, res) => {
  const r = db.prepare('SELECT id FROM reporters WHERE id = ?').get(String(req.params.id));
  if (!r) return res.status(404).json({ error: 'Contact introuvable.' });
  const hours = Math.min(24 * 30, Math.max(1, Number(req.body?.hours) || 72));
  db.prepare(`UPDATE reporters SET blocked_until = strftime('%Y-%m-%dT%H:%M:%fZ','now', ?), abuse_strikes = abuse_strikes + 1 WHERE id = ?`)
    .run(`+${hours} hours`, r.id);
  audit(req.admin.username, 'reporter_suspended', r.id, { hours }, clientIp(req));
  res.json({ ok: true });
});

// Traiter un signalement.
adminRouter.post('/reports/:id/handle', requireAdmin('review'), (req, res) => {
  db.prepare(`UPDATE reports SET status = 'handled' WHERE id = ?`).run(String(req.params.id));
  res.json({ ok: true });
});

// Réouvrir un incident clôturé (par erreur ou clôture communautaire abusive).
adminRouter.post('/incidents/:id/reopen', requireAdmin('moderate'), (req, res) => {
  const i = mustIncident(req, res); if (!i) return;
  const ttlH = Number(getSetting('active_incident_ttl_h')) || 24;
  db.prepare(`UPDATE incidents SET status = 'active', temporal_status = 'ongoing', ended_at = NULL,
              expires_at = strftime('%Y-%m-%dT%H:%M:%fZ','now', ?) WHERE id = ?`)
    .run(`+${ttlH} hours`, i.id);
  db.prepare(`UPDATE resolution_reports SET status = 'dismissed' WHERE incident_id = ? AND status IN ('pending','applied')`)
    .run(i.id);
  touchIncident(i.id);
  audit(req.admin.username, 'incident_reopened', i.id, null, clientIp(req));
  broadcast('incident', { publicId: i.public_id, status: 'active' });
  res.json({ ok: true });
});

// --- Corrections de localisation proposées par des visiteurs -----------------
adminRouter.get('/corrections', requireAdmin('review'), (req, res) => {
  const rows = db.prepare(
    `SELECT c.*, i.public_id, i.type FROM location_corrections c
     JOIN incidents i ON i.id = c.incident_id
     WHERE c.status = 'pending' ORDER BY c.created_at DESC LIMIT 100`
  ).all();
  res.json({ corrections: rows });
});

adminRouter.post('/corrections/:id/approve', requireAdmin('moderate'), (req, res) => {
  const c = db.prepare(`SELECT * FROM location_corrections WHERE id = ? AND status = 'pending'`)
    .get(String(req.params.id));
  if (!c) return res.status(404).json({ error: 'Correction introuvable ou déjà traitée.' });
  const i = db.prepare('SELECT * FROM incidents WHERE id = ?').get(c.incident_id);
  const pub = anonymizeCoords(c.new_lat, c.new_lng, i.id, Number(getSetting('anonymize_radius_m')) || 250);
  db.transaction(() => {
    db.prepare(`UPDATE incidents SET lat = ?, lng = ?, public_lat = ?, public_lng = ?,
                public_area = COALESCE(NULLIF(?, ''), public_area) WHERE id = ?`)
      .run(c.new_lat, c.new_lng, pub.lat, pub.lng, c.new_address, i.id);
    db.prepare(`UPDATE location_corrections SET status = 'applied',
                reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(c.id);
  })();
  touchIncident(i.id);
  audit(req.admin.username, 'correction_approved', i.id, { correction: c.id }, clientIp(req));
  broadcast('incident', { publicId: i.public_id });
  res.json({ ok: true });
});

adminRouter.post('/corrections/:id/reject', requireAdmin('moderate'), (req, res) => {
  db.prepare(`UPDATE location_corrections SET status = 'rejected',
              reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'pending'`)
    .run(String(req.params.id));
  audit(req.admin.username, 'correction_rejected', String(req.params.id), null, clientIp(req));
  res.json({ ok: true });
});

// --- NASA FIRMS : supervision et modération ----------------------------------
adminRouter.get('/firms/status', requireAdmin('review'), (req, res) => {
  res.json({
    keyConfigured: Boolean(firmsConfig.firms.mapKey),
    lastSyncAt: getSetting('firms_last_sync_at') || null,
    lastSuccessAt: getSetting('firms_last_success_at') || null,
    lastError: getSetting('firms_last_error') || null,
    txCount: Number(getSetting('firms_tx_count') || 0),
    sources: String(getSetting('firms_sources') || ''),
    detections: db.prepare('SELECT COUNT(*) AS n FROM satellite_detections').get().n,
    events: db.prepare(`SELECT status, COUNT(*) AS n FROM satellite_events GROUP BY status`).all(),
  });
});

adminRouter.post('/firms/sync', requireAdmin('moderate'), async (req, res) => {
  audit(req.admin.username, 'firms_manual_sync', null, null, clientIp(req));
  const result = await syncFirms({ force: true });
  res.json({ ok: true, result });
});

adminRouter.get('/firms/detections', requireAdmin('review'), (req, res) => {
  const rows = db.prepare(
    `SELECT id, source, satellite, instrument, lat, lng, acquired_at, confidence, frp,
            day_night, raw_payload, imported_at, satellite_event_id
     FROM satellite_detections ORDER BY acquired_at DESC LIMIT 200`
  ).all();
  res.json({ detections: rows });
});

adminRouter.get('/firms/events', requireAdmin('review'), (req, res) => {
  const rows = db.prepare(
    `SELECT e.*, i.public_id AS linked_public_id FROM satellite_events e
     LEFT JOIN incidents i ON i.id = e.linked_incident_id
     ORDER BY e.last_detected_at DESC LIMIT 200`
  ).all();
  res.json({ events: rows });
});

adminRouter.post('/firms/events/:id/false-positive', requireAdmin('moderate'), (req, res) => {
  db.prepare(`UPDATE satellite_events SET status = 'false_positive', linked_incident_id = NULL,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(String(req.params.id));
  audit(req.admin.username, 'satellite_event_false_positive', String(req.params.id), null, clientIp(req));
  broadcast('incident', { satellite: true });
  res.json({ ok: true });
});

// Association / dissociation manuelle détection ↔ incident citoyen.
adminRouter.post('/firms/events/:id/link', requireAdmin('moderate'), (req, res) => {
  const ev = db.prepare(`SELECT id FROM satellite_events WHERE id = ?`).get(String(req.params.id));
  if (!ev) return res.status(404).json({ error: 'Événement introuvable.' });
  const incidentId = req.body?.incidentId ? String(req.body.incidentId) : null;
  if (incidentId) {
    const i = db.prepare('SELECT id, public_id FROM incidents WHERE id = ? OR public_id = ?').get(incidentId, incidentId);
    if (!i) return res.status(404).json({ error: 'Incident introuvable.' });
    db.prepare(`UPDATE satellite_events SET linked_incident_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .run(i.id, ev.id);
    broadcast('incident', { publicId: i.public_id, satellite: true });
  } else {
    db.prepare(`UPDATE satellite_events SET linked_incident_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .run(ev.id);
    broadcast('incident', { satellite: true });
  }
  audit(req.admin.username, 'satellite_event_linked', ev.id, { incidentId }, clientIp(req));
  res.json({ ok: true });
});

// Sources thermiques persistantes (industries, torchères…) — masquées.
adminRouter.get('/firms/thermal-sources', requireAdmin('review'), (req, res) => {
  res.json({ sources: db.prepare('SELECT * FROM thermal_sources ORDER BY created_at DESC').all() });
});

adminRouter.post('/firms/thermal-sources', requireAdmin('moderate'), (req, res) => {
  const b = req.body || {};
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!cleanText(b.name, 120) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Nom et coordonnées requis.' });
  }
  const id = uuid();
  db.prepare(`INSERT INTO thermal_sources(id, name, lat, lng, radius_m) VALUES (?, ?, ?, ?, ?)`)
    .run(id, cleanText(b.name, 120), lat, lng, Math.min(20000, Math.max(100, Number(b.radiusM) || 1500)));
  audit(req.admin.username, 'thermal_source_added', id, null, clientIp(req));
  res.json({ ok: true, id });
});

adminRouter.post('/firms/thermal-sources/:id/toggle', requireAdmin('moderate'), (req, res) => {
  db.prepare(`UPDATE thermal_sources SET is_active = 1 - is_active WHERE id = ?`).run(String(req.params.id));
  res.json({ ok: true });
});

// --- Annuaire de contacts tunisiens ------------------------------------------
// Modifiable sans redéploiement ; l'ancienne valeur est conservée dans le
// journal d'audit (retour arrière possible). Alerte si vérification > 6 mois.
adminRouter.get('/contacts', requireAdmin('config'), (req, res) => {
  const rows = db.prepare('SELECT * FROM contacts ORDER BY priority, name_fr').all();
  const sixMonthsAgo = Date.now() - 182 * 24 * 3600_000;
  res.json({
    contacts: rows.map((c) => ({
      ...c,
      needsVerification: !c.verified_at || Date.parse(c.verified_at) < sixMonthsAgo,
    })),
  });
});

adminRouter.post('/contacts/:id', requireAdmin('config'), (req, res) => {
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(String(req.params.id));
  if (!c) return res.status(404).json({ error: 'Contact introuvable.' });
  const b = req.body || {};
  const phoneTel = cleanText(String(b.phoneTel ?? c.phone_tel), 20).replace(/[^\d+]/g, '');
  if (!/^\+?\d{3,15}$/.test(phoneTel)) return res.status(400).json({ error: 'Numéro invalide.' });
  // Historique : l'ancienne valeur part au journal d'audit AVANT modification.
  audit(req.admin.username, 'contact_updated', c.id, {
    before: { phone_display: c.phone_display, phone_tel: c.phone_tel, is_active: c.is_active },
  }, clientIp(req));
  db.prepare(`UPDATE contacts SET
      name_fr = COALESCE(NULLIF(?, ''), name_fr),
      name_ar = COALESCE(NULLIF(?, ''), name_ar),
      phone_display = COALESCE(NULLIF(?, ''), phone_display),
      phone_tel = ?,
      is_active = ?,
      source_name = COALESCE(NULLIF(?, ''), source_name),
      source_url = COALESCE(NULLIF(?, ''), source_url),
      verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      verified_by = ?
      WHERE id = ?`)
    .run(cleanText(b.nameFr, 120), cleanText(b.nameAr, 120), cleanText(b.phoneDisplay, 30),
      phoneTel, b.isActive === false ? 0 : 1,
      cleanText(b.sourceName, 200), cleanText(b.sourceUrl, 300),
      req.admin.username, c.id);
  res.json({ ok: true });
});

// --- Boîte d'envoi interne ---------------------------------------------------
// Quand aucun fournisseur SMS/e-mail n'est configuré, les codes OTP et liens
// atterrissent ici. Consultation réservée aux rôles autorisés et journalisée.
adminRouter.get('/outbox', requireAdmin('review'), (req, res) => {
  audit(req.admin.username, 'view_outbox', null, null, clientIp(req));
  res.json({ outbox: devOutbox.slice(-50).reverse() });
});

// --- Configuration ----------------------------------------------------------
adminRouter.get('/settings', requireAdmin('config'), (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
});

adminRouter.post('/settings', requireAdmin('config'), (req, res) => {
  const updates = req.body?.settings || {};
  for (const [k, v] of Object.entries(updates)) {
    if (!(k in defaultSettings)) continue; // clés inconnues ignorées
    setSetting(k, cleanText(String(v), 100));
  }
  audit(req.admin.username, 'settings_updated', null, { keys: Object.keys(updates) }, clientIp(req));
  res.json({ ok: true });
});

// --- Journal d'audit --------------------------------------------------------
adminRouter.get('/audit', requireAdmin('audit'), (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300').all();
  res.json({ log: rows });
});

// --- Export CSV -------------------------------------------------------------
adminRouter.get('/export', requireAdmin('export'), (req, res) => {
  audit(req.admin.username, 'export_incidents', null, null, clientIp(req));
  const rows = db.prepare(
    `SELECT public_id, type, status, severity, temporal_status, started_at, ended_at,
            public_lat, public_lng, public_area, trust_score, confirmations_count, created_at, updated_at
     FROM incidents WHERE status != 'deleted' ORDER BY created_at DESC`
  ).all();
  const header = Object.keys(rows[0] || { public_id: '' }).join(';');
  const esc = (v) => v == null ? '' : `"${String(v).replaceAll('"', '""')}"`;
  const csv = [header, ...rows.map((r) => Object.values(r).map(esc).join(';'))].join('\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="incidents.csv"');
  res.send('﻿' + csv);
});

// --- Statistiques agrégées (accessibles aussi au rôle analyste) -------------
adminRouter.get('/stats', requireAdmin('stats'), (req, res) => {
  const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM incidents GROUP BY status').all();
  const byType = db.prepare(`SELECT type, COUNT(*) AS n FROM incidents WHERE status != 'deleted' GROUP BY type`).all();
  const byDay = db.prepare(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM incidents
     WHERE created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days') GROUP BY day ORDER BY day`
  ).all();
  const avgResolutionMin = db.prepare(
    `SELECT AVG((strftime('%s', ended_at) - strftime('%s', started_at)) / 60.0) AS m
     FROM incidents WHERE status = 'resolved' AND ended_at IS NOT NULL`
  ).get().m;
  const confirmations = db.prepare('SELECT COUNT(*) AS n FROM confirmations').get().n;
  const openReports = db.prepare(`SELECT COUNT(*) AS n FROM reports WHERE status = 'open'`).get().n;
  res.json({ byStatus, byType, byDay, avgResolutionMin, confirmations, openReports });
});

function mustIncident(req, res) {
  const i = db.prepare('SELECT id, public_id FROM incidents WHERE id = ? OR public_id = ?')
    .get(String(req.params.id), String(req.params.id));
  if (!i) { res.status(404).json({ error: 'Incident introuvable.' }); return null; }
  return i;
}
