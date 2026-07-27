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
    webpush.setVapidDetails('mailto:chabchoub.farah@gmail.com', pub, priv);
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
      const payload = JSON.stringify({
        title: msg(lang, `push_title_${incident.type}`) || msg(lang, 'push_title_generic'),
        body: msg(lang, 'push_body', { area: incident.public_area || msg(lang, 'push_near_you') }),
        url: `${getBaseUrl()}/?incident=${encodeURIComponent(incident.public_id)}`,
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
