// API OUVERTE (« /api/open ») — trois documents JSON stables, citables et
// réutilisables (croissance §22 + master feux §9) :
//   · fire-situation.json   — la situation factuelle par territoire ;
//   · fire-sources.json     — chaque source, sa licence, sa cadence, ses seuils ;
//   · fire-methodology.json — ce que les données représentent — et ne
//     représentent JAMAIS (observation ≠ confirmation, quasi temps réel…).
// Règles : uniquement des données RÉELLES déjà servies par la plateforme,
// jamais de coordonnées privées, bilingue fr/ar, attribution amont visible,
// cache HTTP court + ETag (Express), version d'API explicite.
import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { getProfile } from '../countries/index.js';
import { getCapabilities } from '../services/capabilityRegistry.js';
import { freshnessFromLastSuccess, freshnessThresholds, FRESHNESS_LEVELS } from '../services/sourceFreshness.js';
import { effisStatus } from '../services/effis.js';
import { getNamespace } from '../services/i18nNamespaces.js';

export const openDataRouter = Router();

const API_VERSION = 'kifeh-open/1';
const BASE = 'https://kifeh.app';
const CCS = ['FR', 'TN'];
const LANGS = ['fr', 'ar'];

// Mêmes clés historiques que /api/fire/map — jamais une seconde vérité.
const firmsSuccessKey = (c) => (c === 'TN' ? 'firms_last_success_at' : `firms_last_success_at_${c.toLowerCase()}`);
const firmsSyncKey = (c) => (c === 'TN' ? 'firms_last_sync_at' : `firms_last_sync_at_${c.toLowerCase()}`);

// Attributions amont — relues sur les pages officielles des fournisseurs.
// (La licence de Kifeh lui-même : MIT, voir LICENSE du dépôt.)
const UPSTREAM = {
  thermalDetections: {
    provider: 'NASA FIRMS (LANCE/EOSDIS)',
    url: 'https://firms.modaps.eosdis.nasa.gov/',
    license: 'Données NASA ouvertes — citer « NASA FIRMS »',
    instruments: 'VIIRS 375 m (Suomi-NPP, NOAA-20, NOAA-21) + MODIS 1 km (Terra, Aqua)',
  },
  burnedAreas: {
    provider: 'Copernicus EFFIS (European Forest Fire Information System)',
    url: 'https://forest-fire.emergency.copernicus.eu/',
    license: '© Union européenne, service Copernicus de gestion des urgences',
  },
  weatherModel: {
    provider: 'Open-Meteo (modèles météo nationaux, sélection explicite par territoire)',
    url: 'https://open-meteo.com/',
    license: 'CC BY 4.0 — citer « Open-Meteo.com »',
  },
  officialAlerts: {
    provider: 'Météo-France — Vigilance',
    url: 'https://vigilance.meteofrance.fr/',
    license: 'Données publiques Météo-France — citer la source',
  },
  aircraft: {
    provider: 'Airplanes.live (ADS-B communautaire)',
    url: 'https://airplanes.live/',
    license: 'Usage non commercial, attribution requise — affichage non exhaustif',
  },
};

const nsBoth = (ns, key) => ({
  fr: (getNamespace('fr', ns) || {})[key] || null,
  ar: (getNamespace('ar', ns) || {})[key] || null,
});

const cache = new Map(); // nom → { body, at } — 5 min, ces documents sont stables.
const CACHE_MS = 5 * 60_000;
function serveCached(name, res, build) {
  const hit = cache.get(name);
  const body = (hit && Date.now() - hit.at < CACHE_MS) ? hit.body : build();
  if (!hit || body !== hit.body) cache.set(name, { body, at: Date.now() });
  res.set('Cache-Control', 'public, max-age=300').type('application/json').send(body);
}

const meta = (doc) => ({
  api: API_VERSION,
  document: doc,
  generatedAt: new Date().toISOString(),
  canonical: `${BASE}/api/open/${doc}.json`,
  publisher: { name: 'Kifeh كيفاه', url: BASE, source: 'https://github.com/fch1/kifeh', license: 'MIT (code) — données : licences des sources amont ci-jointes' },
  reuse: {
    fr: 'Réutilisation libre avec attribution « Kifeh — kifeh.app » ET attribution des sources amont. Kifeh ne remplace jamais les services de secours.',
    ar: 'إعادة الاستخدام حرة مع ذكر « Kifeh — kifeh.app » ومصادر البيانات الأصلية. كيفاه لا يعوّض أبدًا مصالح النجدة.',
  },
});

// ── 1. Situation factuelle par territoire ───────────────────────────────────
openDataRouter.get('/fire-situation.json', (req, res) => serveCached('situation', res, () => {
  const g = (sql, ...p) => { try { return db.prepare(sql).get(...p); } catch { return null; } };
  const countries = {};
  for (const CC of CCS) {
    const caps = getCapabilities({ countryCode: CC, language: 'fr' });
    if (!caps) continue;
    const det = g(`SELECT COUNT(*) AS n, MAX(acquired_at) AS last FROM satellite_detections
                   WHERE country_code=? AND acquired_at > datetime('now','-1 day')`, CC) || { n: 0, last: null };
    const fires = g(`SELECT COUNT(*) AS n FROM incidents WHERE status='active' AND type='fire'
                     AND COALESCE(country_code,'TN')=?`, CC)?.n ?? 0;
    const all = g(`SELECT COUNT(*) AS n FROM incidents WHERE status='active'
                   AND COALESCE(country_code,'TN')=?`, CC)?.n ?? 0;
    const entry = {
      citizenReports: { activeFire: fires, activeAll: all, note: 'Signalements citoyens — jamais des confirmations officielles.' },
      satellite24h: {
        observations: det.n,
        lastObservedAt: det.last,
        source: 'NASA FIRMS',
        note: 'Anomalies thermiques observées par satellite — pas des incendies confirmés.',
        freshness: freshnessFromLastSuccess('thermalDetections',
          getSetting(firmsSuccessKey(CC)) || null),
        lastSyncAt: getSetting(firmsSyncKey(CC)) || null,
      },
    };
    if (caps.layers.burnedAreas?.enabled) {
      const burned = g(`SELECT COUNT(DISTINCT effis_feature_id) AS n, MAX(published_at) AS last
                        FROM burned_area_versions WHERE is_latest=1`) || { n: 0, last: null };
      const st = effisStatus();
      entry.burnedAreas45d = {
        contours: burned.n, lastPublishedAt: burned.last,
        source: 'Copernicus EFFIS', lastCheckAt: st.lastSuccess || null,
        freshness: freshnessFromLastSuccess('burnedAreas', st.lastSuccess || null),
      };
    }
    if (caps.layers.weatherModel?.enabled) {
      entry.weatherModel = {
        model: caps.layers.weatherModel.label || caps.layers.weatherModel.model || null,
        note: 'Modèle sélectionné EXPLICITEMENT par territoire — jamais un mélange silencieux.',
      };
    }
    countries[CC] = entry;
  }
  return JSON.stringify({ meta: meta('fire-situation'), freshnessLevels: FRESHNESS_LEVELS, countries }, null, 2);
}));

// ── 2. Sources, licences, cadences, seuils ──────────────────────────────────
openDataRouter.get('/fire-sources.json', (req, res) => serveCached('sources', res, () => {
  const thresholds = freshnessThresholds();
  const countries = {};
  for (const CC of CCS) {
    const caps = getCapabilities({ countryCode: CC, language: 'fr' });
    if (!caps) continue;
    const layers = {};
    for (const [key, layer] of Object.entries(caps.layers || {})) {
      const entry = { enabled: layer?.enabled === true };
      if (layer?.label) entry.label = layer.label;
      if (layer?.model) entry.model = layer.model;
      if (layer?.provider) entry.provider = layer.provider;
      if (!entry.enabled && layer?.reason) entry.disabledReason = layer.reason;
      if (UPSTREAM[key]) entry.upstream = UPSTREAM[key];
      if (thresholds[key]) {
        entry.freshnessThresholdsSeconds = { fresh: thresholds[key][0], delayed: thresholds[key][1] };
      }
      layers[key] = entry;
    }
    countries[CC] = { layers };
  }
  const described = {};
  for (const c of ['thermal', 'burned', 'weather']) {
    described[c] = {
      name: nsBoth('sources', `${c}_name`),
      description: nsBoth('sources', `${c}_description`),
      limitations: nsBoth('sources', `${c}_limitations`),
    };
  }
  return JSON.stringify({
    meta: meta('fire-sources'),
    note: {
      fr: 'Une capacité désactivée porte toujours sa raison — une page tunisienne ne mentionne jamais EFFIS, DFCI ou un modèle hors couverture.',
      ar: 'كل خاصية معطّلة تُذكر مع سببها — صفحات تونس لا تذكر أبدًا مصادر خارج تغطيتها.',
    },
    descriptions: described,
    countries,
  }, null, 2);
}));

// ── 3. Méthodologie — ce que les données sont, et ne sont PAS ───────────────
openDataRouter.get('/fire-methodology.json', (req, res) => serveCached('methodology', res, () => {
  const T = freshnessThresholds();
  const doc = {
    meta: meta('fire-methodology'),
    principles: {
      fr: [
        'Un point satellite est une anomalie thermique OBSERVÉE — jamais, à lui seul, un incendie confirmé, un périmètre ou une surface brûlée.',
        'Kifeh écrit « quasi temps réel » — jamais « temps réel » pour des passages satellite intermittents.',
        'Quatre familles toujours distinguées : observation instrumentale, signalement citoyen, simulation/prévision, information officielle confirmée.',
        'Le replay restitue uniquement ce qui était connu à l’instant sélectionné — jamais une information publiée plus tard.',
        'Les positions publiées des signalements sont volontairement approximatives (vie privée). Le carroyage DFCI est calculé côté serveur, à titre indicatif.',
        'La FRP (puissance radiative) n’est jamais convertie en taille ou surface de feu.',
        'Kifeh ne publie jamais de consigne d’évacuation ni de prévision d’apparition ou de trajectoire d’un incendie.',
        'Une source en panne ne bloque jamais la plateforme : dernière donnée valide affichée, avec son âge.',
      ],
      ar: [
        'النقطة الساتلية شذوذ حراري مُرصَد — وليست وحدها حريقًا مؤكدًا ولا محيطًا ولا مساحة محترقة.',
        'كيفاه يكتب « شبه آنيّ » — أبدًا « آنيّ » لأرصاد ساتلية متقطعة.',
        'أربع فئات تُميَّز دائمًا: رصد آلي، تبليغ مواطن، محاكاة/توقّع، معلومة رسمية مؤكدة.',
        'إعادة العرض تعرض فقط ما كان معلومًا في اللحظة المختارة.',
        'المواقع المنشورة تقريبية عمدًا (خصوصية المبلّغين).',
        'كيفاه لا ينشر أبدًا تعليمات إخلاء ولا توقّعًا لظهور حريق أو مساره.',
      ],
    },
    deduplication: {
      fr: 'Plusieurs satellites peuvent observer le même phénomène : les agrégats sont regroupés dans des fenêtres spatiales et temporelles configurables ; chaque observation brute est CONSERVÉE (jamais supprimée parce qu’absente du dernier import). Détail dans le dépôt (src/services/dedup.js).',
      ar: 'قد ترصد عدة أقمار الظاهرة نفسها: تُجمَّع الأرصاد ضمن نوافذ مكانية وزمنية قابلة للضبط، مع الاحتفاظ بكل رصد خام.',
    },
    burnedAreas: {
      fr: 'Chaque publication EFFIS est VERSIONNÉE : la géométrie originale est préservée, la surface n’est jamais recalculée depuis une géométrie simplifiée, et le replay ne montre que la version connue à la date choisie.',
      ar: 'كل نشر EFFIS مُدرَج بإصدار: تُحفَظ الهندسة الأصلية ولا تُحسب المساحة من هندسة مبسّطة.',
    },
    freshness: {
      levels: FRESHNESS_LEVELS,
      labels: {
        fresh: nsBoth('sources', 'freshness_fresh'),
        delayed: nsBoth('sources', 'freshness_delayed'),
        stale: nsBoth('sources', 'freshness_stale'),
        unavailable: nsBoth('sources', 'freshness_unavailable'),
      },
      thresholdsSeconds: T,
      note: {
        fr: 'Seuils par CADENCE réelle de chaque source (une publication EFFIS quotidienne n’est pas « en retard » au bout de 3 h ; une synchro FIRMS de 15 min, si). Configurables et documentés.',
        ar: 'العتبات حسب الإيقاع الفعلي لكل مصدر، قابلة للضبط وموثّقة.',
      },
    },
    corrections: {
      fr: 'La localisation d’un signalement est corrigible (le DFCI est alors recalculé côté serveur) ; les fins d’incident sont communautaires ou déclarées ; les données satellite ne sont jamais réécrites.',
      ar: 'موقع التبليغ قابل للتصحيح، ونهايات الحوادث مجتمعية أو معلنة، وبيانات الأقمار لا تُعاد كتابتها أبدًا.',
    },
    links: {
      map: `${BASE}/`,
      firePageFr: `${BASE}/fr/fr/incendies`,
      understandSatellite: `${BASE}/fr/fr/incendies/comprendre/detections-satellite`,
      dfci: `${BASE}/fr/fr/incendies/comprendre/reperes-dfci`,
      openData: `${BASE}/fr/donnees-ouvertes/incendies`,
      press: `${BASE}/presse`,
      sourceCode: 'https://github.com/fch1/kifeh',
    },
  };
  return JSON.stringify(doc, null, 2);
}));
