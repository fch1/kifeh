// Configuration centralisée. Tout est surchargeable par variable d'environnement,
// et une partie est administrable à chaud via la table `settings` (voir db.js).
import crypto from 'node:crypto';

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  isDev: (env.NODE_ENV || 'development') !== 'production',
  baseUrl: env.BASE_URL || `http://localhost:${env.PORT || 3000}`,

  dbPath: env.DB_PATH || 'data/incidents.db',
  uploadsDir: env.UPLOADS_DIR || 'uploads',

  // Secrets — en production, définir impérativement ces variables d'environnement.
  encryptionKey: env.SECRET_ENCRYPTION_KEY || devSecret('enc'),
  hmacKey: env.SECRET_HMAC_KEY || devSecret('hmac'),
  cookieKey: env.SECRET_COOKIE_KEY || devSecret('cookie'),

  // Pilote d'envoi : 'dev' (console + outbox), 'twilio', 'smtp'
  notifier: env.NOTIFIER_DRIVER || 'dev',
  twilio: { sid: env.TWILIO_SID, token: env.TWILIO_TOKEN, from: env.TWILIO_FROM },
  smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM },

  // Géocodage (Nominatim / OpenStreetMap). Respecter la politique d'usage en production.
  nominatimUrl: env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
  // Viewbox de biais du géocodage (lon1,lat1,lon2,lat2) — Tunisie par défaut.
  geocodeViewbox: env.GEOCODE_VIEWBOX ?? '7.5,37.6,11.6,30.2',
  // Géocodeur de repli (utilisé si Nominatim ne répond pas ou ne trouve rien).
  photonUrl: env.PHOTON_URL || 'https://photon.komoot.io',

  adminBootstrap: {
    username: env.ADMIN_USERNAME || 'admin',
    // Mot de passe initial : généré et affiché au premier démarrage si non fourni.
    password: env.ADMIN_PASSWORD || null,
  },
};

// Valeurs par défaut des réglages administrables (table settings).
export const defaultSettings = {
  other_category_enabled: '0',        // catégorie « Autre » désactivée par défaut
  anonymize_radius_m: '250',          // rayon d'anonymisation public (100–300 m)
  otp_ttl_min: '10',
  email_link_ttl_min: '60',
  otp_max_attempts: '5',
  otp_resend_delay_s: '60',
  otp_max_resends: '5',
  active_incident_ttl_h: '24',        // expiration auto d'un incident « en cours »
  reminder_before_expiry_h: '2',      // rappel « toujours en cours ? »
  resolved_visible_h: '12',           // durée d'affichage des incidents résolus
  max_declarations_per_ip_per_h: '10',
  max_declarations_per_contact_per_day: '5',
  max_confirms_per_ip_per_h: '10',
  max_otp_sends_per_ip_per_h: '30',
  min_form_fill_s: '8',               // délai minimal réaliste de remplissage
  retention_days: '90',               // purge RGPD des contacts après résolution
  trust_publish_threshold: '40',      // sous ce score → validation manuelle
  dedup_radius_m: '500',
  dedup_window_h: '6',
  manage_link_ttl_days: '30',
};

function devSecret(label) {
  // Secret stable par machine en développement uniquement (jamais utilisé si env fourni).
  return crypto.createHash('sha256').update(`dev-only-${label}-${process.cwd()}`).digest('hex');
}
