# Kifeh كيفاه

**« اللي صاير حواليك، لحظة بلحظة » — « Ce qui se passe autour de vous, en temps réel »**

Application citoyenne tunisienne, mobile-first (WebView iOS/Android + navigateur),
de **signalement et de visualisation en temps réel des incidents locaux** :
coupures d'électricité ⚡, coupures d'eau 💧, incendies 🔥 et coupures internet 📶.
Bilingue **français / arabe (RTL)** avec détection de la langue de l'appareil.
Consultation publique sans compte ; publication après vérification obligatoire
par SMS ou e-mail.

> ⚠️ Kifeh ne remplace pas les services d'urgence (198 Protection civile ·
> 190 SAMU · 197 Police · 193 Garde nationale).

Identité de marque complète (naming, directions créatives, palette, typographies,
logo, ton éditorial FR/AR) : **`docs/BRAND.md`**.

## Démarrage rapide

```bash
npm install
npm run dev          # http://localhost:3000
```

Au premier démarrage, un compte administrateur est créé et affiché dans la
console. Interface d'administration : `/admin.html`.

**Mode développement** : les SMS et e-mails (codes OTP, liens de confirmation,
liens de gestion) ne sont pas réellement envoyés — ils sont visibles dans la
console du serveur et sur `GET /api/dev/outbox`. Tout le parcours se teste sans
fournisseur externe.

```bash
npm test             # 64 tests de bout en bout (dont parcours en arabe)
npm run backup       # sauvegarde à chaud de la base SQLite
node tests/smoke-browser.mjs   # rendu navigateur FR + AR (Playwright, optionnel)
```

## Langues

- Français et arabe, **même qualité dans les deux langues** (IBM Plex Sans +
  IBM Plex Sans Arabic, vendorisées — aucun appel réseau).
- Langue par défaut = langue de l'appareil (arabe si le téléphone est en arabe) ;
  sélecteur visible sur chaque écran ; choix mémorisé.
- Interface entièrement RTL en arabe ; erreurs API, SMS et e-mails localisés
  (la langue du déclarant est mémorisée pour les rappels ultérieurs).
- Défauts Tunisie : carte centrée sur la Tunisie, indicatif +216, numéros
  d'urgence tunisiens, biais de géocodage Tunisie (noms de lieux acceptés en
  arabe et en différentes orthographes latines).

## Déploiement

Guide complet : **`docs/DEPLOIEMENT.md`** (Docker + docker-compose fournis,
VPS/systemd, nginx + HTTPS, PaaS, Twilio, sauvegardes, checklist de mise en
ligne, intégration WebView).

Variables d'environnement principales :

| Variable | Rôle |
|---|---|
| `NODE_ENV=production` | Désactive les routes de dev et l'outbox |
| `BASE_URL` | URL publique (liens SMS/e-mail) |
| `SECRET_ENCRYPTION_KEY` / `SECRET_HMAC_KEY` / `SECRET_COOKIE_KEY` | Secrets (obligatoires en prod) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Compte admin initial |
| `NOTIFIER_DRIVER` | `dev` (défaut), `twilio` ou `smtp` |
| `TWILIO_SID` / `TWILIO_TOKEN` / `TWILIO_FROM` | Envoi réel de SMS |
| `DB_PATH` | Chemin SQLite (défaut `data/incidents.db`) |
| `NOMINATIM_URL` / `GEOCODE_VIEWBOX` | Géocodage (biais Tunisie par défaut) |

## Fonctionnalités

- **Carte publique temps réel** (Leaflet + OSM servis localement) : clustering,
  recherche d'adresse avec autocomplétion, filtres type/statut/période, vue
  liste triable, compteur de zone, mise à jour **en temps réel par Server-Sent
  Events** (publication, confirmation, clôture, expiration apparaissent sans
  recharger).
- **Parcours de déclaration en 6 étapes** : type (avertissement urgence pour
  incendie) → localisation (GPS avec repli adresse/pointage manuel, promesse de
  non-publication de l'adresse exacte) → période (en cours / terminé / prévu,
  bouton « Maintenant », heure approximative, contrôle fin ≥ début) → détails +
  photo (EXIF retiré) → contact → OTP SMS / code e-mail / lien e-mail à usage
  unique. Brouillon en localStorage, clé d'idempotence anti double-soumission.
- **Suivi par le déclarant** : lien de gestion signé (jeton 256 bits haché,
  révocable, expirant) — toujours en cours / clôturer / modifier / supprimer /
  signaler une erreur de localisation.
- **Cycle de vie** : expiration automatique, rappel « toujours en cours ? »,
  purge RGPD des contacts.
- **Doublons** : détection type + proximité + fenêtre temporelle, « je suis
  aussi concerné » vérifié (compteur de confirmations), fusion côté admin.
- **Anti-abus** : honeypot, délai minimal de remplissage, rate limiting
  IP/contact, limites et blocage OTP, détection de textes répétés, filtrage de
  liens, score de confiance interne, suspension de contacts, journal d'audit.
- **Confidentialité** : position publique décalée de façon déterministe
  (100–300 m), contacts chiffrés AES-256-GCM, jetons hachés, aucune donnée
  personnelle dans les API publiques ni les logs.
- **Administration** : rôles admin/moderator/operator/analyst, file d'attente,
  modération, fusion, pièces jointes, configuration à chaud, export CSV,
  statistiques, audit.

## Documentation

- `docs/BRAND.md` — identité de marque (naming, palette, typo, logo, ton)
- `docs/ARCHITECTURE.md` — architecture technique
- `docs/DATA_MODEL.md` — modèle de données
- `docs/USER_FLOWS.md` — parcours utilisateurs
- `docs/SCREENS.md` — les 20 écrans
- `docs/DEPLOIEMENT.md` — guide de déploiement

## Structure

```
server.js                  Point d'entrée Express
src/i18n.js                Messages serveur FR/AR (erreurs, SMS, e-mails)
src/config.js · src/db.js  Config + schéma SQLite (migrations auto)
src/middleware/            security, rateLimit, adminAuth
src/services/              crypto, otp, notifier, geocode, anonymize, dedup,
                           trust, media (EXIF), scheduler, audit
src/routes/                public, declare, manage, admin, events (SSE), dev
public/                    Frontend mobile-first bilingue (vanilla JS)
public/js/i18n.js          Dictionnaires FR/AR + RTL + sélecteur de langue
public/img/logo.svg        Logo Kifeh (+ version horizontale)
public/vendor/             Leaflet + polices IBM Plex (aucun CDN)
tests/                     64 tests e2e + smoke test navigateur
Dockerfile · docker-compose.yml
```
