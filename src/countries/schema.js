// Contrat de profil pays — validation déclarative (addendum plateforme).
// Le registre src/countries/ est LE registre central : une seule architecture,
// pas de second registre concurrent. Chaque profil déclare des CONCEPTS
// génériques (détections thermiques, zones brûlées, modèle météo, carroyage
// d'urgence…) — les fournisseurs (NASA FIRMS, EFFIS, AROME, DFCI) ne sont que
// de la configuration territoriale, jamais des dépendances structurelles.
//
// Règle d'or : une capacité n'est déclarée `enabled: true` que si elle est
// RÉELLEMENT vérifiée pour ce territoire (source accessible, licence connue).
// Toute capacité désactivée porte une `reason` explicite du vocabulaire
// ci-dessous — le mode dégradé de l'interface s'appuie dessus.

// Vocabulaire FERMÉ des raisons d'indisponibilité (testé) :
export const DISABLED_REASONS = [
  'no_verified_source',       // aucune source fiable identifiée pour ce territoire
  'coverage_to_verify',       // la source existe ailleurs, couverture ici à vérifier
  'model_to_integrate',       // un fournisseur candidat existe, intégration à faire
  'not_applicable',           // le concept n'a pas de sens sur ce territoire
  'license_review_pending',   // conditions d'utilisation NON relues — bloquant
  'charter_decision_pending', // tension de charte — décision produit explicite requise
  'not_yet_enabled',          // techniquement possible, pas encore ouvert ici
  'not_configured',           // dépend d'une clé/variable absente de l'environnement
];

// Concepts de capacité reconnus (clé = concept générique, jamais un fournisseur).
export const CAPABILITY_CONCEPTS = [
  'citizenReports',    // signalements citoyens (cœur de Kifeh — partout)
  'thermalDetections', // détections thermiques satellite (quasi temps réel)
  'burnedAreas',       // contours de zones brûlées (source territoriale)
  'weatherModel',      // modèle météo configuré (vent, température…)
  'airQuality',        // qualité de l'air (PM2.5…)
  'officialAlerts',    // vigilance/alertes officielles du territoire
  'roadEvents',        // routes barrées / entraves officielles
  'emergencyGrid',     // carroyage opérationnel des secours (ex. DFCI en France)
  'aircraft',          // moyens aériens (ADS-B)
  'smokeSimulation',   // simulation de fumée (dépend météo + décision de charte)
  'replay',            // relecture temporelle « ce qui était connu à T »
];

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isDigits = (v) => /^[0-9]{2,4}$/.test(String(v || ''));

// Valide un profil pays. Retourne un tableau d'erreurs lisibles (vide = OK).
// Jamais utilisé pour bloquer le démarrage en production : les tests l'imposent.
export function validateProfile(p) {
  const errors = [];
  const err = (m) => errors.push(`[${p?.code || '??'}] ${m}`);
  if (!p || typeof p !== 'object') return ['profil absent ou invalide'];

  // Identité et langues — la langue n'est JAMAIS déduite du pays (et
  // réciproquement) : le profil liste ce qu'il PREND EN CHARGE, c'est tout.
  if (!/^[A-Z]{2}$/.test(p.code || '')) err('code ISO à 2 lettres requis');
  if (!p.name?.fr || !p.name?.ar) err('nom fr ET ar requis');
  if (!Array.isArray(p.supportedLanguages) || p.supportedLanguages.length < 2) {
    err('au moins 2 langues prises en charge (fr + ar obligatoires)');
  }
  for (const lang of ['fr', 'ar']) {
    if (!p.supportedLanguages?.includes(lang)) err(`langue obligatoire manquante : ${lang}`);
    if (!isNonEmptyString(p.localeByLanguage?.[lang])) err(`localeByLanguage.${lang} requis`);
  }
  if (!isNonEmptyString(p.timezone) || !p.timezone.includes('/')) err('timezone IANA requise');
  if (!isNonEmptyString(p.currency)) err('currency requise');

  // Numéros d'urgence — VÉRIFIÉS pour le territoire, jamais copiés d'un autre
  // pays. Le numéro français ne doit jamais fuiter vers une zone tunisienne.
  const en = p.emergencyNumbers;
  if (!en || typeof en !== 'object') err('emergencyNumbers requis');
  else {
    for (const cat of ['fire', 'police', 'medical']) {
      if (!Array.isArray(en[cat]) || en[cat].length === 0) err(`emergencyNumbers.${cat} requis`);
      else if (!en[cat].every(isDigits)) err(`emergencyNumbers.${cat} : numéros invalides`);
    }
  }

  // Capacités — chaque concept connu, chaque désactivation motivée.
  const caps = p.capabilities;
  if (!caps || typeof caps !== 'object') err('capabilities requis');
  else {
    for (const key of Object.keys(caps)) {
      if (!CAPABILITY_CONCEPTS.includes(key)) err(`capacité inconnue : ${key}`);
      const c = caps[key];
      if (typeof c?.enabled !== 'boolean') err(`capabilities.${key}.enabled booléen requis`);
      if (c?.enabled === false && !DISABLED_REASONS.includes(c?.reason)) {
        err(`capabilities.${key} désactivée sans raison valide (reason=${c?.reason})`);
      }
      if (c?.enabled === true && c?.reason) err(`capabilities.${key} : reason interdit quand enabled`);
    }
    for (const required of CAPABILITY_CONCEPTS) {
      if (!(required in caps)) err(`capacité non déclarée : ${required}`);
    }
    if (caps.citizenReports?.enabled !== true) err('citizenReports doit être actif (cœur de Kifeh)');
  }

  // Fonds de carte — déclaratifs (le client bascule déjà automatiquement).
  if (!p.basemaps || !isNonEmptyString(p.basemaps.default)) err('basemaps.default requis');

  // Existant (contrat historique) — toujours exigé.
  for (const k of ['phone', 'map', 'geocoding', 'polygons', 'firms', 'enabledIncidentTypes']) {
    if (!(k in p)) err(`champ historique manquant : ${k}`);
  }
  return errors;
}
