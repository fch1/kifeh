// Migrations ADDITIVES de Kifeh — extraites de db.js (dette technique #58),
// contenu STRICTEMENT identique : uniquement des colonnes et tables nouvelles,
// idempotentes (IF NOT EXISTS / vérification de colonne), dans UNE transaction.
// RÈGLE ABSOLUE : jamais de suppression ni de modification de données ici.

export function runMigrations(db) {
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

      -- « Situation incendie » — informations officielles locales (France).
      -- LISTE BLANCHE d'autorités vérifiées : commune, intercommunalité,
      -- préfecture, SDIS, ministère, FR-Alert… Jamais de source non vérifiée.
      CREATE TABLE IF NOT EXISTS official_authorities (
        id TEXT PRIMARY KEY,
        country_code TEXT NOT NULL DEFAULT 'FR',
        name TEXT NOT NULL,                  -- ex. « Préfecture de la Gironde »
        authority_type TEXT NOT NULL CHECK (authority_type IN
          ('commune','intercommunalite','prefecture','departement','sdis','ministere','fr_alert','autre_autorite')),
        official_domain TEXT,                -- domaine officiel (vérification)
        coverage_level TEXT NOT NULL DEFAULT 'commune' CHECK (coverage_level IN
          ('commune','intercommunalite','departement','region','national')),
        coverage_codes TEXT,                 -- csv codes INSEE commune / département
        source_url TEXT,
        retrieval_method TEXT NOT NULL DEFAULT 'admin_import' CHECK (retrieval_method IN
          ('api','rss','structured_page','fr_alert_public','admin_import','page_extraction')),
        verified_at TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      -- Messages officiels importés : texte original PRÉSERVÉ, jamais réécrit
      -- d'une façon qui change le sens ; historique conservé (supersedes).
      CREATE TABLE IF NOT EXISTS official_updates (
        id TEXT PRIMARY KEY,
        country_code TEXT NOT NULL DEFAULT 'FR',
        authority_id TEXT NOT NULL REFERENCES official_authorities(id),
        source_url TEXT,
        source_title TEXT,
        raw_content TEXT,                    -- texte original (jamais altéré)
        summary_fr TEXT,                     -- résumé factuel court
        summary_ar TEXT,                     -- résumé Kifeh (étiqueté comme tel)
        info_type TEXT NOT NULL DEFAULT 'situation_update' CHECK (info_type IN
          ('situation_update','safety_instruction','evacuation','shelter_in_place','road_closure',
           'access_restriction','fire_status','end_of_alert','prevention','other')),
        severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','important','urgent')),
        status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded','archived')),
        affected_dept_codes TEXT,            -- csv (ex. « 33 »)
        affected_commune_codes TEXT,         -- csv codes INSEE
        centroid_lat REAL, centroid_lng REAL,
        radius_km REAL,                      -- zone approximative concernée
        geometry_json TEXT,                  -- GeoJSON éventuel (périmètre attribué)
        geometry_source TEXT,                -- fournisseur du périmètre le cas échéant
        valid_from TEXT, valid_until TEXT,
        published_at TEXT NOT NULL,
        updated_at_source TEXT,
        imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        source_hash TEXT,
        parser_confidence REAL,
        requires_review INTEGER NOT NULL DEFAULT 0,
        is_published INTEGER NOT NULL DEFAULT 1,
        supersedes_id TEXT REFERENCES official_updates(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_official_updates_pub
        ON official_updates(country_code, is_published, status, published_at);

      -- Sources thermiques persistantes connues (industries, torchères…) :
      -- masquées de la publication automatique pour éviter les faux incendies.
      -- Abonnements « M'alerter dans cette zone » (Web Push, gratuit et sans
      -- service tiers : les notifications passent par le navigateur lui-même).
      -- Vie privée : centre de zone ARRONDI (~1 km), aucun identifiant personnel.
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        country_code TEXT NOT NULL DEFAULT 'TN',
        center_lat REAL NOT NULL,
        center_lng REAL NOT NULL,
        radius_km REAL NOT NULL DEFAULT 10,
        types TEXT NOT NULL DEFAULT '',   -- csv vide = tous les types
        lang TEXT NOT NULL DEFAULT 'fr',
        failures INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        last_notified_at TEXT,
        sat_day TEXT,                     -- plafond quotidien des alertes satellite
        sat_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_push_country ON push_subscriptions(country_code);

      CREATE TABLE IF NOT EXISTS thermal_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        lat REAL NOT NULL, lng REAL NOT NULL,
        radius_m INTEGER NOT NULL DEFAULT 1500,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      -- « Mon statut de sécurité » : check-in PERSONNEL et TEMPORAIRE, jamais
      -- confondu avec l'état de l'incident. Vie privée d'abord : aucune
      -- coordonnée exacte, aucun nom obligatoire, jetons stockés HACHÉS,
      -- expiration automatique (6 h « en sécurité », 12 h « a quitté la zone »).
      -- Le statut n'apparaît JAMAIS sur la carte publique : il n'est visible
      -- que par son auteur et par les personnes recevant son lien sécurisé.
      CREATE TABLE IF NOT EXISTS safety_checkins (
        id TEXT PRIMARY KEY,
        country_code TEXT NOT NULL DEFAULT 'TN',
        incident_id TEXT REFERENCES incidents(id),
        satellite_event_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('safe','left_area')),
        display_name TEXT,                -- prénom choisi, uniquement si saisi
        personal_message TEXT,            -- court message facultatif
        area_label TEXT,                  -- zone approximative (texte, jamais GPS)
        device_hash TEXT,                 -- idempotence : 1 statut actif par appareil+incident
        ip_hash TEXT,
        management_token_hash TEXT NOT NULL,
        sharing_token_hash TEXT,          -- créé seulement si l'utilisateur partage
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      );
      -- Alertes de zone par E-MAIL (Resend) : double consentement, adresse
      -- chiffrée au repos, jeton de désinscription à capacité unique, plafond
      -- quotidien. Centre de zone arrondi ~1 km (vie privée).
      CREATE TABLE IF NOT EXISTS email_alert_subscriptions (
        id TEXT PRIMARY KEY,
        email_hash TEXT UNIQUE NOT NULL,
        email_encrypted TEXT NOT NULL,
        country_code TEXT NOT NULL DEFAULT 'TN',
        center_lat REAL NOT NULL,
        center_lng REAL NOT NULL,
        radius_km REAL NOT NULL DEFAULT 20,
        types TEXT NOT NULL DEFAULT '',
        lang TEXT NOT NULL DEFAULT 'fr',
        confirm_token_hash TEXT,
        confirmed_at TEXT,
        unsub_token TEXT NOT NULL,
        failures INTEGER NOT NULL DEFAULT 0,
        day TEXT,
        day_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        last_notified_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_email_alert_country
        ON email_alert_subscriptions(country_code, confirmed_at);

      CREATE INDEX IF NOT EXISTS idx_safety_device
        ON safety_checkins(device_hash, incident_id, satellite_event_id);
      CREATE INDEX IF NOT EXISTS idx_safety_share ON safety_checkins(sharing_token_hash);
    `);

    // Anti-abus des confirmations : chaque contribution mémorise TOUS ses
    // dénominateurs (appareil ET adresse IP) — un dénominateur déjà utilisé ne
    // peut jamais resservir sur le même incident. Colonnes additives.
    for (const t of ['confirmations', 'resolution_reports', 'satellite_event_feedback']) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      if (cols.length && !cols.includes('secondary_hash')) {
        db.exec(`ALTER TABLE ${t} ADD COLUMN secondary_hash TEXT`);
      }
    }

    // Rayon d'activité satellite (distance max. détection↔centroïde + marge) :
    // matérialise la « zone d'activité observée par satellite » — approximative,
    // jamais présentée comme un périmètre d'incendie. Colonne additive.
    const satEvCols = db.prepare(`PRAGMA table_info(satellite_events)`).all().map((c) => c.name);
    if (satEvCols.length && !satEvCols.includes('activity_radius_m')) {
      db.exec(`ALTER TABLE satellite_events ADD COLUMN activity_radius_m INTEGER`);
    }

    // Plafond quotidien des notifications satellite (colonnes additives — la
    // table push_subscriptions peut déjà exister en production sans elles).
    const pushCols = db.prepare(`PRAGMA table_info(push_subscriptions)`).all().map((c) => c.name);
    if (pushCols.length && !pushCols.includes('sat_day')) {
      db.exec(`ALTER TABLE push_subscriptions ADD COLUMN sat_day TEXT`);
      db.exec(`ALTER TABLE push_subscriptions ADD COLUMN sat_count INTEGER NOT NULL DEFAULT 0`);
    }

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

    // 3f-ter. Brief quotidien e-mail : opt-in SÉPARÉ des alertes immédiates
    //         (colonne additive, 0 par défaut — personne n'est abonné d'office).
    const emailCols = db.prepare(`PRAGMA table_info(email_alert_subscriptions)`).all().map((c) => c.name);
    if (emailCols.length && !emailCols.includes('digest_opt_in')) {
      db.exec(`ALTER TABLE email_alert_subscriptions ADD COLUMN digest_opt_in INTEGER NOT NULL DEFAULT 0`);
    }

    // 3f-quater. VÉRITÉ DES DONNÉES (Lot 1 « Feux FR ») — historisation :
  //   · détections satellite : heure de réception + lot d'import (additif ;
  //     la table était déjà IMMUABLE : INSERT OR IGNORE + empreinte unique) ;
  //   · périmètres brûlés EFFIS : CHAQUE version publiée est conservée —
  //     indispensable au replay honnête (« ce qui était connu à l'instant T »).
  const detCols = db.prepare(`PRAGMA table_info(satellite_detections)`).all().map((c) => c.name);
  if (detCols.length && !detCols.includes('received_at')) {
    db.exec(`ALTER TABLE satellite_detections ADD COLUMN received_at TEXT`);
    db.exec(`ALTER TABLE satellite_detections ADD COLUMN source_batch_id TEXT`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS burned_area_versions (
      id TEXT PRIMARY KEY,
      effis_feature_id INTEGER NOT NULL,
      geometry_display TEXT NOT NULL,      -- anneaux simplifiés [lat,lng] (affichage)
      area_ha_source INTEGER,              -- TOUJOURS la surface fournie par EFFIS,
                                           -- jamais recalculée depuis la géométrie simplifiée
      commune TEXT, province TEXT,
      fire_date TEXT,
      published_at TEXT NOT NULL,          -- lastupdate côté Copernicus
      received_at TEXT NOT NULL,           -- réception par Kifeh
      source_batch_id TEXT,
      is_latest INTEGER NOT NULL DEFAULT 1,
      UNIQUE(effis_feature_id, published_at)
    );
    CREATE INDEX IF NOT EXISTS idx_bav_feature ON burned_area_versions(effis_feature_id, published_at);
    CREATE INDEX IF NOT EXISTS idx_bav_latest ON burned_area_versions(is_latest, fire_date);
  `);

  // 3g. Repère DFCI (feux français) — colonnes ADDITIVES, null par défaut :
    //     l'ancien code les ignore, aucune donnée existante n'est modifiée.
    const dfciCols = db.prepare(`PRAGMA table_info(incidents)`).all().map((c) => c.name);
    if (!dfciCols.includes('dfci_code')) {
      db.exec(`ALTER TABLE incidents ADD COLUMN dfci_code TEXT`);
      db.exec(`ALTER TABLE incidents ADD COLUMN dfci_precision TEXT`);
      db.exec(`ALTER TABLE incidents ADD COLUMN dfci_source_version TEXT`);
      db.exec(`ALTER TABLE incidents ADD COLUMN dfci_computed_at TEXT`);
      db.exec(`ALTER TABLE incidents ADD COLUMN dfci_ambiguous INTEGER NOT NULL DEFAULT 0`);
    }
  })();

  // 3h. Rollout prévisions (31/07/2026) : le lancement sombre du matin a semé
  // fire_forecast_enabled_* = '0' (INSERT OR IGNORE) AVANT l'activation — les
  // nouveaux défauts '1' ne réappliquent jamais une clé déjà stockée. Bascule
  // UNIQUE vers '1', gardée par un marqueur : elle ne rejouera JAMAIS, et
  // l'administration reste libre de couper ensuite (coupure à chaud testée).
  (() => {
    const done = db.prepare(`SELECT 1 FROM settings WHERE key = 'mig_fire_forecast_rollout'`).get();
    if (done) return;
    db.prepare(`UPDATE settings SET value = '1'
      WHERE key IN ('fire_forecast_enabled_fr', 'fire_forecast_enabled_tn') AND value = '0'`).run();
    db.prepare(`INSERT OR IGNORE INTO settings(key, value) VALUES ('mig_fire_forecast_rollout', '1')`).run();
  })();

  // 3i. Affichage public DFCI — ACTIVÉ le 31/07/2026 sur décision explicite
  // de Farah (« active le DFCI public »). Bascule unique du '0' semé à
  // l'origine ; l'administration garde la coupure à chaud.
  (() => {
    const done = db.prepare(`SELECT 1 FROM settings WHERE key = 'mig_dfci_public_rollout'`).get();
    if (done) return;
    db.prepare(`UPDATE settings SET value = '1'
      WHERE key = 'dfci_public_display_enabled' AND value = '0'`).run();
    db.prepare(`INSERT OR IGNORE INTO settings(key, value) VALUES ('mig_dfci_public_rollout', '1')`).run();
  })();

  // 3j. REVERT rail desktop (31/07 soir, demande explicite de Farah) :
  // bascule unique du '1' semé quelques heures plus tôt vers '0'.
  (() => {
    const done = db.prepare(`SELECT 1 FROM settings WHERE key = 'mig_rail_revert_3107'`).get();
    if (done) return;
    db.prepare(`UPDATE settings SET value = '0' WHERE key = 'fire_desktop_rail_enabled' AND value = '1'`).run();
    db.prepare(`INSERT OR IGNORE INTO settings(key, value) VALUES ('mig_rail_revert_3107', '1')`).run();
  })();

  // 3k. Activation progressive du moteur MapLibre (#122, 04/08) — étape 1 :
  // BAC À SABLE UNIQUEMENT (le processus /sandbox a sa propre base : cette
  // bascule n'y touche que lui). La production reste éteinte ; l'étape
  // suivante (pourcentage de sessions) passera par sa propre migration après
  // vérification en conditions réelles. Rollback : réglage à chaud.
  (() => {
    if (process.env.SANDBOX !== '1') return; // jamais la production ici
    const done = db.prepare(`SELECT 1 FROM settings WHERE key = 'mig_gl_sandbox_0408'`).get();
    if (done) return;
    db.prepare(`UPDATE settings SET value = '1' WHERE key = 'fire_maplibre_enabled'`).run();
    db.prepare(`INSERT OR IGNORE INTO settings(key, value) VALUES ('mig_gl_sandbox_0408', '1')`).run();
  })();
}
