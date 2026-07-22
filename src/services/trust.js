// Score de confiance interne (0–100). Jamais exposé publiquement.
// Sous `trust_publish_threshold`, l'incident part en validation manuelle.
import { db } from '../db.js';
import { distanceM } from './anonymize.js';
import { findSimilar } from './dedup.js';

export function computeTrustScore({ reporter, incident, gps, fillSeconds, minFillSeconds, repeatedText, ipDeclarations1h }) {
  let score = 30; // base

  // Vérification réussie (condition d'entrée, mais on la valorise).
  if (reporter?.verified) score += 25;

  // Cohérence de la géolocalisation : position GPS de l'appareil vs point déclaré.
  if (gps && Number.isFinite(gps.lat)) {
    const d = distanceM(gps.lat, gps.lng, incident.lat, incident.lng);
    if (d < 500) score += 15;
    else if (d < 5000) score += 5;
    else score -= 15; // déclare un point très loin de sa position
  }

  // Présence d'autres signalements similaires à proximité.
  const similar = findSimilar(incident.type, incident.lat, incident.lng, incident.started_at);
  if (similar.length >= 1) score += 10;
  if (similar.length >= 3) score += 5;

  // Comportement anormal.
  if (Number.isFinite(fillSeconds) && fillSeconds < minFillSeconds) score -= 30;
  if (repeatedText) score -= 30;
  if (ipDeclarations1h > 3) score -= 15;

  // Historique d'abus associé au contact.
  score -= 20 * (reporter?.abuse_strikes || 0);

  // Ancienneté du contact (contact déjà vu et jamais sanctionné).
  if (reporter) {
    const prior = db.prepare(
      `SELECT COUNT(*) AS n FROM incidents WHERE reporter_id = ? AND status IN ('resolved','expired','active')`
    ).get(reporter.id).n;
    if (prior > 0 && !reporter.abuse_strikes) score += 10;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
