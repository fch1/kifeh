// Connecteur de données officielles STEG — PRÉPARÉ mais DÉSACTIVÉ tant
// qu'aucune source AUTORISÉE n'est configurée (steg_connector_enabled = 0).
//
// Principes non négociables :
// - jamais de scraping (espaces clients, API privées, sites tiers non officiels) ;
// - aucune donnée n'est étiquetée « STEG » sans source officielle vérifiable ;
// - les identifiants d'accès (futurs) restent côté serveur, jamais journalisés.
//
// Modes futurs prévus par ce contrat : API REST officielle (OAuth 2.0 client
// credentials), webhook signé, dépôt SFTP sécurisé, flux CSV/GeoJSON officiel,
// flux de coupures planifiées approuvé — et, dès aujourd'hui, l'import MANUEL
// par un administrateur d'une annonce officielle vérifiable.
import { db, getSetting } from '../db.js';
import { uuid } from './crypto.js';
import { cleanText, isFiniteNum, isIsoDate } from '../middleware/security.js';
import { audit } from './audit.js';
import { broadcast } from '../routes/events.js';

export const OFFICIAL_STATUSES = ['planned', 'ongoing', 'restoration_in_progress', 'resolved', 'cancelled'];
export const ALLOWED_SOURCES = ['manual_admin', 'official_api', 'webhook', 'sftp', 'feed'];

export function connectorEnabled() { return getSetting('steg_connector_enabled') === '1'; }
export function officialLayerEnabled() { return getSetting('steg_official_layer_enabled') === '1'; }

// Valide et normalise un enregistrement de coupure officielle (tout champ
// entrant est traité comme non fiable, quel que soit le mode d'ingestion).
export function normalizeOfficialOutage(raw, source) {
  if (!ALLOWED_SOURCES.includes(source)) return { error: 'source_not_allowed' };
  const b = raw || {};
  if (!OFFICIAL_STATUSES.includes(b.officialStatus)) return { error: 'invalid_status' };
  const out = {
    externalId: cleanText(b.externalId, 100) || null,
    source,
    officialStatus: b.officialStatus,
    incidentType: 'electricity',
    planned: b.planned === true ? 1 : 0,
    reason: cleanText(b.reason, 300) || null,
    affectedGovernorate: cleanText(b.affectedGovernorate, 80) || null,
    affectedDelegation: cleanText(b.affectedDelegation, 80) || null,
    affectedLocality: cleanText(b.affectedLocality, 120) || null,
    affectedGeometry: null,
    lat: isFiniteNum(b.lat, -90, 90) ? Number(b.lat) : null,
    lng: isFiniteNum(b.lng, -180, 180) ? Number(b.lng) : null,
    startedAt: b.startedAt && isIsoDate(b.startedAt) ? new Date(b.startedAt).toISOString() : null,
    estimatedRestorationAt: b.estimatedRestorationAt && isIsoDate(b.estimatedRestorationAt)
      ? new Date(b.estimatedRestorationAt).toISOString() : null,
    endedAt: b.endedAt && isIsoDate(b.endedAt) ? new Date(b.endedAt).toISOString() : null,
    publishedAt: b.publishedAt && isIsoDate(b.publishedAt) ? new Date(b.publishedAt).toISOString() : null,
    stegDistrict: cleanText(b.stegDistrict, 120) || null,
    sourceReference: cleanText(b.sourceReference, 300) || null,
  };
  if (b.affectedGeometry) {
    try {
      const g = typeof b.affectedGeometry === 'string' ? JSON.parse(b.affectedGeometry) : b.affectedGeometry;
      if (g && typeof g.type === 'string') out.affectedGeometry = JSON.stringify(g).slice(0, 20000);
    } catch { /* géométrie invalide ignorée */ }
  }
  return { record: out };
}

// Insère ou met à jour (idempotent par external_id) une coupure officielle.
// Exige que le connecteur soit activé SAUF pour l'import manuel administrateur
// (annonce officielle vérifiable, seule voie autorisée aujourd'hui).
export function upsertOfficialOutage(raw, source, actor) {
  if (source !== 'manual_admin' && !connectorEnabled()) return { error: 'connector_disabled' };
  const { record, error } = normalizeOfficialOutage(raw, source);
  if (error) return { error };
  if (source === 'manual_admin' && !record.sourceReference) return { error: 'source_reference_required' };

  const existing = record.externalId
    ? db.prepare('SELECT id FROM steg_official_outages WHERE external_id = ?').get(record.externalId) : null;
  const id = existing?.id || uuid();
  if (existing) {
    db.prepare(`UPDATE steg_official_outages SET official_status = @officialStatus, planned = @planned,
        reason = @reason, affected_governorate = @affectedGovernorate, affected_delegation = @affectedDelegation,
        affected_locality = @affectedLocality, affected_geometry = @affectedGeometry, lat = @lat, lng = @lng,
        started_at = @startedAt, estimated_restoration_at = @estimatedRestorationAt, ended_at = @endedAt,
        published_at = @publishedAt, steg_district = @stegDistrict, source_reference = @sourceReference,
        source_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = @id`)
      .run({ ...record, id });
  } else {
    db.prepare(`INSERT INTO steg_official_outages
        (id, external_id, source, official_status, incident_type, planned, reason,
         affected_governorate, affected_delegation, affected_locality, affected_geometry, lat, lng,
         started_at, estimated_restoration_at, ended_at, published_at, steg_district, source_reference,
         verified_at, verified_by, source_updated_at)
        VALUES (@id, @externalId, @source, @officialStatus, @incidentType, @planned, @reason,
         @affectedGovernorate, @affectedDelegation, @affectedLocality, @affectedGeometry, @lat, @lng,
         @startedAt, @estimatedRestorationAt, @endedAt, @publishedAt, @stegDistrict, @sourceReference,
         strftime('%Y-%m-%dT%H:%M:%fZ','now'), @actor, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
      .run({ ...record, id, actor: actor || null });
  }
  audit(actor || 'system', existing ? 'steg_outage_updated' : 'steg_outage_imported', id, { source });
  broadcast('incident', { steg: true });
  return { ok: true, id };
}
