# Écrans

Correspondance entre les 20 écrans demandés et les pages/vues livrées. Le frontend est une petite « multi-page app » : chaque page HTML embarque plusieurs écrans sous forme de vues (adapté WebView : peu de rechargements, deep links simples).

| # | Écran demandé | Implémentation |
|---|---|---|
| 1 | Accueil avec carte publique | `index.html` — carte Leaflet plein écran, bouton « Déclarer un incident », compteur, filtres rapides ⚡💧🔥 |
| 2 | Recherche d'adresse | `index.html` — barre de recherche avec autocomplétion (Nominatim), recentrage |
| 3 | Filtres des incidents | `index.html` — panneau filtres : type, statut, période, « en cours uniquement » |
| 4 | Vue liste des incidents | `index.html` — onglet Liste, tri proximité / début / gravité |
| 5 | Détail public d'un incident | `index.html` — feuille de détail (bottom sheet) + « Je suis aussi concerné » |
| 6 | Choix du type d'incident | `declare.html` — étape 1, avertissement urgence pour 🔥 |
| 7 | Autorisation et confirmation de la localisation | `declare.html` — étape 2, mini-carte, marqueur déplaçable |
| 8 | Saisie manuelle de l'adresse | `declare.html` — étape 2 (repli), autocomplétion + pointage manuel |
| 9 | Choix de la période et du statut temporel | `declare.html` — étape 3, bouton « Maintenant », contrôle fin ≥ début, « heure approximative » |
| 10 | Description et niveau de gravité | `declare.html` — étape 4 |
| 11 | Ajout facultatif de photo ou vidéo | `declare.html` — étape 4 (caméra/galerie via `<input capture>`) |
| 12 | Choix du téléphone ou de l'e-mail | `declare.html` — étape 5 + consentement obligatoire |
| 13 | Saisie du code OTP | `declare.html` — étape 6 (SMS ou code e-mail), renvoi avec compte à rebours |
| 14 | Écran « consultez votre e-mail » | `declare.html` — étape 6, variante lien e-mail |
| 15 | Confirmation de la déclaration | `declare.html` — écran final : INC-XXXXXX, récapitulatif, lien de gestion |
| 16 | Gestion et clôture d'une déclaration | `manage.html?token=…` — toujours en cours / terminé / modifier / supprimer / erreur de localisation |
| 17 | Signalement d'un contenu incorrect | `index.html` — depuis la fiche détail (motif + envoi) |
| 18 | Interface d'administration | `admin.html` — file d'attente, fiche, fusion, modération, contacts, rôles |
| 19 | Tableau de bord statistique | `admin.html` — onglet Statistiques (agrégats par type/statut/jour) |
| 20 | Confidentialité, CGU, informations d'urgence | `legal.html` — trois sections + numéros d'urgence (112, 18, 15, 17) |

Pages supplémentaires : `verify.html` (atterrissage du lien e-mail, usage unique, redirection vers la confirmation).

## Principes UI

- Mobile-first, cibles tactiles ≥ 48 px, contrastes AA, navigation clavier, `aria-*` et libellés pour lecteurs d'écran.
- Barre de progression sur les 6 étapes ; retour arrière sans perte (brouillon en localStorage).
- États de chargement squelettes + messages d'erreur précis et actionnables ; bannière hors-ligne ; boutons désactivés pendant soumission (anti double-clic) + clé d'idempotence côté API.
- Codes visuels : ⚡ électricité (ambre), 💧 eau (bleu), 🔥 incendie (rouge), • autre (violet) ; formes distinctes pour daltonisme.
