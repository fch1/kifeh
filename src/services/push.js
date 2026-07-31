// Notifications Web Push « M'alerter dans cette zone » — 100 % gratuit et
// open source : le protocole Web Push (VAPID) est servi par les navigateurs
// eux-mêmes, sans AUCUN service tiers ni intégration payante.
//
// Vie privée : on ne stocke qu'un point de zone ARRONDI (~1 km), un rayon,
// le pays et la langue — jamais d'identité, jamais de position précise.
// Les clés VAPID sont générées automatiquement au premier démarrage et
// conservées dans la base (disque persistant) : zéro configuration.
import webpush from 'web-push';
import { db, getSetting, setSetting } from '../db.js';
import { uuid } from './crypto.js';
import { msg } from '../i18n.js';
import { getBaseUrl } from '../config.js';
import { emergencyLine } from './localizationFormatter.js';

let configured = false;

// Clés VAPID auto-générées et persistées (la clé privée ne quitte jamais la base).
export function ensureVapid() {
  let pub = getSetting('vapid_public_key');
  let priv = getSetting('vapid_private_key');
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey; priv = keys.privateKey;
    setSetting('vapid_public_key', pub);
    setSetting('vapid_private_key', priv);
  }
  if (!configured) {
    webpush.setVapidDetails('mailto:contact@kifeh.org', pub, priv);
    configured = true;
  }
  return pub;
}

export function publicVapidKey() {
  return ensureVapid();
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Abonnements couverts par un incident : même pays, distance ≤ rayon choisi,
// type accepté. Exportée séparément pour être testable sans envoi réel.
export function subscriptionsFor(incident) {
  const rows = db.prepare(
    `SELECT * FROM push_subscriptions WHERE country_code = ? AND failures < 5`
  ).all(incident.country_code || 'TN');
  return rows.filter((s) =>
    distanceKm(s.center_lat, s.center_lng, incident.public_lat, incident.public_lng) <= s.radius_km
    && (!s.types || s.types.split(',').includes(incident.type)));
}

// Abonnés couverts par un ÉVÉNEMENT SATELLITE : même pays, distance ≤ rayon,
// et intérêt incendie (tous types, ou « fire » explicitement coché).
export function subscriptionsForSatellite(ev) {
  const rows = db.prepare(
    `SELECT * FROM push_subscriptions WHERE country_code = ? AND failures < 5`
  ).all(ev.country_code || 'TN');
  return rows.filter((s) =>
    distanceKm(s.center_lat, s.center_lng, ev.centroid_lat, ev.centroid_lng) <= s.radius_km
    && (!s.types || s.types.split(',').includes('fire')));
}

// Notification pour une NOUVELLE détection satellite regroupée (confiance
// nominal/high uniquement). Libellé honnête — « détection satellite », jamais
// « incendie confirmé » — et plafond STRICT par abonné (2/jour par défaut,
// réglable) : l'alerte reste un signal, jamais du spam.
export async function notifySatelliteEvent(ev) {
  if (process.env.WEB_PUSH_DISABLED === '1') return { sent: 0 };
  if (getSetting('push_satellite_enabled') === '0') return { sent: 0 };
  if (!['nominal', 'high'].includes(ev.max_confidence)) return { sent: 0 };
  const dailyMax = Number(getSetting('push_satellite_daily_max') || 2);
  const today = new Date().toISOString().slice(0, 10);
  let sent = 0;
  try {
    ensureVapid();
    for (const s of subscriptionsForSatellite(ev)) {
      const count = s.sat_day === today ? s.sat_count : 0;
      if (count >= dailyMax) continue; // plafond quotidien atteint
      const lang = s.lang === 'ar' ? 'ar' : 'fr';
      const payload = JSON.stringify({
        title: msg(lang, 'push_sat_title'),
        body: msg(lang, 'push_sat_body'),
        url: `${getBaseUrl()}/?satellite=${encodeURIComponent(ev.id)}&src=push&utm_source=kifeh_alert&utm_medium=push&utm_campaign=zone_alert`,
        tag: `kifeh-sat-${ev.id}`,
      });
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload, { TTL: 3600 });
        db.prepare(`UPDATE push_subscriptions SET sat_day = ?, sat_count = ?,
                    last_notified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), failures = 0
                    WHERE id = ?`).run(today, count + 1, s.id);
        sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).run(s.id);
        } else {
          db.prepare(`UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?`).run(s.id);
        }
      }
    }
  } catch (e) {
    console.error('[push-sat]', e.message);
  }
  return { sent };
}

// Purge RGPD des abonnements dormants : jamais notifiés depuis 6 mois, en
// échec durable depuis 30 jours, ou sans notification depuis 12 mois.
// Notification de TEST : la personne vérifie que la livraison fonctionne
// vraiment (beaucoup d'utilisateurs ne comprennent pas les permissions
// navigateur). Uniquement vers SA propre inscription (endpoint connu du
// client seul), libellé explicite, jamais un faux incendie.
export async function sendTestPush(endpoint, lang = 'fr') {
  ensureVapid();
  const s = db.prepare(`SELECT * FROM push_subscriptions WHERE endpoint = ?`).get(String(endpoint || ''));
  if (!s) return { ok: false, notFound: true };
  const payload = JSON.stringify({
    title: msg(lang, 'push_test_title'),
    body: msg(lang, 'push_test_body'),
    url: `${getBaseUrl()}/?src=push-test`,
    tag: 'kifeh-test',
  });
  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      payload, { TTL: 600 });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function prunePushSubscriptions() {
  return db.prepare(`DELETE FROM push_subscriptions WHERE
      (last_notified_at IS NULL AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-180 days'))
   OR (failures >= 5 AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days'))
   OR (last_notified_at IS NOT NULL AND last_notified_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-365 days'))`)
    .run().changes;
}

// Envoie la notification « nouvel incident dans votre zone » aux abonnés
// concernés. Jamais bloquant pour la publication (erreurs avalées, journal
// technique seulement) ; les abonnements morts (410/404) sont supprimés.
export async function notifyIncidentPublished(incident) {
  if (process.env.WEB_PUSH_DISABLED === '1') return { sent: 0 };
  let sent = 0;
  try {
    ensureVapid();
    const subs = subscriptionsFor(incident);
    for (const s of subs) {
      const lang = s.lang === 'ar' ? 'ar' : 'fr';
      // Numéro d'urgence du PAYS DE LA ZONE suivie (jamais le 18 pour Tunis) —
      // ajouté au corps pour les incendies, où chaque seconde compte.
      const zoneCountry = s.country_code || incident.country_code || 'TN';
      const emg = incident.type === 'fire' ? emergencyLine(zoneCountry, lang, 'fire') : null;
      const payload = JSON.stringify({
        title: msg(lang, `push_title_${incident.type}`) || msg(lang, 'push_title_generic'),
        body: msg(lang, 'push_body', { area: incident.public_area || msg(lang, 'push_near_you') })
          + (emg ? `\n${emg}` : ''),
        url: `${getBaseUrl()}/?incident=${encodeURIComponent(incident.public_id)}&src=push&utm_source=kifeh_alert&utm_medium=push&utm_campaign=zone_alert`, // src=push : boucle de retour
        tag: `kifeh-${incident.public_id}`, // regroupe les doublons côté OS
      });
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload, { TTL: 3600 });
        db.prepare(`UPDATE push_subscriptions SET last_notified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                    failures = 0 WHERE id = ?`).run(s.id);
        sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).run(s.id); // abonnement expiré
        } else {
          db.prepare(`UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?`).run(s.id);
        }
      }
    }
  } catch (e) {
    console.error('[push]', e.message);
  }
  return { sent };
}
