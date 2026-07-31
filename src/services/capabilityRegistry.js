// Registre central des capacités EFFECTIVES (addendum).
// Croise trois vérités pour répondre « que peut-on afficher ICI, MAINTENANT ? » :
//   1. le profil pays (capacité déclarée et vérifiée — src/countries/) ;
//   2. les drapeaux à chaud (table settings, administrables) ;
//   3. l'environnement (clés API réellement configurées).
//
// La LANGUE n'influence JAMAIS les capacités (langue ≠ pays ≠ position) :
// la France en arabe a exactement les mêmes couches que la France en français.
// Le frontend ne doit jamais afficher une option indisponible sans explication :
// chaque capacité inactive porte sa `reason` (vocabulaire fermé de schema.js).
import { getProfile, countryEnabled } from '../countries/index.js';
import { getSetting } from '../db.js';
import { config } from '../config.js';

const flagOn = (key) => !key || getSetting(key) !== '0';

// Une capacité déclarée → son état EFFECTIF { enabled, reason? } + méta utile.
function effective(concept, declared) {
  if (!declared) return { enabled: false, reason: 'no_verified_source' };
  if (!declared.enabled) {
    const out = { enabled: false, reason: declared.reason };
    if (declared.candidateProvider) out.candidateProvider = declared.candidateProvider;
    return out;
  }
  // Drapeau administrable éteint → indisponible « par administration ».
  if (declared.settingFlag && !flagOn(declared.settingFlag)) {
    return { enabled: false, reason: 'not_yet_enabled' };
  }
  // Dépendance d'environnement absente → non configurée (honnête, pas cassée).
  if (declared.requiresEnv && !process.env[declared.requiresEnv]) {
    return { enabled: false, reason: 'not_configured' };
  }
  // Cas particulier : détections thermiques sans clé FIRMS = non configurées.
  if (concept === 'thermalDetections' && !config.firms.mapKey) {
    return { enabled: false, reason: 'not_configured' };
  }
  const out = { enabled: true };
  if (declared.provider) out.provider = declared.provider;
  if (declared.model) out.model = declared.model;
  if (declared.label) out.label = declared.label;
  return out;
}

// Capacités effectives pour un pays (et, sans effet, une langue).
// Réponse STABLE et sérialisable — consommée par l'API publique et les tests.
export function getCapabilities({ countryCode, language = 'fr' } = {}) {
  const p = getProfile(countryCode);
  if (!p || !countryEnabled(p.code)) return null;
  const caps = p.capabilities || {};

  const layers = {};
  for (const concept of Object.keys(caps)) layers[concept] = effective(concept, caps[concept]);

  // Carroyage d'urgence : distinction calcul (interne) / affichage (public).
  if (caps.emergencyGrid?.enabled) {
    const compute = flagOn(caps.emergencyGrid.computeFlag);
    const display = getSetting(caps.emergencyGrid.displayFlag) === '1';
    layers.emergencyGrid = compute
      ? { enabled: true, provider: caps.emergencyGrid.provider, publicDisplay: display }
      : { enabled: false, reason: 'not_yet_enabled' };
  }

  // Mode feux : une EXPÉRIENCE territoriale (interrupteur par pays), jamais
  // l'otage d'une seule couche — sans détections satellite, les signalements
  // citoyens et les couches restantes du territoire continuent de vivre.
  const fireMode = getSetting(`fire_situation_enabled_${p.code.toLowerCase()}`) !== '0';

  return {
    country: p.code,
    language, // rappel volontaire : la même réponse pour toutes les langues
    fireMode,
    replay: layers.replay?.enabled === true,
    layers,
    alerts: {
      push: true, // Web Push VAPID — générique, tous territoires
      email: Boolean(process.env.RESEND_API_KEY) && getSetting('email_alerts_enabled') !== '0',
    },
    emergency: { numbers: p.emergencyNumbers },
    timezone: p.timezone,
    basemaps: { default: p.basemaps.default, fallback: p.basemaps.fallback, satellite: p.basemaps.satellite },
  };
}
