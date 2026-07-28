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
// Domaine kifeh.app vérifié chez Resend : expéditeur officiel par défaut
// (surchargeable via RESEND_FROM si besoin).
const FROM = () => process.env.RESEND_FROM || 'Kifeh <alertes@kifeh.app>';

// ── Gabarit de marque (navy #1E2A4D, crème #FAF7F1, action #E8432E) ─────────
// Un e-mail Kifeh se lit en 3 secondes : quoi + où dans le titre, UN bouton,
// un pied honnête (désinscription + rappel « initiative citoyenne »).
// Styles en ligne uniquement (clients mail) ; RTL complet pour l'arabe.
function emailTemplate({ lang, heading, bodyHtml, ctaLabel, ctaUrl, footHtml }) {
  const rtl = lang === 'ar';
  return `<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}" lang="${lang}"><body style="margin:0;padding:0;background:#FAF7F1">
  <div dir="${rtl ? 'rtl' : 'ltr'}" style="background:#FAF7F1;padding:28px 12px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #eee6d9">
      <div style="background:#1E2A4D;padding:16px 22px">
        <span style="color:#ffffff;font-weight:700;font-size:19px">Kifeh</span>
        <span style="color:#ffffff;opacity:.85;font-size:17px"> كيفاه</span>
      </div>
      <div style="padding:22px">
        <h2 style="margin:0 0 10px;color:#1E2A4D;font-size:19px;line-height:1.35">${heading}</h2>
        <div style="color:#333;font-size:15px;line-height:1.55">${bodyHtml}</div>
        ${ctaUrl ? `<p style="margin:22px 0 6px"><a href="${ctaUrl}"
          style="background:#E8432E;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:700;font-size:15px;display:inline-block">${ctaLabel}</a></p>` : ''}
      </div>
      <div style="padding:14px 22px;background:#FAF7F1;color:#8a8578;font-size:12px;line-height:1.5">
        ${footHtml || ''}
        <div style="margin-top:6px"><a href="https://kifeh.app" style="color:#8a8578">kifeh.app</a></div>
      </div>
    </div>
  </div></body></html>`;
}

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
    emailTemplate({
      lang,
      heading: msg(lang, 'email_confirm_subject'),
      bodyHtml: `<p style="margin:0">${msg(lang, 'email_confirm_body')}</p>`,
      ctaLabel: msg(lang, 'email_confirm_link'),
      ctaUrl: url,
      footHtml: msg(lang, 'email_ignore_note'),
    }));
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
      const title = msg(lang, `push_title_${incident.type}`) || msg(lang, 'push_title_generic');
      const area = incident.public_area || msg(lang, 'push_near_you');
      await sendEmailViaResend(email,
        `${title} — ${area}`, // objet = quoi + où, lisible sans ouvrir
        emailTemplate({
          lang,
          heading: title,
          bodyHtml: `<p style="margin:0 0 6px"><strong>📍 ${area}</strong></p>
            <p style="margin:0">${msg(lang, 'email_alert_body')}</p>`,
          ctaLabel: msg(lang, 'email_view_link'),
          ctaUrl: url,
          footHtml: `${msg(lang, 'email_footer_notice')}<br>
            <a href="${unsubUrl}" style="color:#8a8578">${msg(lang, 'email_unsub_note')}</a>`,
        }));
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
