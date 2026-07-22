// Pièces jointes : validation stricte, stockage privé, et production d'une
// version publique NETTOYÉE DE TOUTES LES MÉTADONNÉES (EXIF, GPS…) via sharp.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { db } from '../db.js';
import { uuid } from './crypto.js';
import { config } from '../config.js';

const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' };
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const privateDir = path.join(config.uploadsDir, 'private');
const publicDir = path.join(config.uploadsDir, 'public');
fs.mkdirSync(privateDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

// Vérifie la signature binaire (magic bytes) — ne pas se fier au MIME déclaré.
function sniff(buffer) {
  const b = buffer;
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (b.length > 12 && b.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  return null;
}

export async function storeAttachment(incidentId, buffer) {
  const mime = sniff(buffer);
  if (!mime || !ALLOWED[mime]) throw Object.assign(new Error('file_format'), { key: 'file_format' });
  if (buffer.length > MAX_UPLOAD_BYTES) throw Object.assign(new Error('file_too_big'), { key: 'file_too_big' });

  const id = uuid();
  const ext = ALLOWED[mime];
  const originalPath = path.join(privateDir, `${id}.${ext}`);
  fs.writeFileSync(originalPath, buffer);

  // Version publique nettoyée : ré-encodage complet → aucune métadonnée conservée.
  let cleanPath = null;
  if (mime.startsWith('image/')) {
    cleanPath = path.join(publicDir, `${id}.jpg`);
    await sharp(buffer).rotate() // applique l'orientation EXIF puis la supprime
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })     // sans .withMetadata() → EXIF/GPS retirés
      .toFile(cleanPath);
  }
  // Les vidéos restent privées dans le MVP (nettoyage de métadonnées vidéo = ffmpeg, hors périmètre).

  db.prepare(`INSERT INTO attachments(id, incident_id, mime, original_path, clean_path)
              VALUES (?, ?, ?, ?, ?)`).run(id, incidentId, mime, originalPath, cleanPath);
  return { id, mime, hasCleanVersion: Boolean(cleanPath) };
}
