// Espaces de noms i18n (addendum) — i18n/{fr,ar}/{ns}.json, chargés en
// mémoire au démarrage. Source de vérité des NOUVELLES surfaces (mode feux
// MapLibre, replay, panneau sources, SEO localisé). La SPA historique garde
// son dictionnaire public/js/i18n.js : UNE mécanique par surface, jamais deux
// sources de vérité pour une même clé.
// Parité STRICTE fr ↔ ar imposée par les tests (mêmes clés, valeurs non vides).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..', 'i18n');

export const I18N_LANGS = ['fr', 'ar'];
export const I18N_NAMESPACES = ['common', 'fire', 'map', 'replay', 'sources', 'alerts', 'seo'];

const cache = new Map(); // `${lang}/${ns}` → objet gelé

function load(lang, ns) {
  const key = `${lang}/${ns}`;
  if (cache.has(key)) return cache.get(key);
  let data = null;
  try {
    data = Object.freeze(JSON.parse(fs.readFileSync(path.join(ROOT, lang, `${ns}.json`), 'utf8')));
  } catch { data = null; }
  cache.set(key, data);
  return data;
}

// Récupère un espace de noms complet (ou null si inconnu/illisible).
export function getNamespace(lang, ns) {
  if (!I18N_LANGS.includes(lang) || !I18N_NAMESPACES.includes(ns)) return null;
  return load(lang, ns);
}

// Une clé précise avec interpolation {var} — pour le rendu serveur (SEO, mails).
export function nsMsg(lang, ns, key, vars = {}) {
  const dict = getNamespace(lang, ns);
  let s = dict?.[key];
  if (typeof s !== 'string') return null;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
