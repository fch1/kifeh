// TOTP (RFC 6238) en Node pur — aucune dépendance : double authentification
// facultative du compte d'administration, compatible avec toutes les
// applications standard (Google Authenticator, Aegis, FreeOTP…).
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20) {
  const raw = crypto.randomBytes(bytes);
  let bits = 0, value = 0, out = '';
  for (const byte of raw) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of String(s).toUpperCase().replace(/=+$/, '')) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totpCode(secretBase32, timeMs = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(timeMs / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16)
    | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

// Vérification avec fenêtre ±1 pas (30 s) : tolère les horloges décalées.
export function verifyTotp(secretBase32, code, timeMs = Date.now()) {
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) return false;
  for (const w of [-1, 0, 1]) {
    const candidate = totpCode(secretBase32, timeMs + w * 30_000);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(c))) return true;
  }
  return false;
}

// URL d'enrôlement standard (à saisir ou coller dans l'application TOTP).
export function otpauthUrl(secretBase32, account = 'admin', issuer = 'Kifeh') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
    + `?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}
