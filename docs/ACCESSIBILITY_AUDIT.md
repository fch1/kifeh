# Kifeh — Audit d'accessibilité WCAG 2.2 AA (#95)

*03/08/2026 — outil : `node tests/a11y-audit.mjs` (axe-core 4.12 + mesures
maison : cibles tactiles, focus visible), 7 vues (accueil fr/ar RTL, filtres,
calques, situation, déclaration, safety), mobile 390 px. Données brutes :
`docs/audit/a11y-results.json`. Règle du plan respectée : les corrections
INVISIBLES sont livrées immédiatement ; les corrections VISIBLES attendent la
validation Farah (intégrées à la passe maquettes de la Phase 1).*

## Synthèse

**État remarquablement sain pour une SPA carto** : 0 focus invisible sur
toutes les vues (chaque élément tabbable a son indicateur), 0 piège clavier
détecté, formulaires étiquetés, RTL sans défaut propre, page safety 100 %
propre. **4 constats réels** : 3 contrastes sous 4,5:1 (sérieux) et
1 imbrication d'éléments interactifs (corrigée).

| # | Constat | Critère | Sévérité | Statut |
|---|---|---|---|---|
| 1 | Chevron de repli imbriqué dans la carte héro focusable (`#heroToggle` dans `#heroHead[role=button]`) | 4.1.2 Nom, rôle, valeur | 🟡 Majeur | ✅ **CORRIGÉ** (invisible : `#heroOpen` porte seul le rôle, chevron devenu frère — rendu au pixel identique, captures 10/10) |
| 2 | Libellé « Déclarer » de la barre basse : #E8432E sur blanc = **3,98:1** (11 px gras, requis 4,5) | 1.4.3 Contraste | 🔴 Sérieux | ⏳ GATED — proposition ci-dessous |
| 3 | Bouton « Accepter » du bandeau de consentement : blanc sur #C4622D = **4,09:1** (13 px) | 1.4.3 Contraste | 🔴 Sérieux | ⏳ GATED — proposition ci-dessous |
| 4 | Bouton de langue (header) : transparent au-dessus de la carte → contraste VARIABLE selon l'imagerie (mesuré 4,03:1 sur fond neutre) | 1.4.3 Contraste | 🟡 Majeur | ⏳ GATED — proposition ci-dessous |
| 5 | `#followZoneCta` (« Suivre cette zone ») : zone tactile 126×20 px | 2.5.8 Taille de cible | 🟢 Mineur | ⏳ GATED (padding vertical à prévoir dans la refonte du héro) |

Faux positifs écartés honnêtement : les cases à cocher des filtres (22×22 px)
vivent dans des `<label class="checkbox-row">` — la cible EFFECTIVE est
l'étiquette entière, conforme (axe target-size ne les signale pas) ; les
liens fins (14-17 px de haut) sont des liens EN LIGNE dans du texte,
exemptés par le critère 2.5.8.

## Contrastes mesurés (axe, valeurs réelles)

| Élément | Texte | Fond | Ratio | Requis | Verdict |
|---|---|---|---|---|---|
| Corps de texte | #1E2A4D | #FAF7F1 | 13,15:1 | 4,5:1 | ✅ |
| Texte atténué sur fond | #5C6B79 | #FAF7F1 | 5,12:1 | 4,5:1 | ✅ |
| Blanc sur marine (urgence) | #FFFFFF | #1E2A4D | 14,06:1 | 4,5:1 | ✅ |
| « Déclarer » (nav basse) | #E8432E | #FFFFFF | **3,98:1** | 4,5:1 | ❌ |
| « Accepter » (consentement) | #FFFFFF | #C4622D | **4,09:1** | 4,5:1 | ❌ |
| Bouton langue (sur carte) | #5C6B79 | variable | **≥4,03:1 non garanti** | 4,5:1 | ❌ |

## Propositions pour la passe visible (validation Farah — Phase 1)

Trois retouches minuscules, identité préservée :

1. **Jeton `--brand-red-text: #C93318`** pour le rouge Kifeh EN TEXTE PETIT
   sur fond clair (5,29:1) — le rouge #E8432E reste le rouge des SURFACES
   (boutons pleins avec texte blanc ≥ 18 px, marqueurs). Seul le libellé
   « Déclarer » de la barre basse change de valeur — à l'œil, un rouge un
   ton plus profond.
2. **Bandeau de consentement : boutons sur #A04E1E** (terracotta assombrie,
   5,83:1) ou passage au marine #1E2A4D (14:1) — au choix sur maquette.
3. **Bouton de langue : fond `--surface` (blanc) permanent** au lieu de
   transparent — le contraste ne dépend plus de l'imagerie de la carte
   au-dessous. (Le style « survol » actuel devient le style de repos.)

## Ce que l'audit n'attrape pas (et la suite)

L'automatique couvre ~30 % des critères. Le reste passe par le **protocole
de tests utilisateurs** (`docs/PROTOCOLE_TESTS_UTILISATEURS.md`, 8 questions,
2-3 personnes non expertes — côté Farah) et une passe lecteur d'écran réelle
(VoiceOver/TalkBack) à faire sur appareil. Zoom 200 % : à vérifier lors de la
passe maquettes mobile (#102). L'outil d'audit reste dans le dépôt et se
relance en une commande après chaque évolution d'interface.
