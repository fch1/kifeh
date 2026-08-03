// Configuration centralisée. Tout est surchargeable par variable d'environnement,
// et une partie est administrable à chaud via la table `settings` (voir db.js).
import crypto from 'node:crypto';
import fs from 'node:fs';

// Render (et la plupart des hébergeurs) montent le disque persistant sur
// /var/data : s'il existe, les données y vivent automatiquement — les
// déploiements ne touchent alors JAMAIS à la base ni aux fichiers.
const persistentDir = fs.existsSync('/var/data') ? '/var/data' : null;

// Render « Secret Files » : les variables saisies dans un fichier secret
// (Contents KEY=VALUE) sont montées sous /etc/secrets mais ne deviennent PAS
// des variables d'environnement. On les charge ici pour qu'elles fonctionnent
// exactement comme si elles avaient été posées dans Environment Variables.
// Les vraies variables d'environnement gardent toujours la priorité.
try {
  const secretsDir = '/etc/secrets';
  if (fs.existsSync(secretsDir)) {
    for (const f of fs.readdirSync(secretsDir)) {
      let content = '';
      try { content = fs.readFileSync(`${secretsDir}/${f}`, 'utf8'); } catch { continue; }
      if (content.length > 100_000 || !content.includes('=')) continue;
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!m) continue;
        const [, k, raw] = m;
        // BASE_URL est volontairement ignorée : la détection à l'exécution
        // donne le bon domaine public (www.kifeh.org) là où le fichier
        // contiendrait l'URL interne onrender.com.
        if (k === 'BASE_URL') continue;
        if (process.env[k] === undefined || process.env[k] === '') {
          process.env[k] = raw.replace(/^["']|["']$/g, '');
        }
      }
    }
  }
} catch { /* pas de fichier secret : rien à faire */ }

const env = process.env;

// URL publique détectée à partir des requêtes entrantes quand BASE_URL n'est
// pas définie (ex. liens de gestion corrects sans configuration manuelle).
let runtimeBaseUrl = null;
export function captureBaseUrl(req) {
  if (env.BASE_URL) return;
  try { runtimeBaseUrl = `${req.protocol}://${req.get('host')}`; } catch {}
}
export function getBaseUrl() {
  const base = env.BASE_URL || runtimeBaseUrl || `http://localhost:${env.PORT || 3000}`;
  // Processus sandbox sans BASE_URL explicite : les liens restent sous /sandbox.
  return !env.BASE_URL && env.SANDBOX === '1' ? `${base}/sandbox` : base;
}

// Google Analytics 4 : identifiant de mesure (G-XXXXXXXXXX).
// Renseigné soit ici, soit via la variable d'environnement GA_MEASUREMENT_ID.
const DEFAULT_GA_ID = 'G-B33KFSSPSG';

export const config = {
  gaId: env.GA_MEASUREMENT_ID || DEFAULT_GA_ID,
  port: Number(env.PORT || 3000),
  isDev: (env.NODE_ENV || 'development') !== 'production',
  // Sandbox : SANDBOX_ENABLED=1 sur l'instance principale monte un environnement
  // de test cloisonné sous /sandbox (base + fichiers séparés, purge auto).
  // SANDBOX=1 est posé automatiquement sur le processus enfant — ne pas le définir soi-même.
  isSandbox: env.SANDBOX === '1',
  // Activée par défaut ; SANDBOX_ENABLED=0 pour la couper.
  sandboxEnabled: env.SANDBOX_ENABLED !== '0' ,
  sandboxPort: Number(env.SANDBOX_PORT || Number(env.PORT || 3000) + 1),
  baseUrl: env.BASE_URL || `http://localhost:${env.PORT || 3000}`,

  dbPath: env.DB_PATH || (persistentDir ? `${persistentDir}/incidents.db` : 'data/incidents.db'),
  uploadsDir: env.UPLOADS_DIR || (persistentDir ? `${persistentDir}/uploads` : 'uploads'),

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

  // NASA FIRMS (détections satellitaires d'anomalies thermiques).
  // La clé reste STRICTEMENT côté serveur : jamais envoyée au navigateur,
  // jamais journalisée. Sans clé, l'intégration est simplement inactive.
  firms: {
    mapKey: env.NASA_FIRMS_MAP_KEY || '',
    // URL surchargeable pour les tests (serveur simulé) — jamais la clé.
    baseUrl: env.FIRMS_URL || 'https://firms.modaps.eosdis.nasa.gov',
  },

  adminBootstrap: {
    username: env.ADMIN_USERNAME || 'admin',
    // Mot de passe initial : généré et affiché au premier démarrage si non fourni.
    password: env.ADMIN_PASSWORD || null,
  },
};

// Valeurs par défaut des réglages administrables (table settings).
export const defaultSettings = {
  // Repère DFCI (feux français) : le CALCUL est actif par défaut (interne,
  // vérifiable via /healthz et le backfill --dry-run) ; l'AFFICHAGE public
  // reste éteint jusqu'à validation opérationnelle (docs/DFCI.md).
  dfci_enabled_fr: '1',
  // AFFICHAGE PUBLIC ACTIVÉ le 31/07/2026 sur décision explicite de Farah
  // (« active le DFCI public ») — précision « indicatif » et pédagogie de la
  // fiche inchangées (docs/DFCI.md).
  dfci_public_display_enabled: '1',
  verification_required: '1',   // 0 = publication directe sans OTP (temporaire, le temps de configurer SMS/e-mail)
  other_category_enabled: '0',        // catégorie « Autre » désactivée par défaut
  anonymize_radius_m: '250',          // rayon d'anonymisation public (100–300 m)
  otp_ttl_min: '10',
  email_link_ttl_min: '60',
  otp_max_attempts: '5',
  otp_resend_delay_s: '60',
  otp_max_resends: '5',
  active_incident_ttl_h: '24',        // expiration auto d'un incident « en cours »
  reminder_before_expiry_h: '2',      // rappel « toujours en cours ? »
  resolved_visible_h: '12',           // (historique) durée courte d'affichage des résolus
  // Historique récent visible publiquement : les incidents terminés (résolus ou
  // expirés) des N derniers jours restent consultables, clairement marqués —
  // la carte ne paraît jamais « vide » alors que des données existent.
  history_visible_days: '7',
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
  // Confirmation communautaire des incendies : seuil et distance maximale
  // (km) entre la position du confirmateur et l'incendie (si position fournie).
  fire_confirm_threshold: '3',
  fire_confirm_max_km: '20',
  // Fin d'incident signalée par la communauté : nombre de signalements
  // indépendants avant clôture automatique.
  resolution_threshold: '3',
  // NASA FIRMS — tout est réglable à chaud (admin) ou par variable d'environnement.
  firms_sync_interval_min: '15',      // fréquence de synchronisation
  firms_sources: 'VIIRS_SNPP_NRT,VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT,MODIS_NRT',
  firms_day_range: '1',               // jours d'historique demandés à l'API
  firms_cluster_radius_m: '1000',     // regroupement des détections (500–1500 m)
  firms_cluster_window_h: '12',       // fenêtre temporelle de regroupement (3–12 h)
  firms_backfill_days: '7',           // premier import : 7 jours d'historique
  firms_corroborate_km: '2',          // distance max. signalement citoyen ↔ détection
  firms_corroborate_window_h: '12',   // fenêtre temporelle de corroboration
  firms_min_public_confidence: 'nominal', // 'nominal' | 'high' — 'low' jamais publié par défaut
  firms_event_stale_h: '24',          // sans nouvelle détection → « aucune nouvelle détection »
  firms_event_archive_h: '72',        // puis archivage (historique conservé)
  // Interrupteurs de fonctionnalités (env : NASA_FIRMS_ENABLED=0, etc.) —
  // l'application fonctionne normalement quelle que soit leur valeur.
  nasa_firms_enabled: '1',
  nasa_firms_public_layer_enabled: '1',
  // Multi-pays : Tunisie (historique) + France, même base de code, données
  // strictement cloisonnées. Chaque pays se coupe indépendamment.
  multi_country_enabled: '1',
  country_tn_enabled: '1',
  country_fr_enabled: '1',
  fr_declarations_enabled: '1',       // déclarations côté France
  fr_nasa_firms_enabled: '1',         // NASA France (même clé API que la Tunisie)
  // Fond de carte : fournisseur principal + secours (bascule automatique côté
  // client sur 403/429/5xx/timeout — jamais de tuile en dur dans le code carte).
  tile_primary_url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tile_primary_attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  tile_secondary_url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
  tile_secondary_attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  tile_fail_threshold: '6',           // échecs consécutifs avant bascule
  // Fin d'incident communautaire : 'immediate' (appliquée dès confirmation,
  // réouverture possible) ou 'threshold' (seuil de signalements indépendants).
  resolution_mode: 'immediate',
  community_resolution_enabled: '1',
  // Alertes de zone (Web Push) : les détections satellite crédibles notifient
  // aussi (libellé honnête), plafonnées STRICTEMENT par abonné et par jour.
  push_satellite_enabled: '1',
  push_satellite_daily_max: '2',
  // « Situation incendie » : vent contextuel + informations officielles (FR)
  // et, côté plateforme mutualisée, API /api/fire/* par territoire — la
  // Tunisie bénéficie immédiatement des capacités génériques (FIRMS, replay,
  // signalements) ; les couches absentes portent leur raison (registre).
  fire_situation_enabled_fr: '1',
  fire_situation_enabled_tn: '1',
  // Prévisions des CONDITIONS (jamais des incendies) — éteintes par défaut,
  // activation progressive après validation UI (master prévisions PR 8).
  fire_forecast_enabled_fr: '1',
  fire_forecast_enabled_tn: '1',
  // Refonte PR 2 : composition desktop — ÉTEINTE le 31/07 au soir (retour
  // Farah : « revert, le front est dégueulasse ») ; itération sur maquettes
  // validées AVANT toute réactivation.
  fire_desktop_rail_enabled: '0',
  // Chantier #103 : moteur MapLibre du mode feux — ÉTEINT par défaut (opt-in
  // explicite '1'). Ne remplace l'affichage qu'après captures validées par
  // Farah (règle du plan : maquette → OK → code → captures → drapeau → mesure).
  fire_maplibre_enabled: '0',
  // Replay visible (#110, master PR 5) : « Voir l'évolution 72 h » en mode
  // feux — ACTIF par défaut (exécution visible demandée), coupure à chaud.
  fire_replay_enabled: '1',
  // Chantier #82 : moyens aériens ADS-B — ingestion serveur livrée, ÉTEINTE
  // par territoire tant que l'interface calques (Phase 1) ne l'accueille pas.
  fire_aircraft_enabled_fr: '0',
  fire_aircraft_enabled_tn: '0',
  // Vent : modèle Météo-France (AROME/ARPEGE) servi par Open-Meteo — libre,
  // sans clé. Fournisseur configurable (WIND_URL pour les tests/alternatives).
  wind_provider: 'arome_france_hd_openmeteo', // AROME France HD, EXPLICITE (jamais le mode auto),
  wind_cache_min: '15',                 // cadence réelle du modèle : inutile plus souvent
  wind_stale_min: '90',                 // au-delà : « données plus assez récentes »
  // Contexte « sous le vent » — calcul CONSERVATEUR, jamais une prévision :
  downwind_angle_deg: '45',             // demi-angle du cône sous le vent
  downwind_max_km: '30',                // au-delà : hors de portée du contexte
  // Vigilance Météo-France (officielle) : orange/rouge du jour, par département.
  // Inactive sans METEOFRANCE_API_KEY (Secret File Render).
  vigilance_enabled: '1',
  vigilance_sync_interval_min: '60',
  // « Mon statut de sécurité » : check-in personnel temporaire (feux et
  // situations dangereuses). Drapeaux par pays, expiration en heures.
  safety_checkin_enabled: '1',
  safety_checkin_tn_enabled: '1',
  safety_checkin_fr_enabled: '1',
  safety_safe_expiry_h: '6',            // « Je suis en sécurité »
  safety_left_expiry_h: '12',           // « J'ai quitté la zone »
  safety_share_expiry_h: '48',          // durée de vie du lien partagé
  // Alertes de zone par e-mail (Resend) — inactives sans RESEND_API_KEY.
  email_alerts_enabled: '1',
  email_alerts_daily_max: '5',          // plafond STRICT par abonné et par jour
};

function devSecret(label) {
  // Secret stable par machine en développement uniquement (jamais utilisé si env fourni).
  return crypto.createHash('sha256').update(`dev-only-${label}-${process.cwd()}`).digest('hex');
}
