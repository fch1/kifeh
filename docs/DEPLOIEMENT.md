# Guide de déploiement — Kifeh كيفاه

Trois options, de la plus simple à la plus maîtrisée. Dans tous les cas :
HTTPS obligatoire (géolocalisation navigateur, cookies admin, WebView iOS).

## 0. Prérequis communs

1. **Générer les secrets** (à faire une seule fois, à conserver précieusement) :

```bash
openssl rand -hex 32   # → SECRET_ENCRYPTION_KEY
openssl rand -hex 32   # → SECRET_HMAC_KEY
openssl rand -hex 32   # → SECRET_COOKIE_KEY
```

⚠️ `SECRET_ENCRYPTION_KEY` chiffre les contacts en base : si vous la perdez,
les contacts existants deviennent illisibles ; si vous la changez, idem.

2. **Compte SMS** : créer un compte Twilio (ou équivalent), acheter/valider un
expéditeur SMS pour la Tunisie (+216), récupérer `TWILIO_SID`, `TWILIO_TOKEN`,
`TWILIO_FROM`. Tant que `NOTIFIER_DRIVER=dev`, rien n'est envoyé (les codes
sont dans les logs) — pratique pour la recette.

3. **Nom de domaine** pointant vers votre serveur (ex. `kifeh.tn`).

---

## Option A — Docker (recommandée)

```bash
# Sur le serveur (Docker + docker compose installés)
git clone <votre-dépôt> kifeh && cd kifeh
cat > .env <<'ENV'
SECRET_ENCRYPTION_KEY=...
SECRET_HMAC_KEY=...
SECRET_COOKIE_KEY=...
ADMIN_PASSWORD=un-mot-de-passe-fort
NOTIFIER_DRIVER=twilio
TWILIO_SID=ACxxxx
TWILIO_TOKEN=xxxx
TWILIO_FROM=+216xxxxxxxx
ENV
# Éditer docker-compose.yml : BASE_URL=https://votre-domaine
docker compose up -d --build
```

L'app écoute sur le port 3000. Placer devant un reverse proxy HTTPS (voir §C).
Les données persistent dans les volumes `kifeh_data` (SQLite) et `kifeh_uploads`.

Mise à jour : `git pull && docker compose up -d --build` (zéro migration à
lancer : le schéma se migre tout seul au démarrage).

## Option B — VPS classique (Node + systemd)

```bash
# Ubuntu/Debian — Node 20+ requis
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs
sudo useradd -r -m -d /opt/kifeh kifeh
sudo -u kifeh git clone <votre-dépôt> /opt/kifeh/app
cd /opt/kifeh/app && sudo -u kifeh npm ci --omit=dev
```

`/etc/systemd/system/kifeh.service` :

```ini
[Unit]
Description=Kifeh
After=network.target

[Service]
User=kifeh
WorkingDirectory=/opt/kifeh/app
EnvironmentFile=/opt/kifeh/kifeh.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
# Durcissement
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/kifeh/app/data /opt/kifeh/app/uploads

[Install]
WantedBy=multi-user.target
```

`/opt/kifeh/kifeh.env` (chmod 600) :

```
NODE_ENV=production
PORT=3000
BASE_URL=https://kifeh.tn
SECRET_ENCRYPTION_KEY=...
SECRET_HMAC_KEY=...
SECRET_COOKIE_KEY=...
ADMIN_PASSWORD=...
NOTIFIER_DRIVER=twilio
TWILIO_SID=...
TWILIO_TOKEN=...
TWILIO_FROM=...
```

```bash
sudo systemctl enable --now kifeh
journalctl -u kifeh -f     # logs
```

## C. Reverse proxy HTTPS (nginx + Let's Encrypt)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/kifeh` :

```nginx
server {
    server_name kifeh.tn;
    client_max_body_size 12m;                # uploads photos

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host $host;
        # Server-Sent Events (temps réel) :
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/kifeh /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d kifeh.tn      # HTTPS automatique + renouvellement
```

**Important** : derrière le proxy, décommenter `app.set('trust proxy', 1)` dans
`server.js` pour que le rate limiting par IP fonctionne sur les vraies IP.

## Option D — PaaS (Render, Railway, Fly.io…)

Le projet est un simple serveur Node avec état sur disque (SQLite + uploads) :
choisir une offre avec **volume persistant** (Fly.io volumes, Railway volumes,
Render disks). Build : `npm ci` ; start : `node server.js` ; définir les
variables d'environnement du §0 ; monter le volume sur `/app/data` et
`/app/uploads`. Les plateformes 100 % éphémères (sans disque) nécessiteraient
de migrer vers PostgreSQL + stockage objet — hors périmètre du MVP.

---

## Après la mise en ligne — checklist

1. `https://votre-domaine/` répond, la carte s'affiche (Tunisie), FR ↔ AR bascule.
2. `https://votre-domaine/admin.html` → connexion, **changer le mot de passe admin**
   (via `ADMIN_PASSWORD` avant premier démarrage, ou recréer le compte).
3. Configuration admin : vérifier rayon d'anonymisation, TTL, limites anti-spam ;
   activer la catégorie « Autre » si souhaité.
4. Test de bout en bout réel : déclarer un incident avec un vrai numéro +216 →
   SMS reçu → publication → lien de gestion reçu → clôture.
5. Le temps réel fonctionne : ouvrir la carte sur deux appareils, publier sur
   l'un, voir le marqueur apparaître sur l'autre sans recharger (SSE).
6. Sauvegardes : cron quotidien `npm run backup` (copie à chaud de SQLite) +
   copie hors serveur du dossier `data/` et `uploads/`.

```cron
0 3 * * * cd /opt/kifeh/app && /usr/bin/node -e "import('./src/db.js').then(m=>m.backup())" && find data -name '*.backup-*' -mtime +14 -delete
```

7. Géocodage : le MVP utilise le Nominatim public (limité à ~1 req/s). Pour un
   vrai lancement, héberger sa propre instance Nominatim (extrait Tunisie
   d'OpenStreetMap, ~2 Go) et définir `NOMINATIM_URL`. Idem pour les tuiles de
   carte : en forte charge, utiliser un fournisseur de tuiles (MapTiler, Stadia…)
   ou son propre serveur de tuiles, et mettre à jour l'URL dans
   `public/js/map-common.js` + la CSP dans `src/middleware/security.js`.
8. E-mail : pour la vérification par e-mail en production, installer nodemailer
   et compléter le pilote SMTP dans `src/services/notifier.js` (une dizaine de
   lignes, indiqué en commentaire), puis `NOTIFIER_DRIVER=smtp`.

## Intégration WebView (iOS / Android)

- Charger simplement `https://votre-domaine/` dans la WebView.
- Autoriser la géolocalisation dans la WebView (iOS : `WKWebView` +
  autorisations Info.plist ; Android : `WebChromeClient.onGeolocationPermissionsShowPrompt`).
- Autoriser l'upload de fichiers (Android : `onShowFileChooser`).
- Déclarer les liens `https://votre-domaine/manage.html*` et `verify.html*`
  comme universal links / app links pour que les liens SMS et e-mail rouvrent
  l'application.
