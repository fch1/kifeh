# Audit référencement & génération d'audience — Kifeh, 31/07/2026

Audit exécuté sur la PRODUCTION (kifeh.app) + données GA4 réelles du 3-31/07.
Objectif demandé : ×10 de trafic. Verdict honnête : le socle technique est
sain, mais le site n'a presque **rien à indexer** — le ×10 passe par la
création de pages d'intention rendues serveur, pas par des micro-optimisations.

## 1. Ce qui est BON (vérifié en prod, rien à faire)

robots.txt propre (privé exclu, public autorisé) · sitemap.xml valide ·
canonical + hreflang fr/ar/x-default sur la home · titres et descriptions
uniques par page · FAQPage JSON-LD sur /faq · Open Graph + Twitter cards ·
llms.txt pour les moteurs de réponse IA · domaine canonique unique
(kifeh.app, 301 des alias) · PWA + performances bonnes (vanilla, vendorisé) ·
mesure GA4 fiabilisée le 31/07 (funnel + UTM + boucles de retour).

## 2. Les DEUX problèmes structurels (la cause de « organique = 2 sessions »)

**P1 — Presque rien à lire pour les moteurs.** La home ne rend que
~142 caractères de texte hors JavaScript. Corrigé partiellement aujourd'hui
(bloc `<noscript>` bilingue : mission, sources, urgences 18/112/198, liens
internes — même message que l'app, zéro cloaking). Mais le fond reste : tout
le contenu vit en JS.

**P2 — Cinq pages indexables, zéro sur une intention de recherche.** Personne
ne cherche « Kifeh » (marque inconnue). Les requêtes réelles — « carte des
feux en France », « feux en cours Gironde », « incendies Tunisie
aujourd'hui », « carte NASA FIRMS », « qu'est-ce qu'un repère DFCI » — n'ont
AUCUNE page de destination chez nous. C'est le levier ×10 : chaque page
d'intention utile est une porte d'entrée permanente.

## 3. Plan ×10 — dans l'ordre d'impact

**Chantier A (le levier principal — tâche #83, prochaine exécution) :
pages d'intention rendues serveur**, sur la convention `/{langue}/{territoire}/`
(docs/URL_CONVENTION.md), alimentées par les données RÉELLES déjà en base :

- `/fr/fr/incendies` + `/ar/fr/` + `/fr/tn/` + `/ar/tn/` — situation
  textuelle actualisée (détections 24 h, zones brûlées récentes, vigilance),
  carte en progressive enhancement, hreflang 4 variantes ;
- pages départementales UNIQUEMENT quand il y a de l'information réelle
  (Gironde, Landes, Var, Corse en saison — sinon noindex) ;
- méthodologies : « Comment lire une détection satellite », « Qu'est-ce
  qu'un repère DFCI », « D'où viennent les contours de zones brûlées » —
  contenu expert unique, aimant à liens naturels ;
- Dataset schema.org + `/api/open/*.json` (données ouvertes → citations) ;
- sitemaps par langue-territoire, maillage interne, breadcrumbs.

**Chantier B (30 minutes, à toi — débloque tout le reste) :**

1. **Search Console** : ajouter kifeh.app (validation DNS chez Cloudflare),
   soumettre le sitemap. Sans ça, ni indexation pilotée ni données de requêtes.
2. **Bing Webmaster Tools** : importer depuis Search Console (Bing alimente
   aussi ChatGPT/Copilot — cohérent avec notre llms.txt).
3. GA4 : les 7 événements clés (je m'en charge demain 10 h, déjà planifié).

**Chantier C — autorité et liens (le multiplicateur) :** un site sans
backlinks ne classe rien, même parfait. Cibles naturelles et légitimes :
annuaires open source / civic-tech (data.gouv.fr réutilisations, NASA FIRMS
applications gallery, Copernicus showcase), presse locale des zones à feux
(kit média du Chantier PR 4), associations sécurité civile, communautés
tunisiennes. Objectif : 5 liens éditoriaux à 60 j (croissance, pas d'achat
de liens — jamais).

**Chantier D — distribution sociale vers des pages précises** (convention
UTM livrée dans docs/ANALYTICS_MEASUREMENT_PLAN.md §5) : chaque post pointe
une page d'intention, plus jamais la home nue.

## 4. « Lead generation » version Kifeh

Nos « leads » = zones suivies + alertes activées (les 7 événements clés).
Le funnel est instrumenté depuis aujourd'hui ; les leviers de conversion
sont en place (CTA « Suivre cette zone », double consentement e-mail, PWA
contextuelle, « Depuis votre dernière visite » déployé ce soir). Prochain
cran (PR Growth 2, après 7-10 j de données de funnel) : variantes de CTA
non anxiogènes et landing pages par canal social.

## 5. Trajectoire honnête vers ×10

352 utilisateurs/mois actuels, quasi 100 % social+direct. ×10 ≈ 3 500/mois.
Chemin réaliste : pages d'intention indexées (Chantier A) + Search Console
(B) + 5-10 liens (C) + saisonnalité feux → l'organique peut passer de 2
sessions à plusieurs centaines/mois en 60-90 j, PENDANT que le social
continue (posts vers landing pages) et que la rétention (alertes, zones,
« depuis votre dernière visite ») transforme les pics en base récurrente.
Aucun raccourci : pas de SEA avant funnel observé, pas de mots-clés
anxiogènes, pas d'achat de liens, jamais de contenu qui exploite la peur.

---
*Corrigé aujourd'hui même : bloc no-JS bilingue crawlable sur la home
(moteurs classiques + IA). Prochaine exécution : Chantier A (#83).*
