// Anonymisation des coordonnées pour la carte publique.
// Décalage DÉTERMINISTE par incident (seed = id) dans un anneau autour du point
// exact : le point publié ne bouge pas d'un affichage à l'autre (sinon on
// pourrait trianguler la vraie position en moyennant), et l'adresse exacte
// d'un domicile n'est jamais publiée.
import crypto from 'node:crypto';
import { config } from '../config.js';

export function anonymizeCoords(lat, lng, seed, radiusM) {
  const h = crypto.createHmac('sha256', config.hmacKey).update(`anon:${seed}`).digest();
  const u1 = h.readUInt32BE(0) / 0xffffffff; // angle
  const u2 = h.readUInt32BE(4) / 0xffffffff; // distance
  const angle = u1 * 2 * Math.PI;
  // Distance entre 40 % et 100 % du rayon : évite que le point publié tombe pile sur le domicile.
  const dist = radiusM * (0.4 + 0.6 * u2);
  const dLat = (dist * Math.cos(angle)) / 111_320;
  const dLng = (dist * Math.sin(angle)) / (111_320 * Math.cos((lat * Math.PI) / 180) || 1);
  return {
    lat: round5(lat + dLat), // 5 décimales ≈ 1 m de résolution, suffisant pour un point déjà décalé
    lng: round5(lng + dLng),
  };
}

function round5(x) { return Math.round(x * 1e5) / 1e5; }

// Distance haversine en mètres (détection de doublons, cohérence GPS).
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6_371_000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
