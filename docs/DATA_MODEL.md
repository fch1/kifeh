# Modèle de données

Base SQLite (`data/incidents.db`), mode WAL. Toutes les dates sont en ISO 8601 UTC.

## incidents

| Colonne | Type | Description |
|---|---|---|
| id | TEXT PK | Identifiant interne (UUID) |
| public_id | TEXT UNIQUE | Identifiant public court (ex. `INC-7F3K2M`) affiché aux utilisateurs |
| type | TEXT | `electricity` · `water` · `fire` · `internet` · `other` |
| status | TEXT | `draft` · `pending_verification` · `verified` · `active` · `possible_duplicate` · `pending_review` · `resolved` · `expired` · `rejected` · `deleted` |
| severity | TEXT | `low` · `moderate` · `high` · `immediate_danger` |
| description | TEXT | Description courte (modérée avant publication) |
| comment | TEXT | Commentaire complémentaire (privé) |
| affected_count | INTEGER NULL | Nombre approximatif de logements/personnes affectés |
| temporal_status | TEXT | `ongoing` · `finished` · `planned` |
| started_at | TEXT | Début de l'incident |
| ended_at | TEXT NULL | Fin (obligatoirement ≥ started_at) |
| time_approximate | INTEGER | 1 si l'heure est approximative |
| lat / lng | REAL | **Coordonnées exactes — jamais exposées publiquement** |
| public_lat / public_lng | REAL | Coordonnées anonymisées (décalage déterministe, rayon configurable) |
| address | TEXT NULL | **Adresse normalisée exacte — privée** |
| public_area | TEXT NULL | Zone publique lisible (quartier / commune) |
| location_source | TEXT | `gps` · `address` · `manual` |
| gps_accuracy | REAL NULL | Précision GPS rapportée (m) |
| reporter_id | TEXT FK | Déclarant |
| trust_score | INTEGER | 0–100, calculé par `trust.js` |
| confirmations_count | INTEGER | Nombre de « je suis aussi concerné » |
| duplicate_of | TEXT NULL FK | Incident principal si doublon fusionné |
| expires_at | TEXT NULL | Expiration automatique si non confirmé |
| reminder_sent_at | TEXT NULL | Rappel « toujours en cours ? » envoyé |
| created_at / updated_at | TEXT | Horodatages |

Index : `(status, public_lat, public_lng)` pour la carte, `(type, status, started_at)` pour la recherche et la détection de doublons, `reporter_id`, `expires_at`.

## reporters (déclarants)

| Colonne | Type | Description |
|---|---|---|
| id | TEXT PK | Identifiant pseudonymisé (UUID) — aucune donnée nominative |
| channel | TEXT | `sms` · `email` |
| lang | TEXT | Langue préférée (`fr` · `ar`) pour les envois |
| contact_encrypted | TEXT | Téléphone ou e-mail chiffré AES-256-GCM |
| contact_hash | TEXT | HMAC-SHA256 du contact normalisé — recherche/limites sans déchiffrement |
| verified | INTEGER | 0/1 |
| verified_at | TEXT NULL | |
| consent_given_at | TEXT | Horodatage du consentement obligatoire |
| abuse_strikes | INTEGER | Historique d'abus |
| blocked_until | TEXT NULL | Suspension temporaire |
| delete_after | TEXT NULL | Date prévue de purge RGPD |
| created_at | TEXT | |

## verifications

| Colonne | Type | Description |
|---|---|---|
| id | TEXT PK | |
| reporter_id | TEXT FK | |
| incident_id | TEXT FK | Déclaration concernée |
| channel | TEXT | `sms` · `email_code` · `email_link` |
| code_hash | TEXT | OTP 6 chiffres ou jeton de lien — **stocké haché** |
| expires_at | TEXT | TTL configurable (OTP 10 min, lien 60 min par défaut) |
| attempts | INTEGER | Tentatives de saisie (max configurable, défaut 5) |
| resend_count | INTEGER | Renvois (délai minimal entre deux, plafond journalier) |
| status | TEXT | `pending` · `verified` · `expired` · `blocked` · `used` |
| validated_at | TEXT NULL | |
| created_at | TEXT | |

## confirmations (« je suis aussi concerné »)

| Colonne | Type | Description |
|---|---|---|
| id | TEXT PK | |
| incident_id | TEXT FK | Incident principal |
| contact_hash | TEXT | Unicité par contact et par incident |
| approx_lat / approx_lng | REAL NULL | Localisation approximative du confirmant |
| created_at | TEXT | |

## attachments (pièces jointes)

| Colonne | Type | Description |
|---|---|---|
| id | TEXT PK | |
| incident_id | TEXT FK | |
| mime | TEXT | image/jpeg, image/png, image/webp, video/mp4 |
| original_path | TEXT | Fichier original — **privé** (peut contenir de l'EXIF) |
| clean_path | TEXT NULL | Version nettoyée des métadonnées (publiable) |
| moderation_status | TEXT | `pending` · `approved` · `rejected` |
| public | INTEGER | Visible publiquement seulement si 1 **et** approved |
| created_at | TEXT | |

## admins & rôles

| Colonne | Type | Description |
|---|---|---|
| id | TEXT PK | |
| username | TEXT UNIQUE | |
| password_hash | TEXT | scrypt + sel |
| role | TEXT | `admin` · `moderator` · `operator` · `analyst` |
| created_at | TEXT | |

Capacités : `admin` = tout (config, comptes, export) ; `moderator` = valider/rejeter/fusionner/masquer/suspendre ; `operator` = valider/mettre à jour + **voir la localisation exacte** (comme admin/moderator) ; `analyst` = lecture seule agrégée, **sans** données exactes.

## audit_log

| Colonne | Type | Description |
|---|---|---|
| id | INTEGER PK | |
| actor | TEXT | Admin, `system` ou `reporter` |
| action | TEXT | ex. `view_exact_location`, `merge`, `reject`, `export`, `otp_blocked` |
| target | TEXT NULL | id de l'objet concerné |
| detail | TEXT NULL | JSON sans donnée personnelle en clair |
| ip_hash | TEXT NULL | IP hachée |
| created_at | TEXT | |

## rate_events

Compteurs glissants pour le rate limiting : `(bucket, key_hash, created_at)` où `bucket` ∈ `declare_ip`, `declare_contact`, `otp_send`, `otp_try`, `confirm_ip`, `search_ip`…

## settings

Paires clé/valeur administrables : `other_category_enabled`, `anonymize_radius_m`, `otp_ttl_min`, `email_link_ttl_min`, `otp_max_attempts`, `otp_resend_delay_s`, `active_incident_ttl_h`, `reminder_before_expiry_h`, `max_declarations_per_ip_per_h`, `max_declarations_per_contact_per_day`, `min_form_fill_s`, `retention_days`, `trust_publish_threshold`…

## Tables ajoutées depuis (multi-pays, satellite, officiel, alertes, sécurité)

Toutes additives — aucune table historique n'a été modifiée de façon destructive.

- **satellite_detections / satellite_events** : détections thermiques NASA FIRMS
  (empreinte `source|lat|lng|date|time|satellite` anti-doublon) regroupées en
  événements avec `country_code`, confiance, `activity_radius_m` (« zone
  d'activité observée », jamais un périmètre) ; corroboration automatique des
  incendies citoyens à < 2 km / 12 h.
- **official_authorities / official_updates** : liste blanche d'autorités
  (commune → préfecture → SDIS → ministère → FR-Alert) et messages officiels
  importés — texte original préservé, chaîne `supersedes`, statuts
  `current/superseded/archived`. La Vigilance Météo-France y publie
  automatiquement les départements orange/rouge (autorité `mf_vigilance`).
- **push_subscriptions** : alertes Web Push de zone auto-hébergées (VAPID) —
  centre arrondi ~1 km, rayon, types, langue, plafond quotidien satellite.
- **safety_checkins** : « Mon statut de sécurité » — statut personnel
  temporaire (`safe`/`left_area`), jetons de gestion et de partage **hachés**,
  expiration 6 h/12 h, aucune coordonnée exacte, purge RGPD automatique
  (contenu à +24 h, lignes à +30 j). Jamais lié aux compteurs d'incident.
- **contacts** : annuaire d'urgence vérifié **par pays** (198/190/197 TN,
  18/112/15/17/114 FR) — verrouillé par tests.
- Colonnes additives notables : `country_code` (incidents, satellite,
  abonnements), `secondary_hash` (anti-abus multi-dénominateurs : un appareil
  OU une IP déjà utilisés ne peuvent jamais resservir sur le même incident).

## Diagramme

```
reporters 1 ──── n incidents 1 ──── n attachments
    │                  │ 1
    │                  ├──── n confirmations
    │ 1                └──── n verifications (aussi liées au reporter)
    └──── n verifications
incidents n ──── 1 incidents (duplicate_of, auto-référence)
```
