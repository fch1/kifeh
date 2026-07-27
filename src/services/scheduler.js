// Tâches périodiques : rappel avant expiration, expiration automatique,
// masquage des résolus anciens, purge RGPD, purge des compteurs de rate limiting.
import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting, setSetting, getSettingNum, touchIncident } from '../db.js';
import { decrypt } from './crypto.js';
import { sendSms, sendEmail } from './notifier.js';
import { broadcast } from '../routes/events.js';
import { audit } from './audit.js';
import { pruneRateEvents } from '../middleware/rateLimit.js';
import { config, getBaseUrl } from '../config.js';
import { syncFirms } from './firms.js';
import { offsiteBackup } from './offsite.js';
import { prunePushSubscriptions } from './push.js';
import { syncVigilance } from './vigilance.js';
import { msg } from '../i18n.js';

export function startScheduler() {
  tick().catch(() => {});
  setInterval(() => tick().catch((e) => console.error('[scheduler]', e.message)), 60_000);
}

export async function tick() {
  await sendExpiryReminders();
  expireIncidents();
  purgePersonalData();
  pruneRateEvents();
  if (config.isSandbox) purgeSandboxData();
  if (!config.isSandbox) await rollingBackup();
  // NASA FIRMS : synchronisation automatique (cadence réglée par
  // firms_sync_interval_min, 15 min par défaut ; inactif sans clé API).
  if (!config.isSandbox) {
    try { await syncFirms(); } catch (e) { console.error('[firms]', e.message); }
  }
  // Sauvegarde HORS-SITE quotidienne chiffrée (inactif sans GITHUB_BACKUP_TOKEN).
  if (!config.isSandbox) {
    try { await offsiteBackup(); } catch (e) { console.error('[offsite]', e.message); }
  }
  // Vigilance Météo-France (inactif sans METEOFRANCE_API_KEY).
  if (!config.isSandbox) {
    try { await syncVigilance(); } catch (e) { console.error('[vigilance]', e.message); }
  }
  // Purge RGPD des abonnements d'alertes dormants (voir services/push.js).
  try { prunePushSubscriptions(); } catch { /* jamais bloquant */ }
}

// Sauvegardes sur le disque persistant (dossier backups/) :
// - CHAQUE MINUTE  → latest.db (écrite de façon atomique) : perte max. 60 s ;
// - chaque heure   → hourly-HH.db (24 copies tournantes) ;
// - chaque jour    → incidents-AAAA-MM-JJ.db (7 conservées).
async function rollingBackup() {
  try {
    const dir = path.join(path.dirname(config.dbPath), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date();

    // Minute : copie « dernière version » (tmp puis renommage = jamais corrompue).
    const tmp = path.join(dir, 'latest.tmp');
    await db.backup(tmp);
    fs.renameSync(tmp, path.join(dir, 'latest.db'));
    // Horodatage exposé sur /healthz : preuve vérifiable que les sauvegardes tournent.
    setSetting('last_minute_backup_at', now.toISOString());

    // Heure : une copie par heure, écrasée toutes les 24 h.
    const lastHourly = getSetting('last_hourly_backup_at');
    if (!lastHourly || Date.now() - Date.parse(lastHourly) >= 3600_000) {
      setSetting('last_hourly_backup_at', now.toISOString());
      fs.copyFileSync(path.join(dir, 'latest.db'),
        path.join(dir, `hourly-${String(now.getUTCHours()).padStart(2, '0')}.db`));
    }

    // Jour : 7 copies datées conservées.
    const lastDaily = getSetting('last_backup_at');
    if (!lastDaily || Date.now() - Date.parse(lastDaily) >= 24 * 3600_000) {
      setSetting('last_backup_at', now.toISOString());
      fs.copyFileSync(path.join(dir, 'latest.db'),
        path.join(dir, `incidents-${now.toISOString().slice(0, 10)}.db`));
      const files = fs.readdirSync(dir).filter((f) => f.startsWith('incidents-')).sort();
      for (const f of files.slice(0, -7)) fs.rmSync(path.join(dir, f), { force: true });
    }
  } catch (e) { console.error('[backup]', e.message); }
}

// Sandbox : tout est effacé au bout de 24 h — c'est un bac à sable, pas une archive.
function purgeSandboxData() {
  const cutoff = `strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours')`;
  db.exec(`
    DELETE FROM confirmations WHERE incident_id IN (SELECT id FROM incidents WHERE created_at < ${cutoff});
    DELETE FROM attachments WHERE incident_id IN (SELECT id FROM incidents WHERE created_at < ${cutoff});
    DELETE FROM verifications WHERE incident_id IN (SELECT id FROM incidents WHERE created_at < ${cutoff});
    DELETE FROM manage_tokens WHERE incident_id IN (SELECT id FROM incidents WHERE created_at < ${cutoff});
    DELETE FROM reports WHERE incident_id IN (SELECT id FROM incidents WHERE created_at < ${cutoff});
    DELETE FROM incidents WHERE created_at < ${cutoff};
    DELETE FROM reporters WHERE created_at < ${cutoff} AND id NOT IN (SELECT DISTINCT reporter_id FROM incidents WHERE reporter_id IS NOT NULL);
  `);
}

// « Cet incident est-il toujours en cours ? » N heures avant expiration.
async function sendExpiryReminders() {
  const beforeH = getSettingNum('reminder_before_expiry_h');
  const rows = db.prepare(
    `SELECT i.id, i.public_id, i.reporter_id, r.channel, r.contact_encrypted, r.lang,
            (SELECT token_hash FROM manage_tokens mt WHERE mt.incident_id = i.id AND mt.revoked = 0 LIMIT 1) AS has_token
     FROM incidents i JOIN reporters r ON r.id = i.reporter_id
     WHERE i.status = 'active' AND i.temporal_status = 'ongoing'
       AND i.reminder_sent_at IS NULL AND i.expires_at IS NOT NULL
       AND strftime('%s', i.expires_at) - strftime('%s','now') BETWEEN 0 AND ?`
  ).all(beforeH * 3600);
  for (const row of rows) {
    try {
      const contact = decrypt(row.contact_encrypted);
      const lang = row.lang || 'fr';
      const url = `${getBaseUrl()}/manage.html`;
      const text = msg(lang, 'reminder_body', { publicId: row.public_id, url });
      if (row.channel === 'sms') await sendSms(contact, text);
      else await sendEmail(contact, msg(lang, 'reminder_subject', { publicId: row.public_id }), text);
      db.prepare(`UPDATE incidents SET reminder_sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(row.id);
    } catch { /* réessaiera au prochain tick */ }
  }
}

function expireIncidents() {
  // Expiration des incidents « en cours » non confirmés.
  const expired = db.prepare(
    `SELECT id, public_id FROM incidents
     WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).all();
  for (const { id, public_id } of expired) {
    db.prepare(`UPDATE incidents SET status = 'expired',
                resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                resolution_source = 'automatic_expiration' WHERE id = ?`).run(id);
    touchIncident(id);
    audit('system', 'incident_expired', id);
    broadcast('incident', { publicId: public_id, status: 'expired' });
  }
}

// RGPD : suppression des contacts après la période de rétention ;
// anonymisation des incidents liés déjà terminés.
function purgePersonalData() {
  const due = db.prepare(
    `SELECT id FROM reporters WHERE delete_after IS NOT NULL AND delete_after < strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).all();
  for (const { id } of due) {
    db.prepare(`UPDATE reporters SET contact_encrypted = '[purgé]', contact_hash = 'purged:' || id, delete_after = NULL WHERE id = ?`).run(id);
    audit('system', 'reporter_purged', id);
  }
}

// Programmée à la résolution/expiration d'un incident.
export function schedulePurge(reporterId) {
  const days = getSettingNum('retention_days');
  db.prepare(`UPDATE reporters SET delete_after = strftime('%Y-%m-%dT%H:%M:%fZ','now', ?) WHERE id = ? AND delete_after IS NULL`)
    .run(`+${days} days`, reporterId);
}
