// Primitives cryptographiques : chiffrement des contacts au repos, hachages,
// jetons aléatoires. Aucune donnée personnelle ne circule en clair hors requête.
import crypto from 'node:crypto';
import { config } from '../config.js';

const encKey = crypto.createHash('sha256').update(config.encryptionKey).digest();

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decrypt(blob) {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// HMAC pour rechercher un contact (limites anti-abus, suspension) sans le déchiffrer.
export function hmac(value) {
  return crypto.createHmac('sha256', config.hmacKey).update(String(value)).digest('hex');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function otpCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function uuid() { return crypto.randomUUID(); }

export function publicId() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans caractères ambigus
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return `INC-${s}`;
}

export function scryptHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function scryptVerify(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

// Signature de valeurs de cookie (sessions admin).
export function sign(value) {
  const sig = crypto.createHmac('sha256', config.cookieKey).update(value).digest('base64url');
  return `${value}.${sig}`;
}

export function unsign(signed) {
  const idx = String(signed).lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const expect = sign(value);
  const a = Buffer.from(signed), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}
