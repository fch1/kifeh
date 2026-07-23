// Vérification obligatoire du déclarant : OTP SMS 6 chiffres, code e-mail,
// ou lien e-mail signé à usage unique. Codes et jetons stockés HACHÉS.
// Tous les contenus envoyés sont localisés (fr / ar) selon la langue du déclarant.
import { db, getSettingNum } from '../db.js';
import { sha256, otpCode, randomToken, uuid } from './crypto.js';
import { sendSms, sendEmail } from './notifier.js';
import { audit } from './audit.js';
import { config, getBaseUrl } from '../config.js';
import { msg } from '../i18n.js';

const nowIso = () => new Date().toISOString();
const plusMin = (m) => new Date(Date.now() + m * 60_000).toISOString();

// Crée et envoie une vérification. channel : 'sms' | 'email_code' | 'email_link'
export async function createVerification(reporter, incident, channel, contactPlain, lang = 'fr') {
  const id = uuid();
  let codePlain, ttlMin;
  if (channel === 'sms' || channel === 'email_code') {
    codePlain = otpCode();
    ttlMin = getSettingNum('otp_ttl_min');
  } else {
    codePlain = randomToken(32);
    ttlMin = getSettingNum('email_link_ttl_min');
  }
  db.prepare(`INSERT INTO verifications(id, reporter_id, incident_id, channel, code_hash, expires_at, last_sent_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, reporter.id, incident?.id || null, channel, sha256(codePlain), plusMin(ttlMin), nowIso());

  await deliver(channel, contactPlain, codePlain, id, ttlMin, lang);
  return { verificationId: id, channel };
}

async function deliver(channel, contact, codePlain, verificationId, ttlMin, lang) {
  if (channel === 'sms') {
    await sendSms(contact, msg(lang, 'sms_otp', { code: codePlain, ttl: ttlMin }));
  } else if (channel === 'email_code') {
    await sendEmail(contact, msg(lang, 'email_otp_subject'),
      msg(lang, 'email_otp_body', { code: codePlain, ttl: ttlMin }));
  } else {
    const link = `${getBaseUrl()}/verify.html?vid=${verificationId}&t=${codePlain}&lang=${lang}`;
    await sendEmail(contact, msg(lang, 'email_link_subject'),
      msg(lang, 'email_link_body', { link, ttl: ttlMin }),
      msg(lang, 'email_link_html', { link, ttl: ttlMin }));
  }
}

// Renvoi d'un code : délai minimal entre deux envois + plafond.
export async function resend(verificationId, contactPlain, lang = 'fr') {
  const v = db.prepare(`SELECT * FROM verifications WHERE id = ?`).get(verificationId);
  // Un code expiré peut être renvoyé (SMS non reçu, délai dépassé) ; un code
  // déjà utilisé ou bloqué, non.
  if (!v || !['pending', 'expired'].includes(v.status)) {
    return { error: msg(lang, 'verif_finished') };
  }
  const delayS = getSettingNum('otp_resend_delay_s');
  if (v.last_sent_at && Date.now() - Date.parse(v.last_sent_at) < delayS * 1000) {
    return { error: msg(lang, 'wait_before_resend') };
  }
  if (v.resend_count >= getSettingNum('otp_max_resends')) {
    db.prepare(`UPDATE verifications SET status = 'blocked' WHERE id = ?`).run(verificationId);
    audit('system', 'otp_blocked_resends', verificationId);
    return { error: msg(lang, 'max_resends') };
  }
  // Nouveau code, nouvelle expiration.
  const isLink = v.channel === 'email_link';
  const codePlain = isLink ? randomToken(32) : otpCode();
  const ttlMin = getSettingNum(isLink ? 'email_link_ttl_min' : 'otp_ttl_min');
  db.prepare(`UPDATE verifications SET code_hash = ?, expires_at = ?, resend_count = resend_count + 1,
              attempts = 0, last_sent_at = ?, status = 'pending' WHERE id = ?`)
    .run(sha256(codePlain), plusMin(ttlMin), nowIso(), verificationId);
  await deliver(v.channel, contactPlain, codePlain, verificationId, ttlMin, lang);
  return { ok: true };
}

// Vérifie un code OTP / code e-mail / jeton de lien. Usage unique.
export function verifyCode(verificationId, codePlain, lang = 'fr') {
  const v = db.prepare(`SELECT * FROM verifications WHERE id = ?`).get(verificationId);
  if (!v) return { error: msg(lang, 'verif_not_found') };
  if (v.status === 'used' || v.status === 'verified') return { error: msg(lang, 'code_already_used') };
  if (v.status === 'blocked') return { error: msg(lang, 'code_blocked') };
  if (Date.parse(v.expires_at) < Date.now()) {
    db.prepare(`UPDATE verifications SET status = 'expired' WHERE id = ?`).run(v.id);
    return { error: msg(lang, 'code_expired'), expired: true };
  }
  const maxAttempts = getSettingNum('otp_max_attempts');
  if (v.attempts >= maxAttempts) {
    db.prepare(`UPDATE verifications SET status = 'blocked' WHERE id = ?`).run(v.id);
    audit('system', 'otp_blocked_attempts', v.id);
    return { error: msg(lang, 'too_many_attempts') };
  }
  if (sha256(String(codePlain)) !== v.code_hash) {
    db.prepare(`UPDATE verifications SET attempts = attempts + 1 WHERE id = ?`).run(v.id);
    const left = maxAttempts - v.attempts - 1;
    return {
      error: left > 0 ? msg(lang, 'code_incorrect_left', { left }) : msg(lang, 'code_incorrect_blocked'),
      incorrect: true, attemptsLeft: left,
    };
  }
  db.prepare(`UPDATE verifications SET status = 'used', validated_at = ? WHERE id = ?`).run(nowIso(), v.id);
  db.prepare(`UPDATE reporters SET verified = 1, verified_at = ? WHERE id = ?`).run(nowIso(), v.reporter_id);
  return { ok: true, reporterId: v.reporter_id, incidentId: v.incident_id };
}
