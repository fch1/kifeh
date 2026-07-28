# Kifeh كيفاه

[![Tests](https://github.com/fch1/kifeh/actions/workflows/ci.yml/badge.svg)](https://github.com/fch1/kifeh/actions/workflows/ci.yml)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-green.svg)](LICENSE)
[![FR](https://img.shields.io/badge/langue-fran%C3%A7ais-blue.svg)](#)
[![AR](https://img.shields.io/badge/%D8%A7%D9%84%D9%84%D8%BA%D8%A9-%D8%A7%D9%84%D8%B9%D8%B1%D8%A8%D9%8A%D8%A9-blue.svg)](#)
[![PRs bienvenues](https://img.shields.io/badge/PRs-bienvenues-orange.svg)](#contribuer)

**Kifeh (كيفاه), c'est « comment ? » en tunisien.** La question qu'on pose au
voisin quand la lumière saute : *« kifeh ? c'est chez toi aussi ? »* Ce projet
est né de cette question-là — et de l'idée qu'un peuple qui s'informe
lui-même, quartier par quartier, est un peuple plus fort face aux coupures,
aux pannes et aux incendies.

En Tunisie, quand l'électricité saute dans un quartier, la réponse existait
déjà — dispersée dans des groupes Facebook, des messages vocaux et des appels
au voisin. Kifeh la met sur une carte : une plateforme **citoyenne, gratuite,
libre et open source**, sans compte obligatoire et sans publicité, où chacun
peut signaler et consulter en temps réel les coupures d'électricité ⚡, les
coupures d'eau 💧, les incendies 🔥 et les pannes internet 📶 autour de lui.
Chaque signalement aide un voisin à savoir, une famille à s'organiser, un
quartier à se faire entendre — c'est ça, aider notre population : rendre
l'information locale à ceux qui la vivent.

Le projet a démarré comme un outil tunisien, et c'est toujours son cœur. Il
couvre aujourd'hui **deux pays — la Tunisie et la France métropolitaine** —
sur une seule base de code : mêmes écrans, même modèle d'incident, mais des
données strictement cloisonnées, des numéros d'urgence propres à chaque pays,
et des formats locaux (fuseau horaire, téléphone, géocodage). Le pays est
indépendant de la langue : on peut consulter la France en arabe et la Tunisie
en français.

Démo : **https://kifeh.app**

> ⚠️ Kifeh est une initiative citoyenne indépendante. Elle ne remplace ni les
> services d'urgence — **198/190/197/193** en Tunisie, **18/15/17/112/114** en
> France — ni les gestionnaires de réseaux (STEG, SONEDE, ou le gestionnaire
> indiqué sur votre facture en France). Les données communautaires et
> satellitaires ne sont **jamais** présentées comme des confirmations
> officielles.

## Ce que l'application fait vraiment

**Déclarer sans compte, en 4 étapes.** Type d'incident, position (GPS,
recherche d'adresse ou repère déplaçable), période, description. La position
publiée est **anonymisée** (~250 m) : l'adresse exacte n'est jamais montrée,
seul le déclarant et la modération y ont accès. La vérification par code
SMS/e-mail existe dans le code et s'active en un réglage ; elle est
volontairement **désactivée pour le moment** (pas encore de fournisseur SMS
branché), remplacée par un arsenal anti-abus : honeypot, délai minimal de
remplissage, limites par IP et par contact, score de confiance avec file de
modération, détection de doublons.

**Faire vivre l'information ensemble.** Un incident n'appartient pas à son
déclarant : n'importe qui peut dire « Je suis aussi concerné » (une seule fois
par personne — déduplication par appareil), « C'est toujours en cours »,
« C'est terminé » (appliqué immédiatement, réouvrable pendant 24 h si c'était
une erreur), ou proposer une correction de position qui part en modération.
Les incendies demandent une confirmation communautaire : trois personnes, avec
contrôle de proximité GPS.

**Regarder le ciel.** Toutes les 15 minutes, le serveur interroge la
**NASA (FIRMS)** — satellites VIIRS SNPP/NOAA-20/NOAA-21 et MODIS — zone par
zone, pays par pays. Les détections thermiques sont filtrées par les
frontières du pays, dédupliquées par empreinte, regroupées en « événements
incendie » et, quand elles tombent à moins de 2 km et 12 h d'un signalement
citoyen, elles le **corroborent** automatiquement. Un échec de synchronisation
côté France ne bloque jamais l'import tunisien, et réciproquement. La clé API
ne quitte jamais le serveur.

**Orienter vers les bons secours — et seulement les bons.** Après une
déclaration, un écran d'urgence affiche des numéros **vérifiés, du bon pays**,
selon le type d'incident : en Tunisie, Protection civile, urgences STEG,
numéro vert SONEDE ; en France, 18/112/15/17 et le 114 par SMS pour les
personnes sourdes ou malentendantes. Pour une panne ordinaire en France,
aucun numéro n'est « inventé » : le dépannage dépend du gestionnaire réel et
du département, l'écran renvoie donc vers la facture. Jamais un numéro
tunisien affiché en France, ni l'inverse.

**Fonctionner dans les conditions réelles.** L'application est pensée pour un
téléphone d'entrée de gamme sur une 3G instable : bilingue français/arabe avec
RTL complet, polices vendorisées (aucun CDN à l'exécution), bascule
automatique de fournisseur de tuiles si le fond de carte tombe, mode **Kifeh
Léger (كيفاه خفيف)** qui affiche la liste d'abord et la carte à la demande, et
un instantané hors-ligne toujours horodaté — jamais présenté comme actuel.

**S'administrer sans redéployer.** Modération, fusion de doublons, corrections
de localisation, supervision des synchronisations NASA, annuaire de contacts
d'urgence, journal d'audit, export CSV — et chaque réglage (seuils, fenêtres,
drapeaux de fonctionnalités, pays activés) modifiable à chaud.

**Les feux d'abord, en une seule donnée.** « Incendie » est la première
catégorie, et elle réunit **signalements citoyens et observations satellite
NASA dans une seule donnée feu** : un signalement corroboré par satellite
n'affiche qu'un marqueur (porteur des deux sources), le compteur de zone
additionne les deux en précisant la part satellite, et le résumé indique la
distance et la direction du feu le plus proche — à vol d'oiseau, jamais un
trajet. Quand un feu récent est à moins de 10 km, une bannière contextuelle
refermable propose « Voir la situation » ; à 200 km, aucune interface
anxiogène. Et l'absence de détection n'est jamais présentée comme une absence
de feu : « les satellites ne détectent pas tous les feux ».

**Comprendre la situation, pas seulement les points.** Côté France, la carte
affiche des « Conditions autour de moi » : chaleur locale (température,
ressenti, maximum du jour), vent contextuel autour des feux (modèle
Météo-France, jamais une prévision de propagation), et l'état de la
**Vigilance Météo-France** — les départements orange/rouge deviennent des
informations officielles horodatées et sourcées, avec marqueurs ⚠️ sur la
carte. Chaque source tombe en panne indépendamment, et « rien à signaler »
reste affiché : le silence visible vaut mieux que le silence muet.

**Rassurer ses proches sans s'exposer.** Pendant un incident grave, « Mon
statut de sécurité » (حالتي الآن) permet de dire « Je suis en sécurité » ou
« J'ai quitté la zone » — statut **personnel, privé et temporaire** (6 h/12 h),
partageable par lien sécurisé révocable, sans compte, sans GPS, sans jamais
compter dans les compteurs de l'incident. « J'ai besoin d'aide » affiche
immédiatement les numéros d'urgence du bon pays, avec un avertissement
honnête : Kifeh ne contacte jamais les secours à votre place.

**Revenir quand ça compte.** Alertes Web Push de zone (auto-hébergées, sans
service tiers), incidents et zones suivis localement, et « Depuis votre
dernière visite » qui ne s'affiche qu'après une vraie absence et seulement si
quelque chose d'important a changé — jamais de mécanique d'engagement
artificielle.

## Comment le projet s'est construit

Kifeh n'a pas été écrite d'un bloc. L'historique du dépôt raconte les étapes
réelles : un premier parcours de déclaration tunisien ; la perte — puis la
protection définitive — des données de production (disque persistant
auto-détecté, migrations exclusivement additives et idempotentes, sauvegardes
automatiques chaque minute, heure et jour, garde-fou anti-réinitialisation) ;
l'arrivée des fonctionnalités communautaires ; l'intégration NASA FIRMS ; une
couche de résilience réseau après des pannes de tuiles constatées en
conditions réelles ; un audit qualité complet avec correctifs et tests de
régression ; le passage en open source ; puis l'ouverture à un deuxième pays.
Chaque déploiement suit le même rituel : instantané de la production, suites
de tests complètes, simulation de migration sur une copie de l'ancienne base,
et vérification qu'aucun incident existant n'a disparu.

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
npm test             # suites API (multi-pays et NASA simulée incluses)
npm run test:browser # tests navigateur mobile FR/AR (Playwright)
```

## Configuration

Copiez [`.env.example`](.env.example). En production, renseignez au minimum
les trois `SECRET_*` (`openssl rand -hex 32`), `ADMIN_PASSWORD`, et
`NASA_FIRMS_MAP_KEY` ([clé gratuite](https://firms.modaps.eosdis.nasa.gov/api/map_key))
pour activer la couche satellite. Tout réglage applicatif — pays activés,
seuils communautaires, fenêtres NASA, fournisseurs de tuiles, drapeaux de
fonctionnalités — est surchargeable par variable d'environnement (nom en
MAJUSCULES) ou à chaud via l'administration : voir `defaultSettings` dans
[`src/config.js`](src/config.js). Guide de déploiement complet (Docker, VPS,
PaaS, sauvegardes) : [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md).

## Architecture

Node.js ≥ 20 · Express 5 · SQLite (better-sqlite3, WAL) · vanilla JS +
Leaflet, tout vendorisé. Temps réel par SSE. Pas de framework frontend, pas
d'étape de build : le code qui est dans le dépôt est celui qui s'exécute.

Le multi-pays repose sur des **profils déclaratifs** (`src/countries/`) :
frontières simplifiées (tracé côtier volontairement décalé vers le large pour
ne jamais exclure une ville réelle), fuseau horaire IANA, format téléphonique,
fournisseurs de géocodage (Géoplateforme IGN pour la France, Nominatim/Photon
en repli), zone NASA. Aucun `if (pays === 'FR')` dispersé : la configuration
change, pas le code. Les clients historiques sans paramètre pays restent
automatiquement sur la Tunisie.

```
server.js            point d'entrée, proxy sandbox, domaine canonique, healthz
src/config.js        configuration + réglages par défaut (tous surchargeables)
src/db.js            schéma + migrations additives idempotentes
src/countries/       profils pays déclaratifs (TN, FR) + validation géographique
src/routes/          public, declare, manage, admin, events (SSE)
src/services/        firms (NASA), otp, notifier, geocode, anonymize, dedup,
                     trust, media, scheduler (synchros + sauvegardes), crypto
public/              interface (carte, déclaration, gestion, admin, légal)
tests/               suites API + navigateur (~290 vérifications)
docs/                architecture, modèle de données, parcours, déploiement, marque
```

Détails : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) ·
[`docs/USER_FLOWS.md`](docs/USER_FLOWS.md) ·
[`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) ·
[`docs/BRAND.md`](docs/BRAND.md)

## Contribuer

Kifeh appartient à ceux qui s'en servent. Pas besoin d'être développeur pour
aider : **signaler les incidents autour de vous** est déjà la contribution la
plus précieuse ; en parler autour de vous en est une autre. Ensuite, par ordre
d'impact : améliorer les traductions arabes (dialecte tunisien bienvenu !),
tester l'accessibilité sur vos appareils, proposer de nouvelles sources de
données officielles, ajouter un profil pays, corriger du code.

Ouvrez une issue ou une pull request. Quelques règles simples : tout texte
visible doit exister en français ET en arabe ; chaque correction s'accompagne
d'un test de régression (`npm test` doit rester vert) ; aucun secret côté
client ; jamais un numéro d'urgence non vérifié ou d'un autre pays ; et les
données satellitaires ou communautaires ne sont **jamais** présentées comme
des confirmations officielles des autorités.

Sécurité et vie privée : toute réclamation à **contact@kifeh.org** (voir
[SECURITY.md](SECURITY.md)).

## Licence

[MIT](LICENSE) © 2026 Farah Chabchoub. Fond de carte © contributeurs
OpenStreetMap. Adresses France : Géoplateforme (IGN). Données incendies :
NASA FIRMS — We acknowledge the use of data from NASA's Fire Information for
Resource Management System (FIRMS).
