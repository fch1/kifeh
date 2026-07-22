# Parcours utilisateurs

## 1. Consultation publique (sans compte)

```
Accueil (carte)
 ├─ voir les incidents actifs / récemment résolus (marqueurs groupés, code couleur par type)
 ├─ « Ma position » (avec consentement géolocalisation uniquement)
 ├─ rechercher une adresse / ville / code postal / quartier → recentrage carte
 ├─ filtres : type (⚡💧🔥•), statut, période, « en cours uniquement »
 ├─ compteur d'incidents visibles dans la zone
 ├─ basculer en vue liste (tri : proximité · début · gravité)
 └─ toucher un incident → fiche détail publique
       type · zone approximative · début · statut · dernière mise à jour ·
       « N personnes ont confirmé » · description modérée · fin si résolu
       ├─ « Je suis aussi concerné » → mini-vérification contact → +1 confirmation
       └─ « Signaler un contenu incorrect »
```

Aucune donnée sensible n'est affichée : ni contact, ni nom, ni adresse exacte, ni coordonnées GPS exactes.

## 2. Déclaration d'un incident (6 étapes, barre de progression, retour possible sans perte)

```
[Bouton « Déclarer un incident »]
   │  (brouillon sauvegardé en localStorage à chaque étape)
   ▼
É1. Type d'incident : ⚡ Électricité · 💧 Eau · 🔥 Incendie · ➕ Autre (si activé)
   │  🔥 Incendie → bandeau prioritaire :
   │  « En cas de danger immédiat, éloignez-vous de la zone et contactez les
   │    services d'urgence (112 / 18). Cette déclaration ne déclenche pas
   │    automatiquement l'intervention des secours. »
   ▼
É2. Localisation
   ├─ Autorisation géolocalisation demandée proprement
   │   ├─ acceptée → point sur mini-carte, déplaçable, adresse résolue (géocodage inverse)
   │   └─ refusée / indisponible / imprécise → recherche d'adresse avec
   │      autocomplétion OU positionnement manuel du point sur la carte
   │  ⓘ « Votre adresse exacte ne sera jamais publiée : la carte publique
   │     affiche une position approximative (~250 m). »
   ▼
É3. Période
   ├─ « En cours » → début (bouton [Maintenant]), pas d'heure de fin,
   │   case « heure approximative », rappel qu'on pourra clôturer plus tard
   └─ « Terminé » → début + fin, contrôle fin ≥ début
   ▼
É4. Détails : description courte · gravité (faible/modéré/important/danger immédiat)
   · logements affectés (facultatif) · photo/vidéo (facultatif, EXIF retiré)
   · commentaire (facultatif)
   ▼
   ── Détection de doublons ──
   Si un incident similaire existe (type + proximité + fenêtre temporelle) :
   ├─ « ✔ Confirmer que je suis également concerné » → parcours court :
   │    contact → OTP → +1 confirmation sur l'incident principal (pas de nouveau marqueur)
   └─ « Continuer avec une nouvelle déclaration » (marquée possible_duplicate côté admin)
   ▼
É5. Contact : 📱 téléphone (indicatif international) OU ✉ e-mail
   ☑ case de consentement obligatoire (vérification, anti-abus, mise à jour)
   Pas de compte permanent.
   ▼
É6. Vérification
   ├─ SMS → saisie du code OTP 6 chiffres (10 min, 5 essais, renvoi après délai,
   │        blocage temporaire en cas d'abus)
   └─ E-mail → écran « Consultez votre boîte mail » ; lien signé usage unique
              (ou saisie du code) → redirection vers la confirmation
   ▼
Confirmation : identifiant public INC-XXXXXX · type · zone · début · statut ·
lien de gestion sécurisé (affiché + envoyé par SMS/e-mail)
```

Statuts traversés : `draft` → `pending_verification` → `verified` → `active` (ou `pending_review` si score de confiance bas, `possible_duplicate` si doublon).

## 3. Suivi et clôture par le déclarant

```
Lien de gestion (SMS/e-mail, jeton signé, révocable, expirant)
 ▼
Page « Ma déclaration »
 ├─ « L'incident est toujours en cours » → prolonge l'expiration
 ├─ « L'incident est terminé » → saisie de l'heure de fin → statut resolved
 ├─ mettre à jour la description
 ├─ signaler une erreur de localisation (transmis aux opérateurs)
 └─ supprimer ma déclaration (quand juridiquement possible)
```

## 4. Cycle de vie automatique

```
active ──(TTL configurable sans confirmation)──► expired
   │   rappel préalable « Cet incident est-il toujours en cours ? »
   │   (SMS/e-mail, N heures avant expiration)
   └── déclarant clôture ──► resolved (visible encore un temps sur la carte)
Contacts purgés RETENTION_DAYS après résolution (RGPD).
```

## 5. Administration

```
Connexion (rôles : admin · moderator · operator · analyst)
 ├─ File d'attente : pending_review / possible_duplicate / signalements
 ├─ Fiche incident : valider · rejeter · modifier · fusionner les doublons
 │    · masquer une description · voir pièces jointes (modération)
 │    · voir localisation exacte (rôle autorisé — action journalisée)
 ├─ Contacts : suspendre un contact abusif
 ├─ Configuration : catégories, TTL, rayon d'anonymisation, limites anti-spam
 ├─ Journal d'audit
 ├─ Export des incidents (CSV)
 └─ Tableau de bord statistique agrégé
```
