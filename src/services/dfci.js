// Repère DFCI — carreau de 2 km du carroyage national utilisé par les
// sapeurs-pompiers. Calcul 100 % LOCAL (base de référence lecture seule,
// jamais d'appel réseau pendant une déclaration) ; le code est TOUJOURS
// calculé par le serveur depuis la position EXACTE (jamais public_lat/lng,
// jamais une valeur envoyée par le navigateur).
//
// Le repère est INDICATIF : il complète l'adresse et le GPS quand on parle
// aux secours — il ne remplace ni le 18/112 ni les consignes officielles.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { getSetting } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REF_PATH = () => process.env.DFCI_REFERENCE_PATH
  || path.join(__dirname, '../../data/reference/dfci-france.sqlite');

// Drapeaux : calcul (dfci_enabled_fr) et AFFICHAGE public (déploiement
// progressif : calculer d'abord, contrôler, n'afficher qu'ensuite).
export const dfciEnabled = () =>
  process.env.DFCI_ENABLED_FR === '1' || getSetting('dfci_enabled_fr') === '1';
export const dfciPublicDisplay = () =>
  process.env.DFCI_PUBLIC_DISPLAY_ENABLED === '1' || getSetting('dfci_public_display_enabled') === '1';

let ref = null, refTried = false, refVersion = null;
function refDb() {
  if (ref || refTried) return ref;
  refTried = true;
  try {
    if (!fs.existsSync(REF_PATH())) return null;
    ref = new Database(REF_PATH(), { readonly: true, fileMustExist: true });
    refVersion = ref.prepare(`SELECT value FROM metadata WHERE key = 'source_updated_at'`).get()?.value || null;
  } catch (e) {
    // Journal SANS coordonnées ni chemin complet — de simples indicateurs.
    console.error('[dfci] référence illisible :', String(e?.message || '').slice(0, 80));
    ref = null;
  }
  return ref;
}
export function dfciReferenceLoaded() { return Boolean(refDb()); }
export function dfciReferenceVersion() { refDb(); return refVersion; }

// Métriques internes (mémoire) — exposées à l'admin, jamais au public.
export const dfciMetrics = {
  total: 0, success: 0, noMatch: 0, error: 0, ambiguous: 0, lastMs: 0,
};

// Point dans quadrilatère (ray casting) — les carreaux sont de petits
// quadrilatères convexes ; géométrie en [lat, lng].
function pointInQuad(lat, lng, quad) {
  let inside = false;
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const [yi, xi] = quad[i], [yj, xj] = quad[j];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function lookupDfci({ lat, lng, countryCode, incidentType, gpsAccuracy = null }) {
  dfciMetrics.total++;
  const t0 = process.hrtime.bigint();
  const done = (r) => {
    dfciMetrics.lastMs = Number(process.hrtime.bigint() - t0) / 1e6;
    return r;
  };
  if (countryCode !== 'FR' || incidentType !== 'fire' || !dfciEnabled()) {
    return done({ available: false, code: null, reason: 'not_applicable' });
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 40 || lat > 52 || lng < -6 || lng > 11) {
    return done({ available: false, code: null, reason: 'invalid_coordinates' });
  }
  const db = refDb();
  if (!db) {
    dfciMetrics.error++;
    return done({ available: false, code: null, reason: 'reference_unavailable' });
  }
  try {
    const candidates = db.prepare(
      `SELECT c.code, c.geometry_json, c.min_lat, c.max_lat, c.min_lng, c.max_lng
       FROM dfci_cells_rtree r JOIN dfci_cells c ON c.id = r.id
       WHERE r.min_lng <= ? AND r.max_lng >= ? AND r.min_lat <= ? AND r.max_lat >= ?`
    ).all(lng, lng, lat, lat);
    const matches = candidates.filter((cell) => pointInQuad(lat, lng, JSON.parse(cell.geometry_json)));
    if (!matches.length) {
      dfciMetrics.noMatch++;
      return done({ available: false, code: null, reason: 'outside_coverage' });
    }
    // Frontière de carreaux : centroïde le plus proche, puis ordre alphabétique.
    let selected = matches[0];
    if (matches.length > 1) {
      dfciMetrics.ambiguous++;
      const d2 = (cell) => {
        const cy = (cell.min_lat + cell.max_lat) / 2, cx = (cell.min_lng + cell.max_lng) / 2;
        return (cy - lat) ** 2 + (cx - lng) ** 2;
      };
      selected = [...matches].sort((a, b) => d2(a) - d2(b) || a.code.localeCompare(b.code))[0];
    }
    dfciMetrics.success++;
    return done({
      available: true,
      code: selected.code,
      precision: '2km',
      ambiguous: matches.length > 1,
      lowAccuracy: Number.isFinite(gpsAccuracy) && gpsAccuracy > 500,
      sourceVersion: refVersion,
      computedAt: new Date().toISOString(),
    });
  } catch {
    dfciMetrics.error++;
    // Jamais de coordonnées dans les journaux.
    console.error('[dfci] lookup failed', 'country=FR', 'incidentType=fire', 'reason=lookup_failed');
    return done({ available: false, code: null, reason: 'lookup_failed' });
  }
}

// Calcule et enregistre le repère d'un incident (colonnes additives) — le
// signalement CONTINUE même si le calcul échoue (jamais bloquant).
export function applyDfciToIncident(db, incidentId, { lat, lng, countryCode, incidentType, gpsAccuracy }) {
  try {
    const r = lookupDfci({ lat, lng, countryCode, incidentType, gpsAccuracy });
    db.prepare(`UPDATE incidents SET dfci_code = ?, dfci_precision = ?,
                dfci_source_version = ?, dfci_computed_at = ?, dfci_ambiguous = ?
                WHERE id = ?`)
      .run(r.available ? r.code : null, r.available ? r.precision : null,
        r.available ? r.sourceVersion : null, r.available ? r.computedAt : null,
        r.available && r.ambiguous ? 1 : 0, incidentId);
    return r;
  } catch { return { available: false, code: null, reason: 'lookup_failed' }; }
}
