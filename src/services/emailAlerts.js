// Alertes de zone PAR E-MAIL — envoi via Resend (RESEND_API_KEY, strictement
// côté serveur, jamais journalisée). Mêmes règles éthiques que le Web Push :
// double consentement (e-mail de confirmation), désinscription en un clic
// dans chaque message, plafond quotidien par abonné, uniquement les incidents
// publiés dans la zone choisie — jamais de message générique « revenez ».
// Vie privée : adresse CHIFFRÉE au repos, hachée pour la déduplication ;
// centre de zone arrondi (~1 km) ; purge des abonnements jamais confirmés.
import { db, getSetting, getSettingNum } from '../db.js';
import { encrypt, decrypt, hmac, sha256, uuid, randomToken } from './crypto.js';
import { getBaseUrl } from '../config.js';
import { msg } from '../i18n.js';

const API = () => process.env.RESEND_URL || 'https://api.resend.com';
const KEY = () => process.env.RESEND_API_KEY || '';
// Tant que le domaine n'est pas vérifié chez Resend, seul l'expéditeur
// onboarding@resend.dev fonctionne (et uniquement vers l'adresse du compte).
const FROM = () => process.env.RESEND_FROM || 'Kifeh <onboarding@resend.dev>';

export function emailAlertsConfigured() { return Boolean(KEY()); }

async function sendEmailViaResend(to, subject, html) {
  const res = await fetch(`${API()}/emails`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY()}` },
    body: JSON.stringify({ from: FROM(), to: [to], subject, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`resend ${res.status} ${detail.slice(0, 120).replace(KEY(), '***')}`);
  }
  return res.json();
}

// ── Abonnement (double consentement) ─────────────────────────────────────────
export async function subscribeEmail({ email, lat, lng, radiusKm, country, types, lang }) {
  const emailHash = hmac(`emailalert:${email.toLowerCase()}`);
  const existing = db.prepare(
    `SELECT id, confirmed_at FROM email_alert_subscriptions WHERE email_hash = ?`).get(emailHash);
  const confirmToken = randomToken(24);
  const unsubToken = randomToken(24);
  if (existing) {
    // Ré-abonnement : met à jour la zone, renvoie une confirmation si besoin.
    db.prepare(`UPDATE email_alert_subscriptions SET center_lat = ?, center_lng = ?,
                radius_km = ?, country_code = ?, types = ?, lang = ?,
                confirm_token_hash = CASE WHEN confirmed_at IS NULL THEN ? ELSE confirm_token_hash END
                WHERE id = ?`)
      .run(Math.round(lat * 100) / 100, Math.round(lng * 100) / 100, radiusKm, country,
        types || '', lang, sha256(confirmToken), existing.id);
    if (existing.confirmed_at) return { status: 'already_confirmed' };
    await sendConfirmation(email, lang, confirmToken);
    return { status: 'confirmation_sent' };
  }
  db.prepare(`INSERT INTO email_alert_subscriptions
      (id, email_hash, email_encrypted, country_code, center_lat, center_lng,
       radius_km, types, lang, confirm_token_hash, unsub_token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid(), emailHash, encrypt(email), country,
      Math.round(lat * 100) / 100, Math.round(lng * 100) / 100,
      radiusKm, types || '', lang, sha256(confirmToken), unsubToken);
  await sendConfirmation(email, lang, confirmToken);
  return { status: 'confirmation_sent' };
}

async function sendConfirmation(email, lang, token) {
  const url = `${getBaseUrl()}/api/public/email-alerts/confirm?token=${encodeURIComponent(token)}`;
  await sendEmailViaResend(email,
    msg(lang, 'email_confirm_subject'),
    `<p>${msg(lang, 'email_confirm_body')}</p>
     <p><a href="${url}">${msg(lang, 'email_confirm_link')}</a></p>
     <p style="color:#777;font-size:13px">${msg(lang, 'email_ignore_note')}</p>`);
}

export function confirmEmail(token) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(String(token || ''))) return false;
  const r = db.prepare(`UPDATE email_alert_subscriptions
      SET confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), confirm_token_hash = NULL
      WHERE confirm_token_hash = ? AND confirmed_at IS NULL`).run(sha256(String(token)));
  return r.changes > 0;
}

export function unsubscribeEmail(token) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(String(token || ''))) return false;
  // Jeton stocké en clair : sa seule capacité est la désinscription.
  const r = db.prepare(`DELETE FROM email_alert_subscriptions WHERE unsub_token = ?`)
    .run(String(token));
  return r.changes > 0;
}

// ── Notification d'un incident publié dans la zone ───────────────────────────
const R = 6371, rad = (d) => (d * Math.PI) / 180;
function distanceKm(a, b, c, d) {
  const dLat = rad(c - a), dLng = rad(d - b);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export async function emailNotifyIncidentPublished(incident) {
  if (!emailAlertsConfigured()) return { sent: 0 };
  if (getSetting('email_alerts_enabled') === '0') return { sent: 0 };
  const dailyMax = getSettingNum('email_alerts_daily_max') || 5;
  const today = new Date().toISOString().slice(0, 10);
  const subs = db.prepare(
    `SELECT * FROM email_alert_subscriptions
     WHERE confirmed_at IS NOT NULL AND country_code = ?
       AND (types = '' OR types LIKE '%' || ? || '%')`)
    .all(incident.country_code || 'TN', incident.type);
  let sent = 0;
  for (const s of subs) {
    if (distanceKm(s.center_lat, s.center_lng, incident.public_lat, incident.public_lng) > s.radius_km) continue;
    // Plafond quotidien strict par abonné : jamais de boîte mail inondée.
    if (s.day === today && s.day_count >= dailyMax) continue;
    try {
      const email = decrypt(s.email_encrypted);
      const lang = s.lang === 'ar' ? 'ar' : 'fr';
      const url = `${getBaseUrl()}/?incident=${encodeURIComponent(incident.public_id)}&src=email`;
      const unsubUrl = `${getBaseUrl()}/api/public/email-alerts/unsubscribe?token=${encodeURIComponent(s.unsub_token)}`;
      await sendEmailViaResend(email,
        msg(lang, `push_title_${incident.type}`) || msg(lang, 'push_title_generic'),
        `<p><strong>${msg(lang, 'push_body', { area: incident.public_area || msg(lang, 'push_near_you') })}</strong></p>
         <p><a href="${url}">${msg(lang, 'email_view_link')}</a></p>
         <p style="color:#777;font-size:13px"><a href="${unsubUrl}">${msg(lang, 'email_unsub_note')}</a></p>`);
      db.prepare(`UPDATE email_alert_subscriptions SET last_notified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                  day = ?, day_count = CASE WHEN day = ? THEN day_count + 1 ELSE 1 END, failures = 0
                  WHERE id = ?`).run(today, today, s.id);
      sent++;
    } catch (e) {
      db.prepare(`UPDATE email_alert_subscriptions SET failures = failures + 1 WHERE id = ?`).run(s.id);
      console.error('[email-alerts]', String(e.message).replace(KEY(), '***'));
    }
  }
  // Adresses en échec répété : suppression (adresse invalide → RGPD et délivrabilité).
  db.prepare(`DELETE FROM email_alert_subscriptions WHERE failures >= 5`).run();
  return { sent };
}

// Purge des abonnements jamais confirmés après 48 h (double consentement).
export function pruneEmailSubscriptions() {
  db.prepare(`DELETE FROM email_alert_subscriptions
      WHERE confirmed_at IS NULL
        AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-48 hours')`).run();
}
