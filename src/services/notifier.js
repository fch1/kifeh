// Adaptateur d'envoi SMS / e-mail.
// Pilotes : 'dev' (console + outbox consultable en développement), 'twilio', 'smtp'.
// Le passage en production ne demande que des variables d'environnement.
import { config } from '../config.js';

// Boîte d'envoi de développement : consultable via /api/dev/outbox (mode dev uniquement).
export const devOutbox = [];

function pushDev(entry) {
  devOutbox.push({ ...entry, at: new Date().toISOString() });
  if (devOutbox.length > 200) devOutbox.shift();
  console.log(`[notifier:dev] ${entry.kind} → ${mask(entry.to)} : ${entry.text || entry.subject}`);
}

function mask(contact) {
  const s = String(contact);
  if (s.includes('@')) { const [u, d] = s.split('@'); return `${u.slice(0, 2)}***@${d}`; }
  return `${s.slice(0, 4)}****${s.slice(-2)}`;
}

export async function sendSms(to, text) {
  if (config.notifier === 'twilio' && config.twilio.sid) {
    const auth = Buffer.from(`${config.twilio.sid}:${config.twilio.token}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: config.twilio.from, Body: text }),
    });
    if (!res.ok) throw new Error(`Twilio: ${res.status}`);
    return;
  }
  pushDev({ kind: 'sms', to, text });
}

export async function sendEmail(to, subject, text, html = null) {
  if (config.notifier === 'smtp' && config.smtp.host) {
    // Brancher ici nodemailer (non inclus dans le MVP pour rester léger) :
    // const t = nodemailer.createTransport(config.smtp); await t.sendMail({...});
    throw new Error('Pilote SMTP : installer nodemailer et compléter notifier.js');
  }
  pushDev({ kind: 'email', to, subject, text, html });
}
