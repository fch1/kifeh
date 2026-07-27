// Géocodage et autocomplétion d'adresses, PAR PAYS, avec plusieurs fournisseurs :
// - Géoplateforme (IGN, service officiel français — remplace l'API BAN dépréciée)
//   pour la France uniquement ;
// - Nominatim (OpenStreetMap) — précis, mais quota strict et IP de
//   datacenters parfois bloquées ;
// - Photon (komoot) — repli automatique, tolérant, multilingue.
// Cache mémoire + biais géographique du pays demandé. L'utilisateur peut
// toujours pointer la carte manuellement si aucun fournisseur ne répond.
import { config } from '../config.js';
import { getProfile } from '../countries/index.js';

const cache = new Map();
const HEADERS = { 'User-Agent': 'kifeh-app/1.0 (contact: admin@kifeh.tn)' };
const TTL = 10 * 60 * 1000;

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

// Fournisseurs par nom — l'ordre vient du profil pays (geocoding.providers).
const SEARCHERS = {
  geoplateforme: searchGeoplateforme,
  nominatim: searchNominatim,
  photon: searchPhoton,
};
const REVERSERS = {
  geoplateforme: reverseGeoplateforme,
  nominatim: reverseNominatim,
  photon: reversePhoton,
};

export async function searchAddress(q, limit = 5, lang = 'fr', country = 'TN') {
  const profile = getProfile(country) || getProfile('TN');
  return cached(`s:${country}:${lang}:${q}:${limit}`, async () => {
    for (const name of profile.geocoding.providers) {
      const results = await (SEARCHERS[name] || (() => []))(q, limit, lang, profile);
      if (results.length) return results;
    }
    return [];
  });
}

export async function reverseGeocode(lat, lng, lang = 'fr', country = 'TN') {
  const profile = getProfile(country) || getProfile('TN');
  const key = `r:${country}:${lang}:${lat.toFixed(4)}:${lng.toFixed(4)}`;
  return cached(key, async () => {
    for (const name of profile.geocoding.providers) {
      const result = await (REVERSERS[name] || (() => null))(lat, lng, lang, profile);
      if (result) return result;
    }
    return null;
  });
}

// --- Géoplateforme (IGN, France) ---------------------------------------------
async function searchGeoplateforme(q, limit, _lang, _profile) {
  try {
    const url = `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=${limit}&autocomplete=1`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features || []).map((f) => {
      if (!f?.geometry?.coordinates) return null;
      const p = f.properties || {};
      const area = [p.district || null, p.city, p.postcode].filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i).join(', ') || null;
      return { label: p.label || '', lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], area };
    }).filter((r) => r && r.label);
  } catch { return []; }
}

async function reverseGeoplateforme(lat, lng, _lang, _profile) {
  try {
    const url = `https://data.geopf.fr/geocodage/reverse?lat=${lat}&lon=${lng}&limit=1`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    const f = (data.features || [])[0];
    if (!f?.properties?.label) return null;
    const p = f.properties;
    const area = [p.district || null, p.city, p.postcode].filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i).join(', ') || null;
    return { label: p.label, area };
  } catch { return null; }
}

// --- Nominatim ---------------------------------------------------------------
async function searchNominatim(q, limit, lang = 'fr', profile) {
  try {
    const viewbox = profile?.geocoding?.viewbox || config.geocodeViewbox;
    const cc = (profile?.geocoding?.countryCodes || []).join(',');
    const bias = viewbox ? `&viewbox=${viewbox}&bounded=0` : '';
    const countries = cc ? `&countrycodes=${cc}` : '';
    const accept = lang === 'ar' ? 'ar,fr' : 'fr,ar';
    const url = `${config.nominatimUrl}/search?format=jsonv2&addressdetails=1&limit=${limit}${bias}${countries}&accept-language=${accept}&q=${encodeURIComponent(q)}`;
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

async function reverseNominatim(lat, lng, lang = 'fr') {
  try {
    const accept = lang === 'ar' ? 'ar,fr' : 'fr,ar';
    const url = `${config.nominatimUrl}/reverse?format=jsonv2&addressdetails=1&accept-language=${accept}&lat=${lat}&lon=${lng}`;
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
async function searchPhoton(q, limit, _lang, profile) {
  try {
    const [lat, lon] = profile?.map?.defaultCenter || [34.2, 9.6];
    const url = `${config.photonUrl}/api/?q=${encodeURIComponent(q)}&limit=${limit}&lat=${lat}&lon=${lon}&lang=fr`;
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
