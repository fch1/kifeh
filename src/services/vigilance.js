// Vigilance Météo-France — ingestion OFFICIELLE automatique (France).
// Source : API DonnéesPubliquesVigilance du portail Météo-France (clé
// METEOFRANCE_API_KEY, STRICTEMENT côté serveur, jamais journalisée).
//
// Principe : les vigilances ORANGE et ROUGE du jour deviennent des
// « informations officielles » Kifeh (autorité vérifiée « Météo-France —
// Vigilance »), par département, avec source et horodatage — texte prudent,
// jamais présenté comme un incendie actif ni comme une consigne inventée.
// Jaune/vert : jamais publiés (pas de bruit).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSetting, setSetting, getSettingNum } from '../db.js';
import { uuid, sha256 } from './crypto.js';
import { broadcast } from '../routes/events.js';
import { audit } from './audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Centres des départements (référentiel france-geojson, embarqué — hors ligne).
const DEPTS = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/departements-fr.json'), 'utf8'));

const BASE = () => process.env.VIGILANCE_URL || 'https://public-api.meteofrance.fr';
const KEY = () => process.env.METEOFRANCE_API_KEY || '';

// Phénomènes officiels de la vigilance (identifiants stables Météo-France).
const PHENOMENA = {
  1: { fr: 'vent violent', ar: 'رياح عنيفة' },
  2: { fr: 'pluie-inondation', ar: 'أمطار وفيضانات' },
  3: { fr: 'orages', ar: 'عواصف رعدية' },
  4: { fr: 'crues', ar: 'فيضان أنهار' },
  5: { fr: 'neige-verglas', ar: 'ثلوج وجليد' },
  6: { fr: 'canicule', ar: 'موجة حر' },
  7: { fr: 'grand froid', ar: 'برد قارس' },
  8: { fr: 'avalanches', ar: 'انهيارات ثلجية' },
  9: { fr: 'vagues-submersion', ar: 'أمواج وغمر ساحلي' },
};

const AUTHORITY_ID = 'mf_vigilance';

// Autorité « Météo-France — Vigilance » : enregistrée automatiquement dans la
// liste blanche au premier import (source nationale vérifiée).
function ensureAuthority() {
  db.prepare(`INSERT OR IGNORE INTO official_authorities
      (id, country_code, name, authority_type, official_domain, coverage_level,
       source_url, retrieval_method, verified_at)
      VALUES (?, 'FR', 'Météo-France — Vigilance', 'autre_autorite', 'meteofrance.fr',
              'departement', 'https://vigilance.meteofrance.fr', 'api',
              strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).run(AUTHORITY_ID);
}

function colorName(colorId, lang = 'fr') {
  if (colorId >= 4) return lang === 'ar' ? 'حمراء' : 'rouge';
  return lang === 'ar' ? 'برتقالية' : 'orange';
}

let syncRunning = false;

export async function syncVigilance({ force = false } = {}) {
  if (!KEY()) return { skipped: 'no_key' };
  if (getSetting('vigilance_enabled') === '0') return { skipped: 'disabled' };
  if (getSetting('country_fr_enabled') === '0') return { skipped: 'fr_disabled' };
  if (syncRunning) return { skipped: 'already_running' };
  const intervalMs = (getSettingNum('vigilance_sync_interval_min') || 60) * 60_000;
  const last = getSetting('vigilance_last_sync_at');
  if (!force && last && Date.now() - Date.parse(last) < intervalMs) return { skipped: 'too_soon' };

  syncRunning = true;
  setSetting('vigilance_last_sync_at', new Date().toISOString());
  try {
    const res = await fetch(`${BASE()}/public/DPVigilance/v1/cartevigilance/encours`, {
      headers: { apikey: KEY() }, signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`vigilance HTTP ${res.status}`);
    const product = (await res.json()).product;
    // Échéance « J » : la situation en cours (J1 = préventif, non publié ici).
    const today = (product.periods || []).find((p) => p.echeance === 'J');
    if (!today) throw new Error('période J absente du bulletin');

    ensureAuthority();
    const endValidity = today.end_validity_time || null;
    let published = 0, archived = 0;

    const current = new Map(); // dept → update courant en base
    for (const u of db.prepare(
      `SELECT * FROM official_updates WHERE authority_id = ? AND status = 'current'`).all(AUTHORITY_ID)) {
      if (u.affected_dept_codes) current.set(u.affected_dept_codes, u);
    }

    const warmDepts = new Set();
    for (const dom of today.timelaps?.domain_ids || []) {
      const code = String(dom.domain_id);
      const dept = DEPTS[code];
      if (!dept || (dom.max_color_id || 1) < 3) continue; // départements métropole, orange/rouge uniquement
      warmDepts.add(code);
      const phen = (dom.phenomenon_items || [])
        .filter((p) => (p.phenomenon_max_color_id || 1) >= 3)
        .map((p) => PHENOMENA[p.phenomenon_id])
        .filter(Boolean);
      const phenFr = phen.map((p) => p.fr).join(', ') || 'phénomène météorologique';
      const phenAr = phen.map((p) => p.ar).join('، ') || 'ظاهرة جوية';
      const color = dom.max_color_id;
      const hash = sha256(`vigilance|${code}|${color}|${phenFr}|${endValidity}`);
      const existing = current.get(code);
      if (existing && existing.source_hash === hash) continue; // inchangé

      const id = uuid();
      db.prepare(`INSERT INTO official_updates
          (id, country_code, authority_id, source_url, source_title,
           summary_fr, summary_ar, info_type, severity, affected_dept_codes,
           centroid_lat, centroid_lng, radius_km, valid_until, published_at,
           updated_at_source, source_hash, supersedes_id)
          VALUES (?, 'FR', ?, 'https://vigilance.meteofrance.fr', ?, ?, ?,
                  'safety_instruction', ?, ?, ?, ?, 70, ?, ?, ?, ?, ?)`)
        .run(id, AUTHORITY_ID,
          `Vigilance ${colorName(color)} — ${dept.nom}`,
          `Vigilance ${colorName(color)} (${phenFr}) en cours pour le département ${dept.nom}. `
          + `Consultez le bulletin officiel et suivez les consignes des autorités.`,
          `تحذير رسمي بدرجة ${colorName(color, 'ar')} (${phenAr}) سارٍ في مقاطعة ${dept.nom}. `
          + `راجع النشرة الرسمية واتبع تعليمات السلطات.`,
          color >= 4 ? 'urgent' : 'important', code,
          dept.lat, dept.lng, endValidity,
          product.update_time || new Date().toISOString(),
          product.update_time || null, hash, existing?.id || null);
      if (existing) {
        db.prepare(`UPDATE official_updates SET status = 'superseded',
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(existing.id);
      }
      published++;
    }

    // Départements revenus sous l'orange : la vigilance est levée → archivage
    // (l'historique est conservé, rien n'est supprimé).
    for (const [code, u] of current) {
      if (!warmDepts.has(code)) {
        db.prepare(`UPDATE official_updates SET status = 'archived',
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(u.id);
        archived++;
      }
    }

    setSetting('vigilance_last_success_at', new Date().toISOString());
    setSetting('vigilance_last_error', '');
    if (published || archived) {
      audit('system', 'vigilance_synced', null, { published, archived });
      broadcast('incident', { official: true, country: 'FR' });
    }
    return { published, archived };
  } catch (e) {
    // Jamais la clé dans les journaux.
    setSetting('vigilance_last_error', String(e.message).replace(KEY(), '***').slice(0, 200));
    console.error('[vigilance]', String(e.message).replace(KEY(), '***'));
    return { error: e.message };
  } finally {
    syncRunning = false;
  }
}
