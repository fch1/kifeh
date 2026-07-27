// Profils pays — LE point central de tout comportement dépendant du pays.
// Une application, un modèle d'incident, une interface : seule la
// configuration change. Aucun `if (country === 'FR')` dispersé dans le code :
// tout passe par ces profils déclaratifs.
//
// Pays ≠ langue ≠ position : un utilisateur peut consulter la France en arabe
// ou la Tunisie en français. Les deux contextes sont indépendants.
import { tn } from './tn.js';
import { fr } from './fr.js';
import { getSetting } from '../db.js';

const PROFILES = { TN: tn, FR: fr };

// Champs obligatoires du contrat de profil (vérifiés par les tests).
export const PROFILE_CONTRACT = [
  'code', 'name', 'defaultLanguage', 'supportedLanguages', 'timezone',
  'localeByLanguage', 'phone', 'map', 'geocoding', 'polygons', 'firms',
  'enabledIncidentTypes',
];

export function countryEnabled(code) {
  if (code === 'TN') return getSetting('country_tn_enabled') !== '0';
  if (code === 'FR') return getSetting('country_fr_enabled') !== '0';
  return false;
}

export function enabledCountries() {
  return Object.keys(PROFILES).filter(countryEnabled);
}

export function getProfile(code) {
  return PROFILES[String(code || '').toUpperCase()] || null;
}

// Pays actif d'une requête : paramètre explicite, sinon TUNISIE (compatibilité
// avec les clients historiques — Kifeh a toujours été tunisien par défaut).
export function requestCountry(req) {
  const c = String(req.query?.country || req.body?.country || '').toUpperCase();
  return PROFILES[c] && countryEnabled(c) ? c : 'TN';
}

// Point dans polygone (ray casting) — polygones [ [lat,lng], ... ].
function inPolygon(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

export function inCountry(lat, lng, code) {
  const p = getProfile(code);
  return Boolean(p && p.polygons.some((poly) => inPolygon(lat, lng, poly)));
}

// Détermine le pays PRIS EN CHARGE contenant ce point, ou null.
// Jamais de rattachement silencieux au pays « le plus proche ».
export function resolveCountry(lat, lng) {
  for (const code of Object.keys(PROFILES)) {
    if (inCountry(lat, lng, code)) return code;
  }
  return null;
}

// Normalisation téléphonique selon le pays de l'incident (jamais selon la
// langue de l'interface). Un numéro international explicite reste accepté.
export function normalizePhoneFor(v, code) {
  let n = String(v).replace(/[\s.\-()]/g, '');
  const p = getProfile(code) || tn;
  if (p.phone.normalizationStrategy === 'fr') {
    if (/^0033[1-9]\d{8}$/.test(n)) n = `+33${n.slice(4)}`;   // 0033… → +33…
    else if (/^33[1-9]\d{8}$/.test(n)) n = `+${n}`;           // 33… → +33…
    else if (/^0[1-9]\d{8}$/.test(n)) n = `+33${n.slice(1)}`; // 06… → +336…
  } else {
    if (/^00216\d{8}$/.test(n)) n = `+${n.slice(2)}`;
    else if (/^216\d{8}$/.test(n)) n = `+${n}`;
    else if (/^[2-9]\d{7}$/.test(n)) n = `+216${n}`;          // 8 chiffres locaux
  }
  return n;
}

export function isPhoneFor(v, code) {
  if (typeof v !== 'string') return false;
  return /^\+[1-9]\d{6,14}$/.test(normalizePhoneFor(v, code));
}
