// Adaptateur d'envoi SMS / e-mail.
// Pilotes : 'dev' (aucun envoi réel : les messages vont dans la boîte d'envoi
// interne, consultable par un administrateur), 'twilio' (SMS réels),
// 'smtp' (e-mails réels via nodemailer — SMS toujours en boîte interne
// tant que Twilio n'est pas configuré).
import { config } from '../config.js';

// Boîte d'envoi interne : en dev via /api/dev/outbox, en production via
// l'onglet « Envois » de l'administration (accès journalisé).
export const devOutbox = [];

function pushOutbox(entry) {
  devOutbox.push({ ...entry, at: new Date().toISOString() });
  if (devOutbox.length > 200) devOutbox.shift();
  console.log(`[notifier:${config.notifier}] ${entry.kind} → ${mask(entry.to)} : ${entry.text || entry.subject}`);
}

function mask(contact) {
  const s = String(contact);
  if (s.includes('@')) { const [u, d] = s.split('@'); return `${u.slice(0, 2)}***@${d}`; }
  return `${s.slice(0, 4)}****${s.slice(-2)}`;
}

// --- SMS ---------------------------------------------------------------------
export async function sendSms(to, text) {
  if (config.twilio.sid && config.twilio.token && config.twilio.from) {
    const auth = Buffer.from(`${config.twilio.sid}:${config.twilio.token}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: config.twilio.from, Body: text }),
    });
    if (!res.ok) {
      console.error(`[notifier:twilio] échec ${res.status}`);
      throw new Error(`Twilio: ${res.status}`);
    }
    return;
  }
  // Pas de fournisseur SMS configuré → boîte d'envoi interne.
  pushOutbox({ kind: 'sms', to, text });
}

// --- E-mail ------------------------------------------------------------------
let transporter = null;
async function getTransporter() {
  if (transporter) return transporter;
  const nodemailer = await import('nodemailer');
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: Number(config.smtp.port || 587),
    secure: Number(config.smtp.port) === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transporter;
}

export async function sendEmail(to, subject, text, html = null) {
  if (config.smtp.host) {
    try {
      const t = await getTransporter();
      await t.sendMail({
        from: config.smtp.from || config.smtp.user,
        to, subject, text, html: html || undefined,
      });
      return;
    } catch (e) {
      console.error('[notifier:smtp] échec :', e.message);
      throw e;
    }
  }
  // Pas de serveur SMTP configuré → boîte d'envoi interne.
  pushOutbox({ kind: 'email', to, subject, text, html });
}
