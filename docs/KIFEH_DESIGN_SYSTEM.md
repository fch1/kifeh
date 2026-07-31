# Kifeh — Design System

Inventaire FORMALISÉ de l'identité existante (addendum §2). Ce document décrit
ce qui EST — il n'invente rien. Toute nouvelle interface (mode feux MapLibre,
replay, panneau sources, situation locale) consomme les tokens `--kifeh-*`
d'`app.css` : **aucune couleur, rayon ou taille codés en dur**, aucun second
système graphique, aucune identité « Kifeh Fire » autonome.

Référence marque complète : `docs/BRAND.md`. Flamap est un repère d'expérience
cartographique et de performance — jamais un modèle de marque.

## 1. Couleurs

| Token | Alias de | Valeur | Usage |
|---|---|---|---|
| `--kifeh-color-primary` | `--primary` | `#1E2A4D` | marine — structure, textes forts, boutons |
| `--kifeh-color-primary-hover` | `--primary-dark` | `#141D38` | survol/appui |
| `--kifeh-color-accent` | `--brand-red` | `#E8432E` | rouge Kifeh — action principale, marque |
| `--kifeh-color-accent-hover` | `--brand-red-dark` | `#C4331F` | survol/appui |
| `--kifeh-color-background` | `--bg` | `#FAF7F1` | crème — fond général |
| `--kifeh-color-surface` | `--surface` | `#FFFFFF` | cartes, feuilles, champs |
| `--kifeh-color-text` | `--text` | `#1E2A4D` | texte courant |
| `--kifeh-color-text-muted` | `--muted` | `#5C6B79` | secondaire, légendes |
| `--kifeh-color-border` | `--border` | `#E7E1D6` | filets, séparateurs |
| `--kifeh-status-danger` | `--danger` | `#C7392F` | erreurs, danger |
| `--kifeh-status-success` | `--ok` | `#1E7F52` | confirmations |
| `--kifeh-status-warning` | `--warn` | `#9A6A00` | avertissements |
| `--kifeh-status-info` | `--primary` | `#1E2A4D` | information neutre |
| `--kifeh-type-fire` | `--fire` | `#E8432E` | incendie |
| `--kifeh-type-electricity` | `--elec` | `#F0A400` | électricité |
| `--kifeh-type-water` | `--water` | `#1B76B4` | eau |
| `--kifeh-type-internet` | `--internet` | `#33415C` | internet |

Règles : le rouge porte l'ACTION et la marque, jamais l'ambiance — pas de
couleurs anxiogènes hors contexte opérationnel (un état « danger » est un état
de donnée, pas une dramatisation). Le marine structure ; le crème respire.

## 2. Typographies

IBM Plex Sans (latin) / IBM Plex Sans Arabic — VENDORISÉES (`public/vendor/
fonts/`, aucun appel réseau), graisses 400/600/700. L'arabe n'est jamais une
langue secondaire : même famille, mêmes tailles, interlignage 1.6 pour les
paragraphes. Échelle typographique UNIQUE (5 crans, jamais d'autre valeur) :
`--kifeh-fs-xs` .6875rem · `sm` .8125rem · `md` .9375rem · `lg` 1.0625rem ·
`xl` 1.25rem.

## 3. Espacements, rayons, ombres

Espacements : `--kifeh-space-1..4` (.25 / .5 / .875 / 1.25 rem). Rayons :
`sm` 8px (badges) · `md` 14px (boutons, champs, cartes) · `lg` 20px (feuilles)
· `pill` 999px (pastilles) · 50% (marqueurs ronds). Ombre unique :
`--kifeh-shadow` (0 2px 14px rgba(30,42,77,.14)). Cible tactile ≥ 48px
(`--kifeh-tap`).

## 4. Composants inventoriés

- **Boutons** `.btn` (marine plein), `.secondary` (surface + filet),
  `.danger`, `.ghost`, `.small-btn` — largeur 100 % mobile, min-height 48px.
- **Champs** : filet `--kifeh-color-border`, focus visible 3px marine à 40 %.
- **Cartes/fiches** : surface blanche, rayon md, ombre unique.
- **Feuilles basses** (bottom sheets) : rayon lg en haut, poignée, z 1500,
  padding-bas 4.75rem mobile (la navigation reste cliquable au-dessus).
- **Navigation basse** : 5 destinations FIXES (Carte · Situation · + Signaler
  · Suivis · Aide), z 1600, pilule flottante ≥ 900px.
- **Marqueurs carte** (langage des campagnes) : cercle BLANC, anneau de la
  couleur du type ; feu actif = disque rouge plein + flamme blanche ;
  détections satellite = anneau pointillé. Fusion visuelle feux/satellite.
- **Carte héro** (résumé) : badge d'état (flamme rouge / triangle marine /
  coche verte), titre par la notion d'INCIDENTS, ligne satellites secondaire,
  rangée de 3 statistiques (vent / température / humidité).
- **Icônes** : SVG inline, trait 2px `currentColor` (navigation + FABs) ;
  les émojis restent réservés au CONTENU (types d'incident dans les textes).
- **États d'alerte** : capsule de confiance, badges de statut (actif/terminé),
  voyants de fraîcheur par source (fresh/delayed/stale/unavailable — libellés
  i18n `sources.freshness_*`).

## 5. Responsive et RTL

Points de repère testés : 320 / 375 / 768 / 900 / 1280 / 1440 px. Mobile
d'abord ; ≥ 900px la navigation devient pilule flottante centrée. RTL : gabarit
miroir complet (`dir="rtl"`), propriétés logiques (`inset-inline-end`…),
flèches retournées (`scaleX(-1)`), MAIS éléments techniques toujours LTR avec
`dir="ltr"` explicite : codes DFCI, coordonnées GPS, URLs, FRP, noms de
satellites, dates ISO, numéros d'urgence.

## 6. Règles non négociables (apprises en production)

1. **AUCUN enfant `position:fixed` sous un ancêtre transformé** (la pilule de
   navigation desktop utilise `translateX(-50%)` : un enfant fixed s'y
   positionne par rapport à la boîte, pas au viewport — régression du 28/07).
2. **Échelle z-index unique** (`--kifeh-z-*`) : 1 carte · 900 FABs · 1000
   en-têtes · 1200 bannières · 1400 superpositions · 1500 feuilles · 1600
   navigation. Jamais de valeur inventée localement.
3. **Survols uniquement sous `@media (hover: hover)`** (sinon `:hover` colle
   après un tap sur mobile) ; `:active` toujours défini.
4. **Tailles de texte** : uniquement l'échelle `--kifeh-fs-*`.
5. **Toute donnée affichée porte sa source et son horodatage** ; libellé
   « quasi temps réel » — jamais « temps réel » ni « en direct ».
6. **FR + AR à parité** dans le même déploiement — une fonctionnalité
   monolingue n'est pas terminée.

## 7. Processus d'évolution

Toute évolution du design system précise dans sa PR : raison, portée,
compatibilité, impact sur l'existant, migration, validation produit. Les
captures de référence (320/375/768/1280/1440 px, FR + AR) servent de
non-régression de marque. Les tokens ne se renomment pas ; on ALIASE.
