# Kifeh — Protocole de tests utilisateurs (8 questions, #95)

*Pour Farah : à faire passer à 2-3 personnes NON expertes (idéalement : une
personne en Tunisie, une en France, une à l'aise en arabe). 15 à 20 minutes
par personne, sur LEUR téléphone, sans aide. Ton rôle : observer en silence,
noter où ça bloque, ne jamais expliquer avant la fin.*

## Consignes de passation

Dis seulement : « Voici Kifeh, un site qui montre les incidents et les feux
autour de toi. Je vais te demander de faire quelques choses ; pense à voix
haute ; je ne peux pas t'aider. » Envoie le lien kifeh.app par message.
Chronomètre discrètement chaque tâche. Une tâche est un ÉCHEC si la personne
abandonne ou dépasse 2 minutes.

## Les 8 questions

1. **Premier regard (10 secondes puis écran caché).** « Qu'est-ce que ce
   site propose, à ton avis ? » — *vérifie : la promesse est-elle comprise
   sans explication ?*
2. **Situation locale.** « Est-ce qu'il se passe quelque chose près de chez
   toi en ce moment ? » — *vérifie : trouve-t-il la situation en moins de
   10 secondes (objectif du plan) ?*
3. **Comprendre un marqueur.** « Ouvre un incident sur la carte et dis-moi :
   c'est confirmé ou pas ? De quand date l'information ? » — *vérifie :
   source et horodatage sont-ils LUS et compris ?*
4. **Feux.** « Montre-moi s'il y a des feux quelque part dans le pays. »
   — *vérifie : le filtre feu / mode feux est-il trouvable ?*
5. **Calques.** « Peux-tu afficher la météo sur la carte ? Et l'enlever ? »
   — *vérifie : le panneau Calques est-il compréhensible ? (alimente le
   choix de maquette Phase 1)*
6. **Être prévenu.** « Fais en sorte d'être averti s'il se passe quelque
   chose dans ton quartier. » — *vérifie : le parcours suivre/alertes
   aboutit-il ? C'est NOTRE conversion clé à zéro aujourd'hui.*
7. **Signaler.** « Fais comme si tu voyais une coupure d'électricité :
   va jusqu'à l'écran final SANS envoyer. » — *vérifie : où hésite-t-il ?
   (GA4 montre déjà un abandon réel à cette étape)*
8. **Confiance (à la fin, sans écran).** « Est-ce que tu ferais confiance à
   ce que tu as vu ? Qu'est-ce qui te ferait revenir demain ? » — *réponse
   libre, mot pour mot.*

## Grille de notes (une par testeur)

| Tâche | Réussie ? | Temps | Où ça a bloqué (mot pour mot) |
|---|---|---|---|
| 1 Premier regard | | | |
| 2 Situation locale | | | |
| 3 Marqueur compris | | | |
| 4 Feux | | | |
| 5 Calques | | | |
| 6 Être prévenu | | | |
| 7 Signaler | | | |
| 8 Confiance | | | |

*Variante arabe : refaire les tâches 2, 3 et 6 après avoir basculé le site
en العربية — noter tout texte qui reste en français ou toute gêne RTL.*

## Ce qu'on en fera

Rapporte-moi les grilles telles quelles (photo ou texte). Je croiserai avec
GA4 et l'audit WCAG : chaque blocage observé devient une correction — maquette
d'abord si c'est visible, directement si c'est invisible. Trois testeurs
suffisent : au-delà, les mêmes blocages reviennent.
