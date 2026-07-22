// Détection de doublons : même type + proximité géographique + fenêtre temporelle
// + statut actif (+ similarité de description en critère secondaire).
import { db, getSettingNum } from '../db.js';
import { distanceM } from './anonymize.js';

export function findSimilar(type, lat, lng, startedAt) {
  const radius = getSettingNum('dedup_radius_m');
  const windowH = getSettingNum('dedup_window_h');
  const dLat = radius / 111_320;
  const dLng = radius / (111_320 * Math.cos((lat * Math.PI) / 180) || 1);

  const candidates = db.prepare(
    `SELECT id, public_id, type, status, description, started_at, public_lat, public_lng,
            lat, lng, confirmations_count, public_area
     FROM incidents
     WHERE type = ? AND status IN ('active','verified','pending_review')
       AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
       AND ABS(strftime('%s', started_at) - strftime('%s', ?)) < ?
     LIMIT 20`
  ).all(type, lat - dLat, lat + dLat, lng - dLng, lng + dLng, startedAt, windowH * 3600);

  return candidates
    .map((c) => ({ ...c, distance: distanceM(lat, lng, c.lat, c.lng) }))
    .filter((c) => c.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    // Ne jamais renvoyer les coordonnées exactes au client.
    .map(({ lat: _l, lng: _g, ...pub }) => pub);
}

// Similarité grossière de descriptions (détection de textes identiques répétés / spam).
export function textSimilarity(a, b) {
  const norm = (s) => new Set(String(s).toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const A = norm(a), B = norm(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

// Un texte identique soumis N fois récemment = signal de bot.
export function isRepeatedText(description) {
  if (!description) return false;
  const recent = db.prepare(
    `SELECT description FROM incidents
     WHERE created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hours') AND description != ''
     ORDER BY created_at DESC LIMIT 50`
  ).all();
  let identical = 0;
  for (const r of recent) if (textSimilarity(description, r.description) > 0.9) identical++;
  return identical >= 3;
}

export function mergeAsDuplicate(duplicateId, mainId) {
  db.prepare(`UPDATE incidents SET status = 'possible_duplicate', duplicate_of = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(mainId, duplicateId);
  db.prepare(`UPDATE incidents SET confirmations_count = confirmations_count + 1,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(mainId);
}
