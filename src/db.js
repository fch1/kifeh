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

// Réglages par défaut (sans écraser les valeurs administrées).
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaultSettings)) insertSetting.run(k, v);

export function getSetting(key) {
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

// Amorçage du compte administrateur au premier démarrage.
export function bootstrapAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (count > 0) return null;
  const password = config.adminBootstrap.password || randomToken(9);
  db.prepare('INSERT INTO admins(id, username, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(uuid(), config.adminBootstrap.username, scryptHash(password), 'admin');
  return { username: config.adminBootstrap.username, password };
}

export function backup() {
  const dest = `${config.dbPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  return db.backup(dest).then(() => console.log(`Sauvegarde créée : ${dest}`));
}
