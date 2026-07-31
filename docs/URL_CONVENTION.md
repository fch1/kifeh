# Convention d'URL — langue ET territoire (addendum §16)

Décision GRAVÉE avant toute création de route (le Lot 2 et le SEO serveur la
consomment). `fr` seul est ambigu (français ? France ?) — la convention
distingue TOUJOURS les deux notions, car langue ≠ pays ≠ position.

## Schéma

    /{langue}/{territoire}/{sujet}

- `langue` ∈ `fr` | `ar` (langues de l'interface, parité obligatoire) ;
- `territoire` ∈ `fr` | `tn` (codes ISO minuscules des pays du registre) ;
- `sujet` : `incendies` d'abord (Lot 2), extensible.

Variantes SERVIES (uniquement celles réellement prises en charge — jamais de
variante fantôme) :

    /fr/fr/incendies   (français, France)
    /ar/fr/incendies   (arabe, France — RTL, contenus français localisés)
    /fr/tn/incendies   (français, Tunisie — capacités tunisiennes uniquement)
    /ar/tn/incendies   (arabe, Tunisie)

## Règles d'application

1. **Canonical** : chaque page pointe sa propre combinaison exacte.
2. **hreflang** : les 4 variantes se déclarent mutuellement —
   `fr-FR`, `ar-FR`, `fr-TN`, `ar-TN` + `x-default` → `/fr/fr/incendies`
   (audience française la plus large pour le mode avancé ; à réévaluer aux
   données réelles). `hreflang` n'énumère QUE les variantes servies.
3. **Sitemap** : une entrée par variante servie, sitemaps distincts par
   territoire si le volume le justifie (Lot SEO).
4. **Partage / Open Graph** : l'URL partagée conserve langue + territoire +
   état de carte (`#map=z/lat/lng&time=&layers=` — le hash ne casse ni le
   canonical ni le cache).
5. **API** : les API restent NEUTRES (`/api/…?country=XX&lang=yy`) — la
   convention ne s'applique qu'aux pages destinées aux moteurs et aux humains.
6. **Analytics** : dimension langue et dimension territoire séparées (jamais
   une seule dimension fusionnée).
7. **Redirections** : `/{langue}/{territoire}` sans sujet → la carte du
   territoire. Aucune redirection par géolocalisation silencieuse : consulter
   la Tunisie depuis Paris est un usage de premier rang (diaspora).
8. **Contenu localisé, jamais traduit mécaniquement** : une page `*/tn/*`
   n'affiche ni EFFIS, ni DFCI, ni AROME, ni le 18/112 — elle affiche les
   sources tunisiennes disponibles, le 198 (Protection civile) et le fuseau
   Africa/Tunis (registre des capacités : `/api/public/capabilities`).

## Ce que la convention interdit

- `/fr/incendies` (ambigu — n'existera jamais ; si tapé, 301 vers
  `/fr/fr/incendies`) ;
- déduire la langue du territoire ou réciproquement ;
- générer des `hreflang` vers des pages non servies ;
- des URLs différentes pour un même contenu sans canonical.
