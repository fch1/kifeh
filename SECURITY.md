# Politique de sécurité

Kifeh traite des signalements citoyens et des coordonnées de contact
chiffrées : la sécurité est prise au sérieux.

## Signaler une vulnérabilité

Merci de signaler toute faille **en privé**, sans ouvrir d'issue publique :

- e-mail : **contact@kifeh.org** (objet : `[Kifeh sécurité]`)

Décrivez le problème, les étapes de reproduction et l'impact estimé. Vous
recevrez une réponse sous 72 h. Nous vous créditerons dans les notes de
version si vous le souhaitez.

## Périmètre

Sont particulièrement sensibles : l'exposition de positions exactes ou de
contacts, le contournement des limites anti-abus, l'injection (XSS/SQL),
l'accès non autorisé à l'administration ou aux liens de gestion, et toute
fuite de clé côté client.

Merci de ne pas tester sur les données réelles des utilisateurs : utilisez
l'environnement de test `kifeh.app/sandbox` (données fictives, purge
automatique) ou une instance locale.
