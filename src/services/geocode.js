// Géocodage et autocomplétion d'adresses, avec DEUX fournisseurs :
// 1. Nominatim (OpenStreetMap) — précis, mais quota strict et IP de
//    datacenters parfois bloquées ;
// 2. Photon (komoot) — repli automatique, tolérant, multilingue.
// Cache mémoire + biais Tunisie. L'utilisateur peut toujours pointer la carte
// manuellement si aucun fournisseur ne répond.
import { config } from '../config.js';

const cache = new Map();
const HEADERS = { 'User-Agent': 'kifeh-app/1.0 (contact: admin@kifeh.tn)' };
const TTL = 10 * 60 * 1000;
// Centre de biais (Tunisie) pour Photon.
const BIAS = { lat: 34.2, lon: 9.6 };

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
    const nominatim = await searchNominatim(q, limit);
    if (nominatim.length) return nominatim;
    return searchPhoton(q, limit);
  });
}

export async function reverseGeocode(lat, lng) {
  const key = `r:${lat.toFixed(4)}:${lng.toFixed(4)}`;
  return cached(key, async () => {
    const nominatim = await reverseNominatim(lat, lng);
    if (nominatim) return nominatim;
    return reversePhoton(lat, lng);
  });
}

// --- Nominatim ---------------------------------------------------------------
async function searchNominatim(q, limit) {
  try {
    const bias = config.geocodeViewbox ? `&viewbox=${config.geocodeViewbox}&bounded=0` : '';
    const url = `${config.nominatimUrl}/search?format=jsonv2&addressdetails=1&limit=${limit}${bias}&accept-language=fr,ar&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map((r) => ({
      label: r.display_name,
      lat: Number(r.lat), lng: Number(r.lon),
      area: areaFrom(r.address),
    }));
  } catch { return []; }
}

async function reverseNominatim(lat, lng) {
  try {
    const url = `${config.nominatimUrl}/reverse?format=jsonv2&addressdetails=1&accept-language=fr,ar&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const r = await res.json();
    if (!r.display_name) return null;
    return { label: r.display_name, area: areaFrom(r.address) };
  } catch { return null; }
}

// Zone publique lisible SANS numéro ni rue : quartier / commune / code postal.
function areaFrom(a) {
  if (!a) return null;
  const parts = [a.suburb || a.neighbourhood || a.quarter, a.city || a.town || a.village || a.municipality, a.postcode]
    .filter(Boolean);
  return parts.length ? [...new Set(parts)].join(', ') : null;
}

// --- Photon (repli) ----------------------------------------------------------
async function searchPhoton(q, limit) {
  try {
    const url = `${config.photonUrl}/api/?q=${encodeURIComponent(q)}&limit=${limit}&lat=${BIAS.lat}&lon=${BIAS.lon}&lang=fr`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features || []).map(photonToResult).filter(Boolean);
  } catch { return []; }
}

async function reversePhoton(lat, lng) {
  try {
    const url = `${config.photonUrl}/reverse?lat=${lat}&lon=${lng}&lang=fr`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const r = photonToResult((data.features || [])[0]);
    return r ? { label: r.label, area: r.area } : null;
  } catch { return null; }
}

function photonToResult(f) {
  if (!f?.geometry?.coordinates) return null;
  const p = f.properties || {};
  const label = [p.name, p.street, p.district, p.city, p.state, p.postcode, p.country]
    .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  if (!label) return null;
  const area = [p.district, p.city || p.state, p.postcode].filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i).join(', ') || null;
  return { label, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], area };
}
