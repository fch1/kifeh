# Configuration de production — Kifeh كيفاه

Référence complète des variables d'environnement et des intégrations, dans
l'état réel du code. Sur Render : Settings → Environment (ou un Secret File
`.env`). Après toute modification, redéployer.

Principe de sécurité : **aucune clé n'est jamais dans le dépôt, jamais dans le
frontend, jamais dans les journaux.** Les clés vivent uniquement dans les
variables d'environnement du serveur.

---

## 1. Indispensables (le service ne doit pas tourner sans)

| Variable | Rôle | État attendu |
|---|---|---|
| `NODE_ENV` | `production` | ✅ géré par Render |
| `SECRET_ENCRYPTION_KEY` | chiffrement au repos (contacts, e-mails) | ✅ posée — à ne JAMAIS changer sans plan de migration : les données chiffrées deviendraient illisibles |
| `SECRET_HMAC_KEY` | empreintes (recherche d'un e-mail sans le stocker en clair) | ✅ posée — même prudence |
| `SECRET_COOKIE_KEY` | signature des sessions admin | ✅ posée |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | compte administrateur | ✅ posées |

Base de données : rien à configurer. Le disque persistant Render (`/var/data`)
est détecté automatiquement (`incidents.db`, `uploads/`, sauvegardes
minute/heure/jour dans `backups/`). `DB_PATH`/`UPLOADS_DIR` n'existent que
pour les cas particuliers.

Domaine : `CANONICAL_HOST` inutile — `kifeh.app` est le domaine canonique par
défaut en production (alias redirigés en 301, `/healthz` jamais redirigée).

## 2. Intégrations de données — état réel

| Intégration | Variable(s) | État | Vérification |
|---|---|---|---|
| NASA FIRMS (feux satellite) | `NASA_FIRMS_MAP_KEY` | ✅ active | `healthz → firms.lastSuccess` |
| Vigilance Météo-France | `METEOFRANCE_API_KEY` | ✅ active — **la clé expire le 27/10/2026**, à régénérer sur portail-api.meteofrance.fr avant cette date | `healthz → vigilance.lastSuccess` |
| Météo & vent (Open-Meteo) | — aucune clé | ✅ active | ligne météo sur l'accueil |
| Zones brûlées (Copernicus EFFIS) | — aucune clé | ✅ active | `healthz → effis.count` |
| Alertes e-mail (Resend) | `RESEND_API_KEY` | ✅ active, MAIS le domaine `kifeh.app` n'est pas encore vérifié chez Resend → repli automatique sur l'expéditeur bac à sable (`onboarding@resend.dev`), qui ne délivre qu'à l'adresse du compte Resend. **Terminer la vérification DNS dans le tableau de bord Resend** pour envoyer à tout le monde depuis `alertes@kifeh.app` | `healthz → emailAlerts.configured` |
| | `RESEND_FROM` | optionnelle — par défaut `Kifeh <alertes@kifeh.app>` dès le domaine vérifié | |
| Notifications push (VAPID) | — aucune | ✅ clés générées et conservées automatiquement dans la base au premier démarrage | bouton « Suivre cette zone » |
| Google Analytics (Consent Mode v2) | `GA_MEASUREMENT_ID` | optionnelle — `G-B33KFSSPSG` intégré par défaut | bannière de consentement |
| Fond de carte (OSM + repli) | — aucune clé | ✅ active | |

## 3. Recommandées, pas encore posées

| Variable | Rôle |
|---|---|
| `GITHUB_BACKUP_TOKEN` | sauvegarde quotidienne **hors-site chiffrée** de la base vers un dépôt privé. Créer un *fine-grained token* limité au dépôt de sauvegarde (Contents : Read and write). Aujourd'hui `healthz → offsite.configured = false` : les sauvegardes existent uniquement sur le disque Render |
| `GITHUB_BACKUP_REPO` | ex. `fch1/kifeh-backups` (dépôt privé dédié) |
| `SANDBOX_ENABLED=1` | active `/sandbox` (démonstrations sans toucher aux vraies données) — déjà posée si tu veux la garder |

## 4. Optionnelles / inactives par choix

- **OTP / SMS** : volontairement désactivé. `NOTIFIER_DRIVER`, `SMTP_*`,
  `TWILIO_*` restent inutilisées tant que c'est le cas.
- **Géocodage** : `NOMINATIM_URL`, `PHOTON_URL`, `GEOCODE_VIEWBOX` — les
  services publics par défaut suffisent.
- **`WEB_PUSH_DISABLED=1`** : coupe le push (tests uniquement, jamais en prod).
- **`ADMIN_TOTP_RESET=1`** : réinitialise le 2FA admin au prochain démarrage
  (dépannage uniquement, à retirer aussitôt).
- **Surcharges de test** (jamais en production) : `WIND_URL`, `VIGILANCE_URL`,
  `EFFIS_URL`, `RESEND_URL`, `FIRMS_URL`, `EFFIS_WINDOW_DAYS`,
  `EFFIS_TIMEOUT_MS`, `FIRMS_TIMEOUT_MS`.

## 5. Drapeaux applicatifs (dans la base, pas des variables)

Réglables via l'écran admin (table `settings`) : `fire_situation_enabled_fr`
(expérience France), `effis_enabled`, `vigilance_enabled`, cadences
(`firms_sync_interval_min`, `effis_sync_interval_min`)… Tous actifs par
défaut : **rien à faire** pour que la France fonctionne.

## 6. Contrôle après chaque déploiement

`https://kifeh.app/healthz` doit montrer : `ok: true`, le nombre d'incidents
attendu, et `lastSuccess` récent pour `firms`, `vigilance`, `effis` —
plus `emailAlerts.configured: true`. C'est la preuve vérifiable que toutes
les intégrations tournent.

## 7. Hygiène des clés (rappel important)

Toute clé qui a transité par un chat ou un e-mail doit être considérée comme
exposée et **régénérée** : clé NASA FIRMS, clé Resend, jetons GitHub. Pour les
jetons GitHub : en créer de nouveaux *fine-grained*, révoquer les anciens —
et prévenir avant la révocation si un accès automatisé s'en sert encore.
