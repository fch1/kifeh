// Formatage localisé — l'unique passerelle entre les unités CANONIQUES
// stockées (UTC, mètres, m/s, Celsius, degrés) et l'affichage local (addendum).
//
// Principes :
//   · le stockage ne change JAMAIS d'unité ni de fuseau (UTC partout) ;
//   · l'affichage suit la LANGUE de l'interface ET le FUSEAU du territoire
//     CONSULTÉ (une zone de Tunis s'affiche à l'heure de Tunis, même pour un
//     utilisateur physiquement à Paris — langue ≠ pays ≠ position) ;
//   · les pluriels arabes (zero/one/two/few/many/other) passent par
//     Intl.PluralRules — jamais un simple « s » conditionnel.
import { getProfile } from '../countries/index.js';

// Locale d'affichage pour (langue, pays) — depuis le profil pays.
export function displayLocale(language, countryCode) {
  const p = getProfile(countryCode);
  return p?.localeByLanguage?.[language] || (language === 'ar' ? 'ar' : 'fr');
}

export function countryTimezone(countryCode) {
  return getProfile(countryCode)?.timezone || 'UTC';
}

// Date + heure locales du TERRITOIRE (jamais du navigateur ni du serveur).
export function fmtDateTime(iso, { language = 'fr', countryCode = 'TN', withTz = false } = {}) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return null;
  const opts = {
    timeZone: countryTimezone(countryCode),
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    // Horloge 24 h partout : usage officiel en France comme en Tunisie —
    // certains replis de locale (fr-TN) retomberaient sinon en 12 h AM/PM.
    hourCycle: 'h23',
  };
  if (withTz) opts.timeZoneName = 'short';
  return new Intl.DateTimeFormat(displayLocale(language, countryCode), opts).format(new Date(t));
}

export function fmtTime(iso, { language = 'fr', countryCode = 'TN' } = {}) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat(displayLocale(language, countryCode), {
    timeZone: countryTimezone(countryCode), hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(t));
}

export function fmtNumber(n, { language = 'fr', countryCode = 'TN', maxDecimals = 1 } = {}) {
  if (!Number.isFinite(Number(n))) return null;
  return new Intl.NumberFormat(displayLocale(language, countryCode), {
    maximumFractionDigits: maxDecimals,
  }).format(Number(n));
}

// Distance canonique en MÈTRES → « 850 m » / « 12,4 km » localisés.
export function fmtDistance(meters, ctx = {}) {
  const m = Number(meters);
  if (!Number.isFinite(m) || m < 0) return null;
  const { language = 'fr' } = ctx;
  if (m < 1000) return `${fmtNumber(Math.round(m), { ...ctx, maxDecimals: 0 })} ${language === 'ar' ? 'م' : 'm'}`;
  return `${fmtNumber(m / 1000, ctx)} ${language === 'ar' ? 'كم' : 'km'}`;
}

// Surface canonique en HECTARES (valeur SOURCE, jamais recalculée) → localisée.
export function fmtAreaHa(ha, ctx = {}) {
  const v = Number(ha);
  if (!Number.isFinite(v) || v < 0) return null;
  const { language = 'fr' } = ctx;
  return `${fmtNumber(v, ctx)} ${language === 'ar' ? 'هكتار' : 'ha'}`;
}

// Vitesse canonique en M/S → affichage km/h (convention météo grand public).
export function fmtSpeedMs(ms, ctx = {}) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v < 0) return null;
  const { language = 'fr' } = ctx;
  return `${fmtNumber(Math.round(v * 3.6), { ...ctx, maxDecimals: 0 })} ${language === 'ar' ? 'كم/س' : 'km/h'}`;
}

export function fmtTempC(c, ctx = {}) {
  const v = Number(c);
  if (!Number.isFinite(v)) return null;
  return `${fmtNumber(Math.round(v), { ...ctx, maxDecimals: 0 })}°C`;
}

// Pluralisation par Intl.PluralRules — `forms` : {zero?, one?, two?, few?,
// many?, other}. L'arabe utilise réellement zero/one/two/few/many/other.
export function pluralize(n, forms, { language = 'fr', countryCode = 'TN' } = {}) {
  const num = Number(n);
  if (!Number.isFinite(num) || !forms) return null;
  const rule = new Intl.PluralRules(displayLocale(language, countryCode)).select(num);
  return forms[rule] ?? forms.other ?? null;
}

// Ligne d'urgence LOCALISÉE : toujours les numéros du PAYS de la zone —
// jamais le 18 pour une zone tunisienne, jamais le 198 pour une zone française.
export function emergencyLine(countryCode, language = 'fr', category = 'fire') {
  const p = getProfile(countryCode);
  const numbers = p?.emergencyNumbers?.[category];
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  // Les numéros restent en chiffres LATINS et en LTR (éléments techniques).
  const list = numbers.join(language === 'ar' ? ' أو ' : ' ou ');
  return language === 'ar' ? `اتصلوا بالرقم ${list} في حالة خطر.` : `Appelez le ${list} en cas de danger.`;
}
