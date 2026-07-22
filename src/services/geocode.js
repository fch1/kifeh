// Géocodage et autocomplétion d'adresses via Nominatim (OpenStreetMap),
// avec mise en cache mémoire et repli silencieux si le réseau est indisponible
// (l'utilisateur peut toujours pointer manuellement la carte).
import { config } from '../config.js';

const cache = new Map();
const HEADERS = { 'User-Agent': 'incidents-locaux-mvp/1.0 (contact: admin@example.org)' };
const TTL = 10 * 60 * 1000;

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

export async function searchAddress(q, limit = 5) {
  return cached(`s:${q}:${limit}`, async () => {
    try {
      // Biais géographique (Tunisie par défaut) sans exclure les autres pays.
      const bias = config.geocodeViewbox ? `&viewbox=${config.geocodeViewbox}&bounded=0` : '';
      const url = `${config.nominatimUrl}/search?format=jsonv2&addressdetails=1&limit=${limit}${bias}&accept-language=fr,ar&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const rows = await res.json();
      return rows.map((r) => ({
        label: r.display_name,
        lat: Number(r.lat),
        lng: Number(r.lon),
        area: areaFrom(r.address),
      }));
    } catch { return []; }
  });
}

export async function reverseGeocode(lat, lng) {
  const key = `r:${lat.toFixed(4)}:${lng.toFixed(4)}`;
  return cached(key, async () => {
    try {
      const url = `${config.nominatimUrl}/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lng}`;
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const r = await res.json();
      return { label: r.display_name || null, area: areaFrom(r.address) };
    } catch { return null; }
  });
}

// Zone publique lisible SANS numéro ni rue : quartier / commune / code postal.
function areaFrom(a) {
  if (!a) return null;
  const parts = [a.suburb || a.neighbourhood || a.quarter, a.city || a.town || a.village || a.municipality, a.postcode]
    .filter(Boolean);
  return parts.length ? [...new Set(parts)].join(', ') : null;
}
