// Base SQLite : schéma, migrations légères, réglages, amorçage admin.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config, defaultSettings } from './config.js';
import { scryptHash, randomToken, uuid } from './services/crypto.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  public_id TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('electricity','water','fire','internet','other')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft','pending_verification','verified','active','possible_duplicate',
     'pending_review','resolved','expired','rejected','deleted')),
  severity TEXT NOT NULL DEFAULT 'moderate' CHECK (severity IN ('low','moderate','high','immediate_danger')),
  description TEXT NOT NULL DEFAULT '',
  comment TEXT,
  affected_count INTEGER,
  temporal_status TEXT NOT NULL DEFAULT 'ongoing' CHECK (temporal_status IN ('ongoing','finished','planned')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  time_approximate INTEGER NOT NULL DEFAULT 0,
  lat REAL NOT NULL,             -- exact, privé
  lng REAL NOT NULL,             -- exact, privé
  public_lat REAL NOT NULL,      -- anonymisé, publiable
  public_lng REAL NOT NULL,      -- anonymisé, publiable
  address TEXT,                  -- exact, privé
  public_area TEXT,              -- zone lisible publiable
  location_source TEXT NOT NULL DEFAULT 'manual',
  gps_accuracy REAL,
  reporter_id TEXT REFERENCES reporters(id),
  trust_score INTEGER NOT NULL DEFAULT 0,
  confirmations_count INTEGER NOT NULL DEFAULT 0,
  duplicate_of TEXT REFERENCES incidents(id),
  expires_at TEXT,
  reminder_sent_at TEXT,
  hidden_description INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_incidents_map ON incidents(status, public_lat, public_lng);
CREATE INDEX IF NOT EXISTS idx_incidents_search ON incidents(type, status, started_at);
CREATE INDEX IF NOT EXISTS idx_incidents_expiry ON incidents(expires_at);
CREATE INDEX IF NOT EXISTS idx_incidents_reporter ON incidents(reporter_id);

CREATE TABLE IF NOT EXISTS reporters (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('sms','email')),
  contact_encrypted TEXT NOT NULL,
  contact_hash TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  consent_given_at TEXT NOT NULL,
  abuse_strikes INTEGER NOT NULL DEFAULT 0,
  blocked_until TEXT,
  delete_after TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_reporters_hash ON reporters(contact_hash);

CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES reporters(id),
  incident_id TEXT REFERENCES incidents(id),
  channel TEXT NOT NULL CHECK (channel IN ('sms','email_code','email_link')),
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  resend_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','expired','blocked','used')),
  validated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS manage_tokens (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_manage_tokens ON manage_tokens(token_hash);

CREATE TABLE IF NOT EXISTS confirmations (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  contact_hash TEXT NOT NULL,
  approx_lat REAL, approx_lng REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(incident_id, contact_hash)
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  mime TEXT NOT NULL,
  original_path TEXT NOT NULL,
  clean_path TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','approved','rejected')),
  public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','moderator','operator','analyst')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  csrf TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS rate_events (
  bucket TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_rate ON rate_events(bucket, key_hash, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id),
  reason TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','handled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// --- Migrations légères -----------------------------------------------------
// 1. Bases créées avant l'ajout du type 'internet' : reconstruction de la table
//    incidents avec la nouvelle contrainte CHECK.
const incidentsSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='incidents'`).get()?.sql || '';
if (incidentsSql && !incidentsSql.includes("'internet'")) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`ALTER TABLE incidents RENAME TO incidents_old`);
    db.exec(incidentsSql.replace('CREATE TABLE incidents', 'CREATE TABLE incidents')
      .replace(`'electricity','water','fire','other'`, `'electricity','water','fire','internet','other'`));
    const cols = db.prepare(`PRAGMA table_info(incidents)`).all().map((c) => c.name).join(', ');
    db.exec(`INSERT INTO incidents (${cols}) SELECT ${cols} FROM incidents_old`);
    db.exec(`DROP TABLE incidents_old`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_incidents_map ON incidents(status, public_lat, public_lng);
             CREATE INDEX IF NOT EXISTS idx_incidents_search ON incidents(type, status, started_at);
             CREATE INDEX IF NOT EXISTS idx_incidents_expiry ON incidents(expires_at);
             CREATE INDEX IF NOT EXISTS idx_incidents_reporter ON incidents(reporter_id);`);
  })();
  db.pragma('foreign_keys = ON');
}
// 2. Langue préférée du déclarant (envois SMS/e-mail dans sa langue).
const reporterCols = db.prepare(`PRAGMA table_info(reporters)`).all().map((c) => c.name);
if (!reporterCols.includes('lang')) {
  db.exec(`ALTER TABLE reporters ADD COLUMN lang TEXT NOT NULL DEFAULT 'fr'`);
}

// 3. Migrations additives (juillet 2026) — AUCUNE donnée existante n'est
//    modifiée ni supprimée : uniquement des colonnes et tables nouvelles,
//    idempotentes (IF NOT EXISTS / vérification de colonne), dans une
//    transaction. Retour arrière : ces ajouts sont ignorés par l'ancien code.
db.transaction(() => {
  // 3a. Date de publication (filtre « période ») — les incidents existants
  //     reçoivent leur date de création comme valeur initiale.
  const incidentCols = db.prepare(`PRAGMA table_info(incidents)`).all().map((c) => c.name);
  if (!incidentCols.includes('published_at')) {
    db.exec(`ALTER TABLE incidents ADD COLUMN published_at TEXT`);
    db.exec(`UPDATE incidents SET published_at = created_at
             WHERE published_at IS NULL AND status IN ('active','resolved','expired')`);
  }

  // 3b-bis. Métadonnées de résolution (qui a clôturé, comment, quand) et
  //         détection satellite : colonnes additives sur les tables existantes.
  const incCols2 = db.prepare(`PRAGMA table_info(incidents)`).all().map((c) => c.name);
  if (!incCols2.includes('resolved_at')) {
    db.exec(`ALTER TABLE incidents ADD COLUMN resolved_at TEXT`);
    db.exec(`ALTER TABLE incidents ADD COLUMN resolution_source TEXT`);
    db.exec(`ALTER TABLE incidents ADD COLUMN resolved_by TEXT`);
  }
  const resCols = db.prepare(`PRAGMA table_info(resolution_reports)`).all().map((c) => c.name);
  if (resCols.length && !resCols.includes('is_now')) {
    db.exec(`ALTER TABLE resolution_reports ADD COLUMN is_now INTEGER NOT NULL DEFAULT 0`);
  }
  // « C'est toujours en cours » : fraîcheur communautaire d'un incident actif.
  if (!incCols2.includes('still_active_at')) {
    db.exec(`ALTER TABLE incidents ADD COLUMN still_active_at TEXT`);
  }

  // 3b. Type et statut des confirmations (« affected », « fire_seen »…).
  const confCols = db.prepare(`PRAGMA table_info(confirmations)`).all().map((c) => c.name);
  if (!confCols.includes('confirmation_type')) {
    db.exec(`ALTER TABLE confirmations ADD COLUMN confirmation_type TEXT NOT NULL DEFAULT 'affected'`);
    db.exec(`ALTER TABLE confirmations ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified'`);
    db.exec(`ALTER TABLE confirmations ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
  }

  // 3c. Signalements de fin d'incident par la communauté.
  db.exec(`
    CREATE TABLE IF NOT EXISTS resolution_reports (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL REFERENCES incidents(id),
      contributor_hash TEXT NOT NULL,
      proposed_ended_at TEXT,
      is_now INTEGER NOT NULL DEFAULT 0,
      comment TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','dismissed')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(incident_id, contributor_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_resolution_incident ON resolution_reports(incident_id, status);
  `);

  // 3d. Corrections de localisation (historique complet, jamais de doublon d'incident).
  db.exec(`
    CREATE TABLE IF NOT EXISTS location_corrections (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL REFERENCES incidents(id),
      prev_lat REAL NOT NULL, prev_lng REAL NOT NULL,
      new_lat REAL NOT NULL, new_lng REAL NOT NULL,
      prev_address TEXT, new_address TEXT,
      submitted_by TEXT NOT NULL CHECK (submitted_by IN ('reporter','public','admin')),
      contributor_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','rejected')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_corrections_incident ON location_corrections(incident_id, status);
  `);

  // 3e. Annuaire de contacts tunisiens vérifiés (source unique : jamais de
  //     numéro en dur dispersé dans le frontend). Modifiable via l'admin.
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name_fr TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      phone_display TEXT NOT NULL,
      phone_tel TEXT NOT NULL,
      incident_types TEXT NOT NULL,       -- csv : fire,electricity,water,internet,other
      coverage TEXT NOT NULL DEFAULT 'national',
      region TEXT,
      note_fr TEXT, note_ar TEXT,
      source_name TEXT, source_url TEXT,
      verified_at TEXT, verified_by TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 100,
      country_code TEXT NOT NULL DEFAULT 'TN',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  // Amorçage (INSERT OR IGNORE : les modifications faites via l'admin priment).
  const seedContact = db.prepare(`INSERT OR IGNORE INTO contacts
    (id, name_fr, name_ar, phone_display, phone_tel, incident_types, coverage,
     source_name, source_url, verified_at, verified_by, is_active, priority)
    VALUES (@id, @fr, @ar, @disp, @tel, @types, 'national', @src, @url, @vat, 'seed', 1, @prio)`);
  const VAT = '2026-07-23T00:00:00.000Z';
  const SRC = 'Ministère de l’Intérieur (services.interieur.gov.tn)';
  const SRCURL = 'https://services.interieur.gov.tn/wap/fr/';
  for (const c of [
    { id: 'protection_civile', fr: 'Protection civile / Pompiers', ar: 'الحماية المدنية', disp: '198', tel: '198', types: 'fire,water,electricity', prio: 1, src: SRC, url: SRCURL, vat: VAT },
    { id: 'samu', fr: 'SAMU', ar: 'الإسعاف الطبي الاستعجالي', disp: '190', tel: '190', types: 'fire', prio: 2, src: SRC, url: SRCURL, vat: VAT },
    { id: 'police_secours', fr: 'Police secours', ar: 'شرطة النجدة', disp: '197', tel: '197', types: 'fire', prio: 3, src: SRC, url: SRCURL, vat: VAT },
    { id: 'garde_nationale', fr: 'Garde nationale', ar: 'الحرس الوطني', disp: '193', tel: '193', types: 'fire', prio: 4, src: SRC, url: SRCURL, vat: VAT },
    { id: 'steg_urgence', fr: 'Urgences STEG', ar: 'مصلحة الطوارئ — الشركة التونسية للكهرباء والغاز', disp: '80 100 444', tel: '80100444', types: 'electricity', prio: 1, src: 'STEG (steg.com.tn)', url: 'https://www.steg.com.tn', vat: VAT },
    { id: 'steg_contact', fr: 'STEG — services clients', ar: 'الشركة التونسية للكهرباء والغاز', disp: '71 239 222', tel: '+21671239222', types: 'electricity', prio: 2, src: 'STEG (steg.com.tn)', url: 'https://www.steg.com.tn', vat: VAT },
    { id: 'sonede_urgence', fr: 'SONEDE — numéro vert', ar: 'الشركة الوطنية لاستغلال وتوزيع المياه — الرقم الأخضر', disp: '80 100 319', tel: '80100319', types: 'water', prio: 1, src: 'SONEDE (sonede.com.tn)', url: 'https://www.sonede.com.tn', vat: VAT },
    { id: 'sonede_contact', fr: 'SONEDE — contact général', ar: 'الشركة الوطنية لاستغلال وتوزيع المياه', disp: '71 887 000', tel: '+21671887000', types: 'water', prio: 2, src: 'SONEDE (sonede.com.tn)', url: 'https://www.sonede.com.tn', vat: VAT },
  ]) seedContact.run(c);

  // Annuaire FRANCE — numéros d'urgence nationaux vérifiés uniquement.
  // Pas de numéro « inventé » : pour l'électricité/l'eau/internet en France,
  // l'écran oriente vers le gestionnaire indiqué sur la facture (le numéro
  // Enedis dépend du département et du gestionnaire réel de la commune).
  // Migration additive AVANT la graine : les bases déjà déployées n'ont pas
  // encore la colonne country_code (CREATE IF NOT EXISTS ne l'ajoute pas).
  const contactCols2 = db.prepare(`PRAGMA table_info(contacts)`).all().map((c) => c.name);
  if (contactCols2.length && !contactCols2.includes('country_code')) {
    db.exec(`ALTER TABLE contacts ADD COLUMN country_code TEXT NOT NULL DEFAULT 'TN'`);
  }
  {
    const seedFr = db.prepare(`INSERT OR IGNORE INTO contacts
      (id, name_fr, name_ar, phone_display, phone_tel, incident_types, coverage,
       source_name, source_url, verified_at, verified_by, is_active, priority, country_code)
      VALUES (@id, @fr, @ar, @disp, @tel, @types, 'national', @src, @url, @vat, 'seed', 1, @prio, 'FR')`);
    const SRCFR = 'Service-Public.fr — numéros d’urgence';
    const URLFR = 'https://www.service-public.fr/particuliers/vosdroits/F33954';
    const VATFR = '2026-07-27T00:00:00.000Z';
    for (const c of [
      { id: 'fr_pompiers', fr: 'Pompiers', ar: 'رجال الإطفاء', disp: '18', tel: '18', types: 'fire,water,electricity', prio: 1, src: SRCFR, url: URLFR, vat: VATFR },
      { id: 'fr_urgence_112', fr: 'Numéro d’urgence européen', ar: 'رقم الطوارئ الأوروبي', disp: '112', tel: '112', types: 'fire,water,electricity', prio: 2, src: SRCFR, url: URLFR, vat: VATFR },
      { id: 'fr_samu', fr: 'SAMU', ar: 'الإسعاف الطبي (SAMU)', disp: '15', tel: '15', types: 'fire', prio: 3, src: SRCFR, url: URLFR, vat: VATFR },
      { id: 'fr_police', fr: 'Police secours', ar: 'شرطة النجدة', disp: '17', tel: '17', types: 'fire', prio: 4, src: SRCFR, url: URLFR, vat: VATFR },
      { id: 'fr_sourds_114', fr: 'Urgences par SMS (sourds et malentendants)', ar: 'الطوارئ عبر الرسائل (للصمّ وضعاف السمع)', disp: '114', tel: 'sms:114', types: 'fire', prio: 5, src: SRCFR, url: URLFR, vat: VATFR },
    ]) seedFr.run(c);
  }

  // 3e-bis. MULTI-PAYS — colonnes additives `country_code` partout où le sens
  //         est géographique. Les enregistrements existants sont rattachés à
  //         la TUNISIE (Kifeh a historiquement opéré en Tunisie) ; les
  //         coordonnées incohérentes sont signalées en file de revue (journal
  //         d'audit) SANS suppression ni déplacement silencieux.
  const incCols3 = db.prepare(`PRAGMA table_info(incidents)`).all().map((c) => c.name);
  if (!incCols3.includes('country_code')) {
    db.exec(`ALTER TABLE incidents ADD COLUMN country_code TEXT`);
    db.exec(`ALTER TABLE incidents ADD COLUMN administrative_level_1 TEXT`);
    db.exec(`ALTER TABLE incidents ADD COLUMN administrative_level_2 TEXT`);
    db.exec(`ALTER TABLE incidents ADD COLUMN administrative_level_3 TEXT`);
    db.exec(`ALTER TABLE incidents ADD COLUMN locality TEXT`);
    db.exec(`ALTER TABLE incidents ADD COLUMN postal_code TEXT`);
    db.exec(`UPDATE incidents SET country_code = 'TN' WHERE country_code IS NULL`);
    // Revue : coordonnées hors de l'emprise tunisienne élargie → à examiner.
    const odd = db.prepare(`SELECT id, public_id, lat, lng FROM incidents
      WHERE lat NOT BETWEEN 29.5 AND 38.5 OR lng NOT BETWEEN 6.5 AND 12.5`).all();
    const auditIns = db.prepare(`INSERT INTO audit_log(actor, action, target, detail)
      VALUES ('migration', 'country_review_needed', ?, ?)`);
    for (const r of odd) auditIns.run(r.id, JSON.stringify({ publicId: r.public_id, lat: r.lat, lng: r.lng, assigned: 'TN' }));
    db.exec(`CREATE INDEX IF NOT EXISTS idx_incidents_country ON incidents(country_code, status);
             CREATE INDEX IF NOT EXISTS idx_incidents_country_type ON incidents(country_code, type, status);
             CREATE INDEX IF NOT EXISTS idx_incidents_country_map ON incidents(country_code, status, public_lat, public_lng)`);
  }

  // 3f. NASA FIRMS — détections satellitaires et événements regroupés.
  //     Tables entièrement nouvelles : aucune donnée existante touchée.
  db.exec(`
    CREATE TABLE IF NOT EXISTS satellite_detections (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'nasa_firms',
      source TEXT NOT NULL,               -- VIIRS_SNPP_NRT, MODIS_NRT…
      satellite TEXT, instrument TEXT,
      external_fingerprint TEXT UNIQUE NOT NULL, -- anti-réimport
      lat REAL NOT NULL, lng REAL NOT NULL,
      scan REAL, track REAL,
      acq_date TEXT NOT NULL, acq_time TEXT NOT NULL,
      acquired_at TEXT NOT NULL,          -- UTC normalisé
      confidence TEXT NOT NULL CHECK (confidence IN ('low','nominal','high')),
      frp REAL, brightness REAL,
      day_night TEXT, version TEXT,
      country_code TEXT NOT NULL DEFAULT 'TN',
      raw_payload TEXT,                   -- ligne brute (audit technique)
      imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      satellite_event_id TEXT REFERENCES satellite_events(id)
    );
    CREATE INDEX IF NOT EXISTS idx_satdet_event ON satellite_detections(satellite_event_id);
    CREATE INDEX IF NOT EXISTS idx_satdet_acquired ON satellite_detections(acquired_at);

    CREATE TABLE IF NOT EXISTS satellite_events (
      id TEXT PRIMARY KEY,
      centroid_lat REAL NOT NULL, centroid_lng REAL NOT NULL,
      uncertainty_radius_m INTEGER NOT NULL DEFAULT 750,
      first_detected_at TEXT NOT NULL,
      last_detected_at TEXT NOT NULL,
      max_confidence TEXT NOT NULL CHECK (max_confidence IN ('low','nominal','high')),
      max_frp REAL,
      detection_count INTEGER NOT NULL DEFAULT 0,
      satellite_count INTEGER NOT NULL DEFAULT 0,
      satellites TEXT NOT NULL DEFAULT '',       -- liste csv
      confirmations_count INTEGER NOT NULL DEFAULT 0,
      country_code TEXT NOT NULL DEFAULT 'TN',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN
        ('active','no_new_detection','archived','false_positive')),
      linked_incident_id TEXT REFERENCES incidents(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_satevents_status ON satellite_events(status, last_detected_at);
    CREATE INDEX IF NOT EXISTS idx_satevents_incident ON satellite_events(linked_incident_id);

    CREATE TABLE IF NOT EXISTS satellite_event_feedback (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES satellite_events(id),
      kind TEXT NOT NULL CHECK (kind IN ('confirm','not_fire','error')),
      contributor_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(event_id, contributor_hash, kind)
    );

    -- Sources thermiques persistantes connues (industries, torchères…) :
    -- masquées de la publication automatique pour éviter les faux incendies.
    CREATE TABLE IF NOT EXISTS thermal_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat REAL NOT NULL, lng REAL NOT NULL,
      radius_m INTEGER NOT NULL DEFAULT 1500,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);

  // 3f-bis. MULTI-PAYS sur tables satellites PRÉEXISTANTES : `CREATE TABLE IF
  //         NOT EXISTS` n'ajoute pas de colonne à une table déjà en place (la
  //         production a des détections antérieures à cette migration). Ajout
  //         additif, rattaché à la Tunisie comme le reste de l'historique.
  for (const t of ['satellite_detections', 'satellite_events']) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    if (cols.length && !cols.includes('country_code')) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN country_code TEXT NOT NULL DEFAULT 'TN'`);
    }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_satevents_country ON satellite_events(country_code, status, last_detected_at)`);
})();

// Réglages par défaut (sans écraser les valeurs administrées).
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaultSettings)) insertSetting.run(k, v);

// Bascule ponctuelle (juillet 2026) : OTP désactivé le temps de configurer un
// fournisseur SMS/e-mail. Exécutée UNE seule fois (marqueur) — réactivable à
// tout moment via Admin → Configuration ou la variable VERIFICATION_REQUIRED=1.
if (!db.prepare(`SELECT 1 FROM settings WHERE key = 'migr_otp_off_202607'`).get()) {
  db.prepare(`INSERT INTO settings(key, value) VALUES ('migr_otp_off_202607', 'done')`).run();
  db.prepare(`UPDATE settings SET value = '0' WHERE key = 'verification_required'`).run();
}

// Purge des données sur demande : incrémenter WIPE_GENERATION et déployer
// suffit à remettre la base à zéro UNE fois (admin + configuration conservés).
const WIPE_GENERATION = '2026-07-23-2';
const lastWipe = db.prepare(`SELECT value FROM settings WHERE key = 'wipe_generation'`).get()?.value;
if (!lastWipe) {
  // Première rencontre avec cette base (neuve ou héritée) : on enregistre la
  // génération SANS rien effacer — une purge n'a lieu que sur demande explicite.
  db.prepare(`INSERT INTO settings(key, value) VALUES ('wipe_generation', ?)`).run(WIPE_GENERATION);
} else if (lastWipe !== WIPE_GENERATION) {
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'wipe_generation'`).run(WIPE_GENERATION);
  db.exec(`
    DELETE FROM confirmations;
    DELETE FROM resolution_reports;
    DELETE FROM location_corrections;
    DELETE FROM satellite_event_feedback;
    DELETE FROM satellite_detections;
    DELETE FROM satellite_events;
    DELETE FROM attachments;
    DELETE FROM verifications;
    DELETE FROM manage_tokens;
    DELETE FROM reports;
    DELETE FROM incidents;
    DELETE FROM reporters;
    DELETE FROM rate_events;
  `);
  try {
    for (const sub of ['private', 'public']) {
      const dir = path.join(config.uploadsDir, sub);
      if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
    }
  } catch { /* fichiers absents : rien à faire */ }
  console.log(`Purge des données effectuée (génération ${WIPE_GENERATION}).`);
}

export function getSetting(key) {
  // Priorité aux variables d'environnement (ex. VERIFICATION_REQUIRED=0 dans
  // Render) : permet de piloter la configuration sans passer par l'admin.
  // Dans la sandbox, SANDBOX_<CLÉ> prime (ex. SANDBOX_VERIFICATION_REQUIRED=0
  // pour tester sans OTP pendant que la prod le garde).
  if (config.isSandbox) {
    const sv = process.env['SANDBOX_' + key.toUpperCase()];
    if (sv !== undefined && sv !== '') return sv;
  }
  const envValue = process.env[key.toUpperCase()];
  if (envValue !== undefined && envValue !== '') return envValue;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultSettings[key];
}
export function getSettingNum(key) { return Number(getSetting(key)); }
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

export function touchIncident(id) {
  db.prepare(`UPDATE incidents SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(id);
}

// Amorçage du compte administrateur.
// Si ADMIN_PASSWORD est défini dans l'environnement, il fait autorité : le mot
// de passe du compte est (re)synchronisé à chaque démarrage — changer la
// variable dans Render puis redéployer suffit à récupérer l'accès admin.
export function bootstrapAdmin() {
  const username = config.adminBootstrap.username;
  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (config.adminBootstrap.password) {
    if (existing) {
      db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?')
        .run(scryptHash(config.adminBootstrap.password), existing.id);
      return null;
    }
    db.prepare('INSERT INTO admins(id, username, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(uuid(), username, scryptHash(config.adminBootstrap.password), 'admin');
    return { username, password: config.adminBootstrap.password };
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (count > 0) return null;
  const password = randomToken(9);
  db.prepare('INSERT INTO admins(id, username, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(uuid(), username, scryptHash(password), 'admin');
  return { username, password };
}

// Diagnostic au démarrage : où vit la base, et combien de données elle contient.
try {
  const n = db.prepare('SELECT COUNT(*) AS n FROM incidents').get().n;
  console.log(`Base de données : ${config.dbPath} — ${n} incident(s)`);
} catch { /* première création */ }
