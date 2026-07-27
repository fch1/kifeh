# Kifeh كيفاه

**« اللي صاير حواليك، لحظة بلحظة » — Ce qui se passe autour de vous, en temps réel.**

Kifeh est une plateforme citoyenne tunisienne, libre et open source, de
signalement et de visualisation en temps réel des incidents locaux :
coupures d'électricité ⚡, coupures d'eau 💧, incendies 🔥 et coupures
internet 📶 — sur une seule carte, complétée par les détections
satellitaires d'incendies de la **NASA (FIRMS)**.

Bilingue **français / arabe (RTL complet)**, pensée pour les conditions
réelles d'usage en Tunisie : téléphone d'entrée de gamme, 3G instable,
WebView, batterie faible, carte indisponible.

> ⚠️ Kifeh est une initiative citoyenne indépendante. Elle ne remplace ni les
> services d'urgence (**198** Protection civile · **190** SAMU · **197**
> Police secours · **193** Garde nationale), ni la STEG, ni la SONEDE.

Démo : **https://kifeh.app**

## Fonctionnalités

- **Carte temps réel** (Leaflet + OpenStreetMap) avec bascule automatique de
  fournisseur de tuiles ; l'application reste entièrement utilisable sans fond
  de carte (liste, recherche, filtres, déclaration).
- **Déclaration en 4 étapes** sans compte : type, position (GPS / adresse /
  repère déplaçable), période, description. Position publique **anonymisée**
  (~250 m) — l'adresse exacte n'est jamais publiée.
- **Vie communautaire** : « Je suis aussi concerné », « C'est toujours en
  cours », « C'est terminé » (résolution immédiate, réouverture possible
  pendant 24 h), correction de localisation, confirmation communautaire des
  incendies (seuil de 3 personnes, contrôle de proximité GPS).
- **NASA FIRMS** : import serveur toutes les 15 minutes (VIIRS SNPP/NOAA-20/
  NOAA-21 + MODIS), filtrage par polygone des frontières tunisiennes,
  déduplication par empreinte unique, regroupement en événements incendie,
  corroboration automatique des signalements citoyens — jamais présentée
  comme une confirmation officielle.
- **Écran d'urgence après déclaration** : numéros tunisiens vérifiés selon le
  type d'incident (198/190/197/193, urgences STEG, SONEDE), annuaire
  centralisé modifiable en administration.
- **Kifeh Léger (كيفاه خفيف)** : mode économe — liste d'abord, carte à la
  demande — activé manuellement ou quand le navigateur signale une connexion
  lente ou l'économie de données.
- **Hors-ligne** : le dernier état chargé reste consultable, toujours
  horodaté.
- **Bilingue FR/AR** : même qualité dans les deux langues (IBM Plex Sans +
  IBM Plex Sans Arabic vendorisées), RTL complet, langue de l'appareil par
  défaut, choix mémorisé, heure de Tunis, numéros +216 acceptés à 8 chiffres.
- **Vérification OTP** (SMS/e-mail) activable/désactivable à chaud ;
  anti-abus : honeypot, délai de remplissage, limites IP/contact, score de
  confiance, file de modération.
- **Administration** : modération, fusion de doublons, corrections de
  localisation, supervision NASA, annuaire de contacts, journal d'audit,
  export CSV, réglages à chaud.
- **Vie privée** : contacts chiffrés (AES-256-GCM), métadonnées EXIF retirées
  des photos, purge RGPD automatique, télémétrie d'erreurs sans donnée
  personnelle.

## Démarrage rapide

```bash
npm install
npm run dev          # http://localhost:3000
```

Aucune configuration nécessaire en développement : les SMS/e-mails simulés
sont visibles sur `GET /api/dev/outbox`, un compte admin est affiché en
console (`/admin.html`), et la couche satellite reste simplement vide sans
clé NASA.

```bash
npm test             # ~170 tests API, dont un serveur NASA simulé
npm run test:browser # tests navigateur mobile FR/AR (Playwright)
```

## Configuration

Copiez [`.env.example`](.env.example). En production, renseignez au minimum
les trois `SECRET_*` (`openssl rand -hex 32`), `ADMIN_PASSWORD`, et
`NASA_FIRMS_MAP_KEY` ([clé gratuite](https://firms.modaps.eosdis.nasa.gov/api/map_key))
pour activer la couche satellite. Tout réglage applicatif — seuils
communautaires, fenêtres NASA, fournisseurs de tuiles, drapeaux de
fonctionnalités — est surchargeable par variable d'environnement (nom en
MAJUSCULES) ou à chaud via l'administration : voir `defaultSettings` dans
[`src/config.js`](src/config.js). Guide de déploiement complet (Docker, VPS,
PaaS, sauvegardes) : [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md).

## Architecture

Node.js ≥ 20 · Express 5 · SQLite (better-sqlite3, WAL) · vanilla JS +
Leaflet, tout vendorisé (aucun CDN requis à l'exécution). Temps réel par SSE.
Migrations additives et idempotentes ; sauvegardes automatiques de la base
chaque minute, heure et jour ; environnement de test cloisonné sur `/sandbox`.

```
server.js            point d'entrée, proxy sandbox, domaine canonique, healthz
src/config.js        configuration + réglages par défaut (tous surchargeables)
src/db.js            schéma + migrations additives idempotentes
src/routes/          public, declare, manage, admin, events (SSE)
src/services/        firms (NASA), otp, notifier, geocode, anonymize, dedup,
                     trust, media, scheduler (synchros + sauvegardes), crypto
public/              interface (carte, déclaration, gestion, admin, légal)
tests/               suites API + navigateur (~300 vérifications)
docs/                architecture, modèle de données, parcours, déploiement, marque
```

Détails : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) ·
[`docs/USER_FLOWS.md`](docs/USER_FLOWS.md) ·
[`docs/BRAND.md`](docs/BRAND.md)

## Contribuer

Les contributions sont bienvenues : corrections, traductions, accessibilité,
nouvelles sources de données officielles. Ouvrez une issue ou une pull
request. Quelques règles simples : tout texte visible doit exister en
français ET en arabe ; chaque correction s'accompagne d'un test de régression
(`npm test` doit rester vert) ; aucun secret côté client ; et les données
satellitaires ou communautaires ne sont **jamais** présentées comme des
confirmations officielles des autorités.

## Licence

[MIT](LICENSE) © 2026 Farah Chabchoub. Fond de carte © contributeurs
OpenStreetMap. Données incendies : NASA FIRMS — We acknowledge the use of
data from NASA's Fire Information for Resource Management System (FIRMS).
