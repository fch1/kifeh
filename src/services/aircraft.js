// Moyens aériens observés (ADS-B, airplanes.live) — chantier #82.
// DERRIÈRE DRAPEAU par territoire (`fire_aircraft_enabled_{cc}`, ÉTEINT par
// défaut) : aucun appel réseau tant qu'aucun territoire n'est activé.
//
// Licence VÉRIFIÉE le 31/07 : usage non commercial autorisé (Kifeh est
// gratuit, open source, sans publicité), 1 requête/seconde maximum, sans clé.
// Politesse assumée : User-Agent identifiable, mutualisation SERVEUR (jamais
// un appel par visiteur), sondage UNIQUEMENT autour des zones de feu ACTIVES
// (3 zones max par pays), 90 s minimum entre deux passes, 1,2 s entre deux
// requêtes, repli 5 min après échec.
//
// Honnêteté (charte) : des aéronefs OBSERVÉS par transpondeur — jamais une
// confirmation d'intervention, jamais leur mission, jamais une classification
// « bombardier d'eau » inventée. Filtre : basse altitude (< 15 000 ft) et en
// vol — le trafic de croisière n'apporte que du bruit.
import { db, getSetting, setSetting } from '../db.js';
import { enabledCountries } from '../countries/index.js';

const BASE = () => process.env.AIRCRAFT_URL || 'https://api.airplanes.live';
const RADIUS_NM = 25;          // rayon de sondage par zone active
const MAX_ZONES = 3;           // par pays — jamais une tempête de requêtes
const PASS_MIN_MS = 90_000;    // 90 s minimum entre deux passes complètes
const SPACING_MS = 1200;       // > 1 s entre requêtes (limite du fournisseur)
const FAIL_BACKOFF_MS = 5 * 60_000;
const MAX_ALT_FT = 15_000;     // au-delà : croisière, hors sujet feu
const KEEP_MS = 10 * 60_000;   // une zone sans rafraîchissement s'efface

const state = {
  zones: new Map(),  // key `${cc}:${lat}:${lng}` → { cc, lat, lng, aircraft, fetchedAt }
  lastPassAt: 0,
  failUntil: 0,
};

export const aircraftFlag = (cc) => getSetting(`fire_aircraft_enabled_${cc.toLowerCase()}`) === '1';

// Zones de feu ACTIVES d'un pays : signalements citoyens feu + concentrations
// de détections satellite récentes (6 h), dédupliquées (~30 km), 3 max.
export function activeFireZones(cc) {
  const zones = [];
  try {
    for (const r of db.prepare(
      `SELECT public_lat AS lat, public_lng AS lng FROM incidents
       WHERE status='active' AND type='fire' AND COALESCE(country_code,'TN')=?
       ORDER BY started_at DESC LIMIT 3`
    ).all(cc)) zones.push({ lat: r.lat, lng: r.lng });
    for (const r of db.prepare(
      `SELECT ROUND(lat*2)/2 AS lat, ROUND(lng*2)/2 AS lng, COUNT(*) AS n
       FROM satellite_detections
       WHERE country_code=? AND acquired_at > datetime('now','-6 hours')
       GROUP BY 1,2 ORDER BY n DESC LIMIT 3`
    ).all(cc)) zones.push({ lat: r.lat, lng: r.lng });
  } catch { /* base indisponible : aucune zone */ }
  const kept = [];
  for (const z of zones) {
    if (!Number.isFinite(z.lat) || !Number.isFinite(z.lng)) continue;
    if (kept.some((k) => Math.abs(k.lat - z.lat) < 0.3 && Math.abs(k.lng - z.lng) < 0.3)) continue;
    kept.push(z);
    if (kept.length >= MAX_ZONES) break;
  }
  return kept;
}

async function pollZone(cc, z) {
  const url = `${BASE()}/v2/point/${z.lat.toFixed(3)}/${z.lng.toFixed(3)}/${RADIUS_NM}`;
  const r = await fetch(url, {
    // ASCII STRICT : une valeur d'en-tête HTTP avec accent ou tiret cadratin
    // fait jeter fetch AVANT la requête (bug trouvé par la sonde du 03/08).
    headers: { 'User-Agent': 'Kifeh/1.0 (+https://kifeh.app; civic open source platform)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  const now = Date.now();
  const aircraft = (Array.isArray(data.ac) ? data.ac : [])
    .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
    .filter((a) => a.alt_baro !== 'ground' && (!Number.isFinite(a.alt_baro) || a.alt_baro < MAX_ALT_FT))
    .slice(0, 40)
    .map((a) => ({
      hex: String(a.hex || ''),
      callsign: String(a.flight || '').trim() || null,
      type: String(a.t || '') || null,       // code constructeur BRUT — jamais interprété
      lat: a.lat, lng: a.lon,
      altFt: Number.isFinite(a.alt_baro) ? Math.round(a.alt_baro) : null,
      speedKt: Number.isFinite(a.gs) ? Math.round(a.gs) : null,
      track: Number.isFinite(a.track) ? Math.round(a.track) : null,
      seenAgoS: Number.isFinite(a.seen) ? Math.round(a.seen) : null,
    }));
  state.zones.set(`${cc}:${z.lat.toFixed(2)}:${z.lng.toFixed(2)}`, {
    cc, lat: z.lat, lng: z.lng, aircraft, fetchedAt: new Date(now).toISOString(),
  });
}

// Appelé par le scheduler (tick 60 s) : ne fait RIEN drapeaux éteints.
export async function syncAircraft() {
  const now = Date.now();
  if (now < state.failUntil || now - state.lastPassAt < PASS_MIN_MS) return;
  const active = enabledCountries().filter((cc) => aircraftFlag(cc));
  if (!active.length) return;
  state.lastPassAt = now;
  let any = false, failed = false;
  for (const cc of active) {
    for (const z of activeFireZones(cc)) {
      try {
        await pollZone(cc, z);
        any = true;
      } catch { failed = true; }
      await new Promise((r) => setTimeout(r, SPACING_MS));
    }
  }
  // Purge des zones qui ne sont plus rafraîchies (feu éteint, drapeau coupé).
  for (const [k, v] of state.zones) {
    if (now - Date.parse(v.fetchedAt) > KEEP_MS) state.zones.delete(k);
  }
  if (any) setSetting('aircraft_last_success_at', new Date().toISOString());
  if (failed && !any) state.failUntil = now + FAIL_BACKOFF_MS; // panne franche : repli
}

// Lecture pour l'API : aéronefs connus dans une emprise, dédupliqués par hex.
export function aircraftInBbox(cc, b) {
  const seen = new Map();
  let latest = null;
  for (const zone of state.zones.values()) {
    if (zone.cc !== cc) continue;
    if (!latest || zone.fetchedAt > latest) latest = zone.fetchedAt;
    for (const a of zone.aircraft) {
      if (a.lat < b.minLat || a.lat > b.maxLat || a.lng < b.minLng || a.lng > b.maxLng) continue;
      const prev = seen.get(a.hex);
      if (!prev || (a.seenAgoS ?? 999) < (prev.seenAgoS ?? 999)) seen.set(a.hex, a);
    }
  }
  return { aircraft: [...seen.values()], fetchedAt: latest };
}

export function aircraftStatus() {
  return {
    zonesTracked: state.zones.size,
    lastSuccess: getSetting('aircraft_last_success_at') || null,
  };
}

// Sonde de test : réinitialise l'état interne (jamais utilisée en production).
export function _resetAircraftForTests() {
  state.zones.clear(); state.lastPassAt = 0; state.failUntil = 0;
}
