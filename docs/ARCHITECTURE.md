# Architecture — Incidents Locaux

Application mobile-first de déclaration et de visualisation en temps réel d'incidents domestiques ou locaux (électricité, eau, incendie), utilisable dans une WebView iOS/Android et depuis un navigateur.

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────┐
│                     CLIENTS                                 │
│  WebView iOS · WebView Android · Navigateur web             │
│  (HTML/CSS/JS vanilla, Leaflet + OpenStreetMap)             │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS (JSON) + SSE (temps réel)
┌──────────────────────────▼──────────────────────────────────┐
│                  SERVEUR Node.js (Express)                  │
│                                                             │
│  Couche middleware                                          │
│   · rate limiting (IP / contact / session)                  │
│   · honeypot + délai minimal de remplissage                 │
│   · validation stricte des entrées                          │
│   · sessions admin (cookies signés HttpOnly)                │
│   · en-têtes de sécurité (CSP, X-Frame-Options…)            │
│                                                             │
│  Couche routes (API REST)                                   │
│   · /api/public    carte, recherche, détail, confirmation   │
│   · /api/declare   parcours de déclaration + OTP            │
│   · /api/manage    gestion via lien signé                   │
│   · /api/admin     back-office (rôles)                      │
│   · /api/events    Server-Sent Events (temps réel)          │
│                                                             │
│  Couche services                                            │
│   · otp.js         génération/vérification OTP + liens      │
│   · notifier.js    adaptateur SMS/e-mail (dev|twilio|smtp)  │
│   · geocode.js     géocodage + autocomplétion (Nominatim)   │
│   · anonymize.js   décalage déterministe des coordonnées    │
│   · dedup.js       détection de doublons                    │
│   · trust.js       score de confiance                       │
│   · media.js       upload + nettoyage EXIF (sharp)          │
│   · scheduler.js   expiration automatique, purge RGPD       │
│   · audit.js       journalisation des actions sensibles     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  SQLite (better-sqlite3, WAL)                               │
│  incidents · reporters · verifications · confirmations      │
│  attachments · admins · audit_log · rate_events · settings  │
│                                                             │
│  Fichiers : uploads/ (originaux privés + versions publiques │
│  nettoyées des métadonnées EXIF)                            │
└─────────────────────────────────────────────────────────────┘
```

## Principes structurants

### Séparation données publiques / données personnelles
- La table `incidents` porte deux paires de coordonnées : `lat`/`lng` (exactes, jamais exposées publiquement) et `public_lat`/`public_lng` (anonymisées par décalage déterministe dans un rayon configurable, 100–300 m par défaut 250 m).
- Les API publiques (`/api/public/*`) ne sélectionnent **jamais** les colonnes sensibles (coordonnées exactes, adresse exacte, contact). La restriction est faite au niveau des requêtes SQL, pas seulement de la sérialisation.
- Les contacts (téléphone / e-mail) sont chiffrés au repos (AES-256-GCM, clé dans `SECRET_ENCRYPTION_KEY`) et un hachage HMAC sert aux recherches (limites anti-abus, suspension) sans déchiffrement.

### Vérification obligatoire avant publication
Une déclaration suit : `draft → pending_verification → verified → active`. Elle n'apparaît sur la carte qu'à partir de `active`, après OTP SMS ou lien/code e-mail validé, et selon le score de confiance et la modération.

### Temps réel
Server-Sent Events (`/api/events`) : chaque création/mise à jour/expiration d'incident publie un événement ; les clients rafraîchissent la zone visible. SSE est choisi plutôt que WebSocket car unidirectionnel, natif en WebView, tolérant aux proxys et reconnectant automatiquement.

### Anti-abus (défense en profondeur)
Empilement : honeypot invisible → délai minimal de remplissage → rate limiting par IP, par contact (haché) et par session → limites OTP (tentatives, renvois, blocage temporaire) → détection de textes répétés → filtrage de liens/contenus → score de confiance interne → liste de blocage. Les mécanismes ne sont pas révélés au client (réponses génériques).

### Score de confiance
Calculé par `trust.js` à partir de : vérification réussie, cohérence géolocalisation (distance position GPS ↔ point déclaré), signalements similaires à proximité, historique d'abus du contact, vitesse de remplissage, réputation IP. Sous un seuil configurable, l'incident passe en `pending_review` (validation manuelle) au lieu d'être publié automatiquement.

### Configuration
Table `settings` administrable : catégorie « Autre » activable, rayon d'anonymisation, TTL OTP, TTL lien e-mail, durée d'expiration des incidents actifs, limites anti-spam, durée de rétention des données personnelles.

### Adaptateurs d'envoi
`notifier.js` expose `sendSms(to, text)` / `sendEmail(to, subject, html)`. Trois pilotes : `dev` (journalise dans la console dev + endpoint `/api/dev/outbox` en mode développement), `twilio`, `smtp`. Le passage en production = variables d'environnement, zéro changement de code.

## Arborescence

```
incident-app/
├── server.js               Point d'entrée
├── src/
│   ├── config.js           Config centralisée (env + défauts)
│   ├── db.js               Schéma, migrations, accès SQLite
│   ├── middleware/         security.js, rateLimit.js, adminAuth.js
│   ├── services/           otp, notifier, geocode, anonymize,
│   │                       dedup, trust, media, scheduler, audit, crypto
│   └── routes/             public.js, declare.js, manage.js,
│                           admin.js, events.js, dev.js
├── public/                 Frontend statique mobile-first
│   ├── index.html          Accueil : carte + liste + filtres + détail
│   ├── declare.html        Parcours de déclaration (6 étapes)
│   ├── manage.html         Gestion/clôture via lien signé
│   ├── verify.html         Atterrissage du lien e-mail
│   ├── admin.html          Back-office
│   ├── legal.html          Confidentialité · CGU · urgences
│   ├── css/app.css
│   └── js/                 api.js, map.js, home.js, declare.js, …
├── docs/                   Ce dossier
├── tests/run-tests.mjs     Scénarios de bout en bout
├── uploads/                Médias (privés + publics nettoyés)
└── data/                   incidents.db (SQLite)
```

## Sécurité

- CSP stricte, `X-Frame-Options`, `Referrer-Policy`, `nosniff`.
- Requêtes SQL 100 % préparées (aucune concaténation).
- Échappement systématique côté client (aucun `innerHTML` avec données utilisateur).
- Cookies admin : HttpOnly, SameSite=Lax, signés ; CSRF par jeton en double soumission sur les mutations admin.
- Liens de gestion et de vérification : jetons aléatoires 256 bits, stockés **hachés** (SHA-256), usage unique pour la vérification, révocables, expiration configurable.
- Secrets uniquement via variables d'environnement ; jamais dans le dépôt ni les logs.
- Logs techniques sans données personnelles (contacts masqués, coordonnées arrondies).
- Journal d'audit pour toute consultation de donnée sensible en admin.
- Sauvegarde : `npm run backup` (copie à chaud de la base via l'API SQLite backup).

## Conformité RGPD

- Minimisation : seul un canal de contact est collecté, pas de compte permanent.
- Consentement explicite (case obligatoire) stocké avec horodatage.
- Purge automatique : les contacts sont supprimés/anonymisés `RETENTION_DAYS` (défaut 90 j) après résolution de l'incident ; le déclarant peut supprimer sa déclaration via son lien de gestion.
- Droits d'accès/rectification/suppression : via le lien de gestion + adresse de contact indiquée dans la page confidentialité.
- EXIF (dont GPS) retiré de tout média avant publication.
