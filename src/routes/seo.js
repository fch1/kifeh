// Pages d'intention RENDUES SERVEUR — le levier organique (audit 31/07).
// Convention docs/URL_CONVENTION.md : /{langue}/{territoire}/incendies —
// langue ≠ territoire, 4 variantes servies, canonical + hreflang complets.
// Contenu RÉEL depuis la base (jamais de page vide) et piloté par le registre
// de capacités : une page tunisienne ne mentionne JAMAIS EFFIS/DFCI/AROME et
// affiche le 198 — jamais le 18. Cache mémoire court (5 min).
import { Router } from 'express';
import { msg, getLang } from '../i18n.js';
import { db, getSetting } from '../db.js';
import { getProfile } from '../countries/index.js';
import { getCapabilities } from '../services/capabilityRegistry.js';
import { nsMsg, getNamespace } from '../services/i18nNamespaces.js';
import { fmtDateTime, emergencyLine } from '../services/localizationFormatter.js';

export const seoRouter = Router();
const BASE = 'https://kifeh.app';
const LANGS = ['fr', 'ar'];
const CCS = ['fr', 'tn'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const cache = new Map(); // clé lang/cc → { html, at }
const CACHE_MS = 5 * 60_000;

function liveCounts(CC) {
  const g = (sql, ...p) => { try { return db.prepare(sql).get(...p); } catch { return null; } };
  return {
    activeFires: g(`SELECT COUNT(*) AS n FROM incidents WHERE status='active' AND type='fire'
                    AND COALESCE(country_code,'TN')=?`, CC)?.n ?? 0,
    activeAll: g(`SELECT COUNT(*) AS n FROM incidents WHERE status='active'
                  AND COALESCE(country_code,'TN')=?`, CC)?.n ?? 0,
    det24: g(`SELECT COUNT(*) AS n, MAX(acquired_at) AS last FROM satellite_detections
              WHERE country_code=? AND acquired_at > datetime('now','-1 day')`, CC) || { n: 0, last: null },
    burned45: g(`SELECT COUNT(DISTINCT effis_feature_id) AS n, MAX(published_at) AS last
                 FROM burned_area_versions WHERE is_latest=1`) || { n: 0, last: null },
  };
}

function pageHtml(lang, cc) {
  const CC = cc.toUpperCase();
  const p = getProfile(CC);
  const caps = getCapabilities({ countryCode: CC, language: lang });
  if (!p || !caps) return null;
  const t = (ns, key, vars) => nsMsg(lang, ns, key, vars) || '';
  const territory = t('seo', `territory_${cc}`);
  const title = t('seo', 'fire_title', { territory });
  const desc = t('seo', 'fire_description', { territory });
  const emergency = t('seo', `emergency_${cc}`);
  const rtl = lang === 'ar';
  const c = liveCounts(CC);
  const fireDict = getNamespace(lang, 'fire') || {};
  const srcDict = getNamespace(lang, 'sources') || {};
  const fmt = (iso) => (iso ? fmtDateTime(iso, { language: lang, countryCode: CC }) : null);

  const path = (l, code) => `/${l}/${code}/incendies`;
  const hreflangs = LANGS.flatMap((l) => CCS.map((code) =>
    `<link rel="alternate" hreflang="${l}-${code.toUpperCase()}" href="${BASE}${path(l, code)}">`))
    .join('\n  ');

  // Sections factuelles — uniquement les capacités RÉELLES du territoire.
  const lastDet = c.det24.last ? fmt(c.det24.last) : null;
  const detLine = c.det24.n > 0
    ? (rtl ? `رُصد خلال الـ24 ساعة الأخيرة ${c.det24.n} شذوذًا حراريًا بالأقمار الاصطناعية فوق ${territory} (آخر رصد: ${lastDet}).`
      : `${c.det24.n} anomalies thermiques ont été observées par satellite au-dessus de ${lang === 'fr' && cc === 'fr' ? 'la France' : territory} ces dernières 24 heures (dernière observation : ${lastDet}).`)
    : (rtl ? `لا أرصاد حرارية بالأقمار الاصطناعية خلال الـ24 ساعة الأخيرة فوق ${territory}.`
      : `Aucune anomalie thermique satellite observée ces dernières 24 heures au-dessus de ${cc === 'fr' ? 'la France' : 'la Tunisie'}.`);
  const firesLine = c.activeFires > 0
    ? (rtl ? `${c.activeFires} تبليغ حريق نشط من المواطنين حاليًا.` : `${c.activeFires} signalement(s) citoyen(s) d'incendie actuellement actifs.`)
    : (rtl ? 'لا تبليغات حرائق نشطة من المواطنين حاليًا.' : `Aucun signalement citoyen d'incendie actif en ce moment.`);
  const burnedBlock = caps.layers.burnedAreas?.enabled && c.burned45.n > 0
    ? `<p>${rtl ? `${c.burned45.n} منطقة محترقة منشورة رسميًا خلال الـ45 يومًا الأخيرة (آخر نشر: ${fmt(c.burned45.last)}).`
      : `${c.burned45.n} contours de zones brûlées publiés par la source officielle européenne sur les 45 derniers jours (dernière publication : ${fmt(c.burned45.last)}).`}</p>` : '';

  const methodology = `
  <h2>${rtl ? 'كيف تُقرأ هذه البيانات؟' : 'Comment lire ces données ?'}</h2>
  <p><strong>${esc(srcDict.thermal_name || '')}.</strong> ${esc(srcDict.thermal_description || '')} ${esc(srcDict.thermal_limitations || '')}</p>
  <p>${esc(fireDict.detection_note || '')} ${esc(fireDict.frp_note || '')}</p>
  ${caps.layers.burnedAreas?.enabled ? `<p><strong>${esc(srcDict.burned_name || '')}.</strong> ${esc(srcDict.burned_description || '')} ${esc(srcDict.burned_limitations || '')}</p>` : ''}
  ${caps.layers.weatherModel?.enabled ? `<p><strong>${esc(srcDict.weather_name || '')}.</strong> ${esc(srcDict.weather_limitations || '')}</p>` : ''}`;

  const appUrl = `/?country=${CC}&lang=${lang}&types=fire`;
  const now = fmt(new Date().toISOString());
  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${BASE}${path(lang, cc)}">
${hreflangs}
  <link rel="alternate" hreflang="x-default" href="${BASE}${path('fr', 'fr')}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${BASE}${path(lang, cc)}">
<meta property="og:image" content="${BASE}/img/og-image.png">
<meta property="og:type" content="website">
<link rel="icon" href="/img/logo-icon.svg" type="image/svg+xml">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: title,
    description: desc,
    url: `${BASE}${path(lang, cc)}`,
    creator: { '@type': 'Organization', name: 'Kifeh', url: BASE },
    license: 'https://github.com/fch1/kifeh',
    isAccessibleForFree: true,
    spatialCoverage: territory,
  })}</script>
<style>
  body{font-family:'IBM Plex Sans',-apple-system,'Segoe UI',sans-serif;background:#FAF7F1;color:#1E2A4D;line-height:1.6;margin:0}
  main{max-width:680px;margin:0 auto;padding:1.25rem 1rem 3rem}
  h1{font-size:1.5rem;line-height:1.3}h2{font-size:1.1rem;margin-top:1.5rem}
  .cta{display:inline-block;background:#E8432E;color:#fff;text-decoration:none;padding:.75rem 1.25rem;border-radius:14px;font-weight:600;margin:.5rem 0}
  .facts{background:#fff;border:1px solid #E7E1D6;border-radius:14px;padding:1rem;margin:1rem 0}
  .muted{color:#5C6B79;font-size:.85rem}
  .emergency{background:#1E2A4D;color:#fff;border-radius:14px;padding:.75rem 1rem;margin:1rem 0}
  a{color:#1E2A4D}.emergency a{color:#fff}
  nav a{margin-inline-end:.75rem}
</style>
</head>
<body>
<main>
  <nav class="muted"><a href="/">Kifeh كيفاه</a> › ${esc(territory)}</nav>
  <h1>${esc(title)}</h1>
  <p>${esc(desc)}</p>
  <p class="emergency"><strong>${esc(emergency)}</strong><br>
  <span>${esc(nsMsg(lang, 'fire', 'emergency_reminder') || '')}</span></p>
  <div class="facts">
    <h2 style="margin-top:0">${esc(nsMsg(lang, 'fire', 'situation_title') || '')}</h2>
    <p>${esc(detLine)}</p>
    <p>${esc(firesLine)}</p>
    ${burnedBlock}
    <p class="muted">${rtl ? `آخر تحديث لهذه الصفحة: ` : `Page actualisée le `}<span dir="ltr">${esc(now)}</span> — ${esc(nsMsg(lang, 'common', 'near_realtime') || '')}.</p>
  </div>
  <a class="cta" href="${appUrl}">${rtl ? 'افتح الخريطة التفاعلية' : 'Ouvrir la carte interactive'} →</a>
  ${methodology}
  <h2>${rtl ? 'روابط مفيدة' : 'Pour aller plus loin'}</h2>
  <p><a href="/faq.html">${rtl ? 'أسئلة شائعة' : 'Questions fréquentes'}</a> ·
     <a href="/a-propos.html">${rtl ? 'حول كيفاه ومصادره' : 'À propos de Kifeh et de ses sources'}</a> ·
     <a href="https://github.com/fch1/kifeh">Open source (GitHub)</a></p>
  <p class="muted">Kifeh كيفاه — ${esc(nsMsg(lang, 'common', 'tagline') || '')}</p>
</main>
</body></html>`;
}

// Les 4 variantes servies, EXPLICITES (Express 5 n'accepte plus les regex
// de paramètres) — rien d'autre n'existe, aucune variante fantôme.
function serve(lang, cc) {
  return (req, res) => {
    const key = `${lang}/${cc}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      return res.set('Cache-Control', 'public, max-age=300').type('html').send(hit.html);
    }
    const html = pageHtml(lang, cc);
    if (!html) return res.status(404).end();
    cache.set(key, { html, at: Date.now() });
    res.set('Cache-Control', 'public, max-age=300').type('html').send(html);
  };
}
for (const lang of LANGS) {
  for (const cc of CCS) seoRouter.get(`/${lang}/${cc}/incendies`, serve(lang, cc));
  // ── Partage social par incident : /i/:publicId (Growth PR 4) ────────────────
// Les robots WhatsApp/Facebook/Telegram n'exécutent pas le JavaScript : cette
// page serveur porte l'Open Graph SPÉCIFIQUE (type, lieu approximatif, statut,
// heure) puis conduit les humains vers l'application. Jamais de coordonnées
// exactes — uniquement les champs déjà publics.
seoRouter.get('/i/:publicId', (req, res) => {
  const row = db.prepare(
    `SELECT public_id, type, status, public_area, started_at,
            COALESCE(country_code,'TN') AS cc
     FROM incidents WHERE public_id = ? AND status IN ('active','resolved','expired')`
  ).get(String(req.params.publicId || ''));
  if (!row) return res.redirect(302, '/');
  const lang = getLang(req) === 'ar' ? 'ar' : 'fr';
  const typeLabel = msg(lang, `push_title_${row.type}`) || 'Kifeh';
  const area = row.public_area || (lang === 'ar' ? 'منطقة تقريبية' : 'zone approximative');
  const when = fmtDateTime(row.started_at, { language: lang, countryCode: row.cc }) || '';
  const ended = row.status !== 'active';
  const statusTxt = ended
    ? (lang === 'ar' ? 'انتهى هذا الحادث.' : 'Cet incident est terminé.')
    : (lang === 'ar' ? 'حادث جارٍ.' : 'Incident en cours.');
  const title = `${typeLabel} — ${area}`;
  const desc = `${statusTxt} ${when}. ${lang === 'ar'
    ? 'المصدر والتوقيت داخل التطبيق — كيفاه لا يعوّض مصالح النجدة.'
    : 'Source et horodatage dans l’application — Kifeh ne remplace pas les secours.'}`;
  const appUrl = `/?incident=${encodeURIComponent(row.public_id)}`;
  res.set('Cache-Control', 'public, max-age=120').type('html').send(`<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Kifeh</title>
<meta name="robots" content="noindex"><!-- page de PARTAGE, pas d'indexation -->
<link rel="canonical" href="${BASE}${appUrl}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${BASE}/img/og-image.png">
<meta property="og:url" content="${BASE}/i/${encodeURIComponent(row.public_id)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${appUrl}">
</head>
<body style="font-family:sans-serif;background:#FAF7F1;color:#1E2A4D;text-align:center;padding:3rem 1rem">
<p><strong>${esc(title)}</strong></p><p>${esc(desc)}</p>
<p><a href="${appUrl}">Kifeh كيفاه →</a></p>
</body></html>`);
});

// Convention : /fr/incendies est ambigu → 301 vers la variante complète.
  seoRouter.get(`/${lang}/incendies`, (req, res) => res.redirect(301, `/${lang}/fr/incendies`));
}
