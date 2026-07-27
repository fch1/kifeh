// Sauvegarde HORS-SITE quotidienne : copie chiffrée de la base envoyée dans un
// dépôt GitHub privé (gratuit, versionné, hors de l'hébergeur applicatif).
// Un incident côté hébergeur ne peut plus rien détruire d'irrécupérable.
//
// Activation (2 minutes, aucune intégration payante) :
//   1. GitHub → Settings → Developer settings → Fine-grained token, limité au
//      dépôt privé (ex. fch1/Kifeh-private), permission « Contents: write » ;
//   2. Render → Secret File : GITHUB_BACKUP_TOKEN=... et, si besoin,
//      GITHUB_BACKUP_REPO=fch1/Kifeh-private (valeur par défaut).
// Sans jeton, le mécanisme reste simplement inactif.
//
// Chiffrement : AES-256-GCM avec la clé SECRET_ENCRYPTION_KEY existante —
// le dépôt de sauvegarde ne contient JAMAIS de données lisibles.
// Rotation : un fichier par jour de semaine (7 fichiers), l'historique git
// conserve les versions antérieures.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, getSetting, setSetting } from '../db.js';
import { config } from '../config.js';
import { audit } from './audit.js';

const REPO = () => process.env.GITHUB_BACKUP_REPO || 'fch1/Kifeh-private';
const TOKEN = () => process.env.GITHUB_BACKUP_TOKEN || '';

function encryptBuffer(buf) {
  const key = crypto.createHash('sha256').update(config.encryptionKey).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]); // iv(12) | tag(16) | données
}

// Restauration (documentée ici pour ne jamais la chercher en urgence) :
//   node -e "…decryptBuffer(fs.readFileSync('incidents-lundi.db.enc'))…"
export function decryptBuffer(buf) {
  const key = crypto.createHash('sha256').update(config.encryptionKey).digest();
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export async function offsiteBackup({ force = false } = {}) {
  if (!TOKEN()) return { skipped: 'no_token' };
  const last = getSetting('offsite_backup_at');
  if (!force && last && Date.now() - Date.parse(last) < 24 * 3600_000) return { skipped: 'too_soon' };

  // Instantané cohérent de la base (better-sqlite3 backup API), puis chiffrement.
  const tmp = `${config.dbPath}.offsite-tmp`;
  try {
    await db.backup(tmp);
    const payload = encryptBuffer(fs.readFileSync(tmp));
    const day = JOURS[new Date().getUTCDay()];
    const path = `backups/incidents-${day}.db.enc`;
    const api = `https://api.github.com/repos/${REPO()}/contents/${path}`;
    const headers = {
      Authorization: `Bearer ${TOKEN()}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'kifeh-offsite-backup',
      'Content-Type': 'application/json',
    };
    // SHA du fichier existant (requis par l'API pour une mise à jour).
    let sha;
    const head = await fetch(api, { headers, signal: AbortSignal.timeout(20_000) });
    if (head.ok) sha = (await head.json()).sha;
    const res = await fetch(api, {
      method: 'PUT', headers, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        message: `Sauvegarde chiffrée automatique (${day})`,
        content: payload.toString('base64'),
        ...(sha ? { sha } : {}),
      }),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    setSetting('offsite_backup_at', new Date().toISOString());
    setSetting('offsite_backup_error', '');
    audit('system', 'offsite_backup_done', null, { path, bytes: payload.length });
    return { ok: true, path, bytes: payload.length };
  } catch (e) {
    setSetting('offsite_backup_error', String(e.message).slice(0, 200));
    console.error('[offsite-backup]', e.message);
    return { error: e.message };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
