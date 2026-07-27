// « Mon statut de sécurité » / « حالتي الآن » — check-in PERSONNEL et
// TEMPORAIRE pendant un incident grave.
//
// Principes non négociables (produit et vie privée) :
//   1. un statut personnel n'est JAMAIS une information sur l'incident :
//      il ne confirme rien, ne clôt rien, ne compte dans aucun compteur ;
//   2. rien n'est public : le statut n'est visible que par son auteur et par
//      les personnes recevant son lien sécurisé — jamais sur la carte ;
//   3. données minimales : pas de coordonnées GPS, pas de nom obligatoire,
//      jetons stockés hachés, expiration automatique, suppression possible ;
//   4. « J'ai besoin d'aide » affiche IMMÉDIATEMENT les numéros d'urgence du
//      bon pays côté client — aucun enregistrement, aucun formulaire, et
//      Kifeh ne prétend jamais avoir contacté les secours.
import { Router } from 'express';
import { db, getSetting, getSettingNum } from '../db.js';
import { uuid, sha256, randomToken, hmac } from '../services/crypto.js';
import { cleanText } from '../middleware/security.js';
import { ipRateLimit, clientIp } from '../middleware/rateLimit.js';
import { requestCountry } from '../countries/index.js';
import { msg } from '../i18n.js';

export const safetyRouter = Router();

function enabledFor(country) {
  if (getSetting('safety_checkin_enabled') === '0') return false;
  if (country === 'FR') return getSetting('safety_checkin_fr_enabled') !== '0';
  return getSetting('safety_checkin_tn_enabled') !== '0';
}

const STATUSES = new Set(['safe', 'left_area']);
function expiryHours(status) {
  return status === 'left_area'
    ? (getSettingNum('safety_left_expiry_h') || 12)
    : (getSettingNum('safety_safe_expiry_h') || 6);
}
const nowIso = () => new Date().toISOString();
const plusHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const isExpired = (row) => Date.parse(row.expires_at) < Date.now();

// Zone approximative rattachée au statut : quartier/commune de l'incident —
// jamais une position de la personne.
function areaLabelFor(incidentId, satelliteEventId) {
  if (incidentId) {
    const i = db.prepare(`SELECT public_area FROM incidents WHERE id = ? OR public_id = ?`)
      .get(incidentId, incidentId);
    return i?.public_area || null;
  }
  if (satelliteEventId) return null; // zone satellite : pas de nom de lieu fiable
  return null;
}

function deviceHashOf(req) {
  const deviceId = String(req.body?.deviceId || '').slice(0, 64);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(deviceId)) return null;
  return hmac(`safety:device:${deviceId}`);
}

// Réponse « propriétaire » : tout ce que l'auteur peut voir de son statut.
function ownerView(row) {
  return {
    id: row.id,
    status: row.status,
    displayName: row.display_name || null,
    message: row.personal_message || null,
    areaLabel: row.area_label || null,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    expired: isExpired(row),
    shared: Boolean(row.sharing_token_hash),
  };
}

function findByManagementToken(token) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(String(token || ''))) return null;
  return db.prepare(`SELECT * FROM safety_checkins WHERE management_token_hash = ? AND revoked_at IS NULL`)
    .get(sha256(String(token)));
}

// ── Créer / mettre à jour (idempotent) ──────────────────────────────────────
// Un seul statut ACTIF par appareil et par incident : re-soumettre met à jour
// le statut existant (réseau mobile instable → jamais de doublon).
safetyRouter.post('/checkins', ipRateLimit('safety_ip', 20, 60), (req, res) => {
  const country = requestCountry(req);
  if (!enabledFor(country)) return res.status(404).json({ error: msg(req, 'incident_not_found') });
  const status = String(req.body?.status || '');
  if (!STATUSES.has(status)) return res.status(400).json({ error: msg(req, 'invalid_params') });

  const displayName = cleanText(String(req.body?.displayName || ''), 40) || null;
  const message = cleanText(String(req.body?.message || ''), 280) || null;
  let incidentId = null, satelliteEventId = null;
  if (req.body?.incidentId) {
    const i = db.prepare(`SELECT id FROM incidents WHERE public_id = ? OR id = ?`)
      .get(String(req.body.incidentId).slice(0, 40), String(req.body.incidentId).slice(0, 40));
    if (!i) return res.status(404).json({ error: msg(req, 'incident_not_found') });
    incidentId = i.id;
  } else if (req.body?.satelliteEventId) {
    satelliteEventId = String(req.body.satelliteEventId).slice(0, 40);
  }

  const deviceHash = deviceHashOf(req);
  const ipHash = hmac(`safety:ip:${clientIp(req)}`);
  const expiresAt = plusHours(expiryHours(status));

  // Idempotence : statut actif existant pour ce même appareil + même contexte ?
  const existing = deviceHash ? db.prepare(
    `SELECT * FROM safety_checkins
     WHERE device_hash = ? AND COALESCE(incident_id,'') = COALESCE(?, '')
       AND COALESCE(satellite_event_id,'') = COALESCE(?, '')
       AND revoked_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).get(deviceHash, incidentId, satelliteEventId) : null;

  if (existing) {
    db.prepare(`UPDATE safety_checkins SET status = ?, display_name = COALESCE(?, display_name),
                personal_message = COALESCE(?, personal_message),
                updated_at = ?, expires_at = ? WHERE id = ?`)
      .run(status, displayName, message, nowIso(), expiresAt, existing.id);
    const row = db.prepare(`SELECT * FROM safety_checkins WHERE id = ?`).get(existing.id);
    return res.json({ ...ownerView(row), managementToken: null, updated: true });
  }

  const id = uuid();
  const managementToken = randomToken(24);
  db.prepare(`INSERT INTO safety_checkins
      (id, country_code, incident_id, satellite_event_id, status, display_name,
       personal_message, area_label, device_hash, ip_hash, management_token_hash, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, country, incidentId, satelliteEventId, status, displayName, message,
      areaLabelFor(incidentId, satelliteEventId), deviceHash, ipHash,
      sha256(managementToken), expiresAt);
  const row = db.prepare(`SELECT * FROM safety_checkins WHERE id = ?`).get(id);
  res.json({ ...ownerView(row), managementToken, updated: false });
});

// ── Modifier son statut (jeton de gestion) ──────────────────────────────────
safetyRouter.post('/checkins/update', ipRateLimit('safety_ip', 20, 60), (req, res) => {
  const row = findByManagementToken(req.body?.managementToken);
  if (!row) return res.status(404).json({ error: msg(req, 'incident_not_found') });
  const status = req.body?.status != null ? String(req.body.status) : row.status;
  if (!STATUSES.has(status)) return res.status(400).json({ error: msg(req, 'invalid_params') });
  const displayName = req.body?.displayName != null
    ? (cleanText(String(req.body.displayName), 40) || null) : row.display_name;
  const message = req.body?.message != null
    ? (cleanText(String(req.body.message), 280) || null) : row.personal_message;
  db.prepare(`UPDATE safety_checkins SET status = ?, display_name = ?, personal_message = ?,
              updated_at = ?, expires_at = ? WHERE id = ?`)
    .run(status, displayName, message, nowIso(), plusHours(expiryHours(status)), row.id);
  res.json(ownerView(db.prepare(`SELECT * FROM safety_checkins WHERE id = ?`).get(row.id)));
});

// ── Supprimer (révoquer) son statut — lien partagé inclus ───────────────────
safetyRouter.post('/checkins/delete', ipRateLimit('safety_ip', 20, 60), (req, res) => {
  const row = findByManagementToken(req.body?.managementToken);
  if (!row) return res.status(404).json({ error: msg(req, 'incident_not_found') });
  // Contenu personnel effacé immédiatement — seule la trace minimale demeure.
  db.prepare(`UPDATE safety_checkins SET revoked_at = ?, display_name = NULL,
              personal_message = NULL, sharing_token_hash = NULL WHERE id = ?`)
    .run(nowIso(), row.id);
  res.json({ ok: true });
});

// ── Lien sécurisé « Prévenir un proche » ────────────────────────────────────
safetyRouter.post('/checkins/share', ipRateLimit('safety_ip', 20, 60), (req, res) => {
  const row = findByManagementToken(req.body?.managementToken);
  if (!row || isExpired(row)) return res.status(404).json({ error: msg(req, 'incident_not_found') });
  const sharingToken = randomToken(24);
  db.prepare(`UPDATE safety_checkins SET sharing_token_hash = ?, updated_at = ? WHERE id = ?`)
    .run(sha256(sharingToken), nowIso(), row.id);
  res.json({ shareToken: sharingToken });
});

safetyRouter.post('/checkins/revoke-share', ipRateLimit('safety_ip', 20, 60), (req, res) => {
  const row = findByManagementToken(req.body?.managementToken);
  if (!row) return res.status(404).json({ error: msg(req, 'incident_not_found') });
  db.prepare(`UPDATE safety_checkins SET sharing_token_hash = NULL, updated_at = ? WHERE id = ?`)
    .run(nowIso(), row.id);
  res.json({ ok: true });
});

// ── Page partagée : ce que voit un proche via le lien ───────────────────────
// UNIQUEMENT ce que l'auteur a choisi : statut, prénom éventuel, zone
// approximative, horodatage. Jamais de coordonnées, de contact ni d'ID interne.
safetyRouter.get('/shared/:token', ipRateLimit('safety_view_ip', 60, 60), (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return res.status(404).json({ error: msg(req, 'incident_not_found') });
  const row = db.prepare(
    `SELECT * FROM safety_checkins WHERE sharing_token_hash = ? AND revoked_at IS NULL`
  ).get(sha256(token));
  if (!row) return res.status(404).json({ error: msg(req, 'incident_not_found') });
  // Lien lui-même limité dans le temps (au-delà : introuvable, pas « périmé »).
  const shareTtlH = getSettingNum('safety_share_expiry_h') || 48;
  if (Date.now() - Date.parse(row.updated_at) > shareTtlH * 3600_000) {
    return res.status(404).json({ error: msg(req, 'incident_not_found') });
  }
  res.set('X-Robots-Tag', 'noindex');
  res.json({
    status: row.status,
    displayName: row.display_name || null,
    message: row.personal_message || null,
    areaLabel: row.area_label || null,
    updatedAt: row.updated_at,
    current: !isExpired(row), // false → « information non mise à jour récemment »
  });
});
