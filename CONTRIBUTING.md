# Contribuer à Kifeh كيفاه

Merci de vouloir faire grandir ce bien commun ! 🇹🇳

Kifeh est un projet bénévole : nous répondons à toute première issue ou pull
request **sous 48 h**, mais le support n'est pas garanti 24/7.

## Cinq façons de contribuer (une seule demande de savoir coder)

1. **Code** — prenez une issue étiquetée [`good first issue`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
2. **Langue** — améliorer l'arabe, le rapprocher du parler tunisien là où c'est
   naturel (`public/js/i18n.js` côté interface, `src/i18n.js` côté serveur).
3. **Design & accessibilité** — petits écrans, contrastes, lecteurs d'écran, RTL.
4. **Terrain** — tester kifeh.org en 3G réelle, sur un téléphone d'entrée de
   gamme ou dans un WebView, et ouvrir une issue avec captures. C'est une
   contribution de premier ordre.
5. **Données** — annuaires officiels vérifiés (contacts régionaux, districts),
   toujours avec la source et la date. Jamais de donnée inventée.

## Démarrer en local

```bash
npm install
npm run dev          # http://localhost:3000 — aucune configuration nécessaire
npm test             # les suites API doivent rester vertes
```

## Règles du projet

- **Bilinguisme obligatoire** : tout texte visible existe en français ET en
  arabe (RTL). Une PR qui ajoute un texte dans une seule langue sera renvoyée
  gentiment.
- **Un correctif = un test** : chaque correction de bug s'accompagne d'un test
  de régression (`tests/`).
- **Jamais de secret côté client**, jamais de position exacte publiée, jamais
  de donnée personnelle en clair.
- **Honnêteté des sources** : les données satellitaires (NASA FIRMS) et
  communautaires ne sont **jamais** présentées comme des confirmations
  officielles des autorités. C'est un principe fondateur, non négociable.
- **Migrations additives uniquement** : on n'efface ni ne réécrit jamais les
  données existantes.

## Processus

Ouvrez une issue avant les gros changements (pour discuter), une PR directe
pour les petits. Décrivez ce que vous avez testé. Le français est la langue de
travail du dépôt ; l'anglais est bienvenu aussi.

## Sécurité

Une faille ? Merci de **ne pas** ouvrir d'issue publique — voir
[SECURITY.md](SECURITY.md).
