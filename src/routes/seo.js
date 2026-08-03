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
import { getDailyForecast, forecastEnabled } from '../services/fireForecast.js';
import { summarizeConditions } from '../services/fireForecastSummary.js';

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
  ${(p.seoZones || []).length ? `<h2>${rtl ? 'حسب المنطقة' : (cc === 'fr' ? 'Par département' : 'Par gouvernorat')}</h2>
  <p>${p.seoZones.map((z) => `<a href="/${lang}/${cc}/incendies/${z.slug}">${esc(z.name[lang] || z.name.fr)}</a>`).join(' · ')}</p>` : ''}
  <h2>${rtl ? 'روابط مفيدة' : 'Pour aller plus loin'}</h2>
  <p><a href="/${lang}/${cc}/incendies/comprendre/detections-satellite">${rtl ? 'فهم الأرصاد الفضائية' : 'Comprendre les détections satellite'}</a> ·
     ${cc === 'fr' ? `<a href="/${lang}/fr/incendies/comprendre/reperes-dfci">${rtl ? 'ما هو مربّع DFCI؟' : 'Les repères DFCI'}</a> · ` : ''}<a href="/faq.html">${rtl ? 'أسئلة شائعة' : 'Questions fréquentes'}</a> ·
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
  // Convention : /fr/incendies est ambigu → 301 vers la variante complète.
  seoRouter.get(`/${lang}/incendies`, (req, res) => res.redirect(301, `/${lang}/fr/incendies`));
}

// ── Pages SEO prévisions (master PR 8) : previsions · danger-feu ·
// methodologie-previsions — éditorial STABLE (le dynamique vit dans l'app),
// localisé par territoire via le registre (TN ne mentionne jamais
// Météo-France/EFFIS/DFCI), disclaimer partout. 12 pages (3 × 4 variantes).
const FC_TOPICS = ['previsions', 'danger-feu', 'methodologie-previsions'];

function fcHead(lang, cc, topic, title, desc) {
  const path = (l, c) => `/${l}/${c}/incendies/${topic}`;
  const hreflangs = LANGS.flatMap((l) => CCS.map((c) =>
    `<link rel="alternate" hreflang="${l}-${c.toUpperCase()}" href="${BASE}${path(l, c)}">`)).join('\n');
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${BASE}${path(lang, cc)}">
${hreflangs}
<link rel="alternate" hreflang="x-default" href="${BASE}${path('fr', 'fr')}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${BASE}/img/og-image.png"><meta property="og:type" content="website">
<link rel="icon" href="/img/logo-icon.svg" type="image/svg+xml">
<style>body{font-family:'IBM Plex Sans',-apple-system,sans-serif;background:#FAF7F1;color:#1E2A4D;line-height:1.65;margin:0}
main{max-width:680px;margin:0 auto;padding:1.25rem 1rem 3rem}h1{font-size:1.4rem;line-height:1.3}h2{font-size:1.05rem;margin-top:1.4rem}
.muted{color:#5C6B79;font-size:.85rem}.box{background:#fff;border:1px solid #E7E1D6;border-radius:14px;padding:1rem;margin:1rem 0}
.disc{background:#1E2A4D;color:#fff;border-radius:14px;padding:.75rem 1rem}a{color:#1E2A4D}</style>`;
}

async function fcPageHtml(lang, cc, topic) {
  const CC = cc.toUpperCase();
  const caps = getCapabilities({ countryCode: CC, language: lang });
  if (!caps) return null;
  const rtl = lang === 'ar';
  const territory = nsMsg(lang, 'seo', `territory_${cc}`) || CC;
  const disclaimer = nsMsg(lang, 'fire', 'forecast_disclaimer') || '';
  const modelLabel = cc === 'fr'
    ? 'Météo-France (AROME/ARPEGE) via Open-Meteo'
    : (rtl ? 'نموذج عالمي عبر Open-Meteo' : 'Modèle global via Open-Meteo');
  let h1, desc, body;
  if (topic === 'previsions') {
    h1 = rtl ? `توقّعات الظروف الجوية للحرائق — ${territory}` : `Prévisions des conditions favorisant les feux — ${territory}`;
    desc = rtl ? `توقّع 3 إلى 7 أيام للعوامل الجوية (رياح، رطوبة، حرارة، أمطار) في ${territory}. ظروف — لا تنبؤ بالحرائق.`
      : `Prévision 3 à 7 jours des facteurs météo (vent, humidité, température, pluie) en ${territory}. Des conditions — jamais une prévision d'incendie.`;
    let live = '';
    if (forecastEnabled(CC)) {
      const p = getProfile(CC);
      const f = await getDailyForecast(p.map.defaultCenter[0], p.map.defaultCenter[1], CC).catch(() => null);
      const sum = f ? summarizeConditions(f.days, lang) : null;
      if (sum) live = `<div class="box"><p style="margin:0">${esc(sum)}</p>
        <p class="muted" style="margin:.4rem 0 0">${esc(rtl ? 'خلاصة اليوم — التفاصيل داخل التطبيق.' : 'Synthèse du jour — le détail vit dans l’application.')}</p></div>`;
    }
    body = `${live}
      <h2>${rtl ? 'ما الذي نعرضه؟' : 'Ce que Kifeh affiche'}</h2>
      <p>${rtl ? `عوامل جوية يومية (أقصى حرارة، أدنى رطوبة، رياح وهبّات، أمطار) على 3 أيام بشكل مبسّط و7 أيام للتعمّق، من ${modelLabel}. الأيام البعيدة تُعرض كاتجاه أقل يقينًا.`
    : `Des facteurs météo quotidiens (température max, humidité min, vent et rafales, pluie) sur 3 jours en un regard et 7 jours en approfondissement, issus de ${modelLabel}. Les échéances lointaines sont présentées comme une tendance, moins certaine.`}</p>
      <h2>${rtl ? 'ما الذي لا نعرضه؟' : 'Ce que Kifeh n’affiche jamais'}</h2>
      <p>${rtl ? 'لا مواقع حرائق مستقبلية، لا محيطات متوقّعة، لا ساعة وصول، لا درجة خطر من صنعنا.'
    : 'Aucun futur point de feu, aucun périmètre supposé, aucune heure d’arrivée, aucun score de risque maison.'}</p>`;
  } else if (topic === 'danger-feu') {
    h1 = rtl ? `فهم خطر الحرائق — ${territory}` : `Comprendre le danger de feu — ${territory}`;
    desc = rtl ? 'ما الذي يجعل الظروف مساعِدة على اندلاع الحرائق وانتشارها: رياح، جفاف، حرارة، رطوبة.'
      : 'Ce qui rend des conditions favorables aux départs et à la propagation : vent, sécheresse, chaleur, humidité.';
    body = `<h2>${rtl ? 'العوامل' : 'Les facteurs'}</h2>
      <p>${rtl ? 'الرياح تسرّع الانتشار وتحمل الجمرات؛ الرطوبة المنخفضة تجفّف الغطاء النباتي؛ الحرارة العالية والجفاف يراكمان القابلية للاشتعال؛ الأمطار تقلّلها مؤقتًا.'
    : 'Le vent accélère la propagation et transporte des brandons ; une humidité basse assèche la végétation ; la chaleur et la sécheresse cumulent l’inflammabilité ; la pluie la réduit temporairement.'}</p>
      <h2>${rtl ? 'المستويات الرسمية' : 'Les niveaux officiels'}</h2>
      <p>${cc === 'fr'
    ? (rtl ? 'في فرنسا تنشر الجهات الرسمية تحذيرات (اليقظة) تعرضها كيفاه كما هي، بمصدرها ووقتها.'
      : 'En France, la vigilance officielle est affichée telle quelle dans Kifeh, avec sa source et son heure. Kifeh n’invente jamais de niveau : quand aucun niveau officiel n’existe pour une zone, seuls les facteurs météo sont montrés.')
    : (rtl ? 'لا مصدر رسمي متاحًا حاليًا لتونس داخل كيفاه: نعرض العوامل الجوية فقط، بصدق — دون اختراع مستوى.'
      : 'Aucune source officielle de danger n’est disponible pour la Tunisie dans Kifeh à ce jour : seuls les facteurs météo sont montrés, honnêtement — jamais un niveau inventé.')}</p>`;
  } else {
    h1 = rtl ? `منهجية التوقّعات — ${territory}` : `Méthodologie des prévisions — ${territory}`;
    desc = rtl ? 'المصادر حسب الأفق الزمني، الثقة، وما لا يُتوقَّع أبدًا.'
      : 'Les sources par horizon, la confiance, et ce qui n’est jamais prédit.';
    body = `<h2>${rtl ? 'المصادر حسب الأفق' : 'Sources par horizon'}</h2>
      <p>${rtl ? `من اليوم إلى يومين: ${modelLabel} (ثقة عالية). من 3 إلى 4 أيام: المصدر نفسه (ثقة متوسطة). بعد ذلك: اتجاه أقل يقينًا، ويُقال ذلك صراحة.`
    : `J0-J+2 : ${modelLabel} (confiance élevée). J+3-J+4 : même source (confiance moyenne). Au-delà : tendance, moins certaine — et c’est écrit en toutes lettres.`}</p>
      <p>${rtl ? 'لا دمج صامتًا بين نماذج؛ غياب البيانات يُعلن؛ كل قيمة تحمل مصدرها ووقت جلبها.'
    : 'Jamais de fusion silencieuse de modèles ; l’absence de donnée est dite ; chaque valeur porte sa source et son heure de récupération.'}</p>
      <h2>${rtl ? 'حدود التوقّع' : 'Les limites'}</h2>
      <p>${rtl ? 'التوقّع يصف الغلاف الجوي، لا سلوك حريق بعينه: التضاريس والغطاء النباتي والتدخّل البشري تغيّر كل شيء.'
    : 'La prévision décrit l’atmosphère, pas le comportement d’un feu précis : relief, végétation et intervention humaine changent tout.'}</p>`;
  }
  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head>${fcHead(lang, cc, topic, h1, desc)}</head>
<body><main>
<nav class="muted"><a href="/">Kifeh كيفاه</a> › <a href="/${lang}/${cc}/incendies">${esc(territory)}</a></nav>
<h1>${esc(h1)}</h1>
<p class="disc"><strong>${esc(disclaimer)}</strong></p>
${body}
<p><a href="/${lang}/${cc}/incendies">${rtl ? '→ خريطة الحرائق' : '→ Carte des feux'} — ${esc(territory)}</a> · <a href="/?country=${CC}&lang=${lang}">${rtl ? 'التطبيق' : 'l’application'}</a></p>
<p class="muted">Kifeh كيفاه — ${esc(nsMsg(lang, 'common', 'tagline') || '')}</p>
</main></body></html>`;
}

for (const lang of LANGS) {
  for (const cc of CCS) {
    for (const topic of FC_TOPICS) {
      seoRouter.get(`/${lang}/${cc}/incendies/${topic}`, async (req, res) => {
        const key = `${lang}/${cc}/${topic}`;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < CACHE_MS) return res.set('Cache-Control', 'public, max-age=600').type('html').send(hit.html);
        const html = await fcPageHtml(lang, cc, topic);
        if (!html) return res.status(404).end();
        cache.set(key, { html, at: Date.now() });
        res.set('Cache-Control', 'public, max-age=600').type('html').send(html);
      });
    }
  }
}

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
  // Libellé NEUTRE du type (jamais « près de chez vous » : le destinataire
  // d'un partage peut être n'importe où).
  const raw = msg(lang, `type_${row.type}`) || msg(lang, 'push_title_generic') || 'Incident';
  const typeLabel = raw.charAt(0).toUpperCase() + raw.slice(1);
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

// ── Sitemap GÉNÉRÉ depuis les registres (#83) ───────────────────────────────
// Fini le fichier statique qui dérive : le plan du site est produit des mêmes
// boucles que les routes (langues × territoires × sujets × zones du registre
// pays). Une page qui existe est listée ; une page retirée disparaît seule.
seoRouter.get('/sitemap.xml', (req, res) => {
  const hit = cache.get('sitemap');
  if (hit && Date.now() - hit.at < 3600_000) {
    return res.set('Cache-Control', 'public, max-age=3600').type('application/xml').send(hit.html);
  }
  const staticPages = [
    { loc: '/', freq: 'hourly', prio: '1.0', langParam: true },
    { loc: '/declare.html', freq: 'monthly', prio: '0.8', langParam: true },
    { loc: '/faq.html', freq: 'monthly', prio: '0.7', langParam: true },
    { loc: '/a-propos.html', freq: 'monthly', prio: '0.6', langParam: true },
    { loc: '/legal.html', freq: 'monthly', prio: '0.4', langParam: true },
  ];
  const urls = [];
  for (const s of staticPages) {
    urls.push(`  <url>
    <loc>${BASE}${s.loc}</loc>
    <changefreq>${s.freq}</changefreq>
    <priority>${s.prio}</priority>
    <xhtml:link rel="alternate" hreflang="fr" href="${BASE}${s.loc}?lang=fr"/>
    <xhtml:link rel="alternate" hreflang="ar" href="${BASE}${s.loc}?lang=ar"/>
  </url>`);
  }
  const add = (path, freq, prio) => urls.push(`  <url>
    <loc>${BASE}${path}</loc>
    <changefreq>${freq}</changefreq>
    <priority>${prio}</priority>
  </url>`);
  for (const lang of LANGS) {
    for (const cc of CCS) {
      add(`/${lang}/${cc}/incendies`, 'hourly', '0.9');
      for (const topic of ['previsions', 'danger-feu', 'methodologie-previsions']) {
        add(`/${lang}/${cc}/incendies/${topic}`, 'weekly', '0.7');
      }
      for (const z of getProfile(cc.toUpperCase())?.seoZones || []) {
        add(`/${lang}/${cc}/incendies/${z.slug}`, 'daily', '0.8');
      }
      add(`/${lang}/${cc}/incendies/comprendre/detections-satellite`, 'monthly', '0.6');
      if (cc === 'fr') add(`/${lang}/fr/incendies/comprendre/reperes-dfci`, 'monthly', '0.6');
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
  cache.set('sitemap', { html: xml, at: Date.now() });
  res.set('Cache-Control', 'public, max-age=3600').type('application/xml').send(xml);
});

// ── Pages départementales / par gouvernorat UTILES (#83) ────────────────────
// Une page par zone déclarée dans le REGISTRE pays (seoZones) : données
// VIVANTES de la zone (détections 24 h, signalements actifs — jamais une page
// vide), numéros d'urgence du territoire, lien profond vers la carte centrée.
// Emprises approximatives assumées (« autour de »), hreflang fr↔ar par zone.
function zoneCounts(CC, b) {
  const g = (sql, ...p) => { try { return db.prepare(sql).get(...p); } catch { return null; } };
  return {
    det24: g(`SELECT COUNT(*) AS n, MAX(acquired_at) AS last FROM satellite_detections
              WHERE country_code=? AND acquired_at > datetime('now','-1 day')
                AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
    CC, b.minLat, b.maxLat, b.minLng, b.maxLng) || { n: 0, last: null },
    actives: g(`SELECT COUNT(*) AS n FROM incidents WHERE status='active'
                AND COALESCE(country_code,'TN')=?
                AND public_lat BETWEEN ? AND ? AND public_lng BETWEEN ? AND ?`,
    CC, b.minLat, b.maxLat, b.minLng, b.maxLng)?.n ?? 0,
    fires: g(`SELECT COUNT(*) AS n FROM incidents WHERE status='active' AND type='fire'
              AND COALESCE(country_code,'TN')=?
              AND public_lat BETWEEN ? AND ? AND public_lng BETWEEN ? AND ?`,
    CC, b.minLat, b.maxLat, b.minLng, b.maxLng)?.n ?? 0,
  };
}

function zonePageHtml(lang, cc, zone) {
  const CC = cc.toUpperCase();
  const caps = getCapabilities({ countryCode: CC, language: lang });
  if (!caps) return null;
  const rtl = lang === 'ar';
  const name = zone.name[lang] || zone.name.fr;
  const territory = nsMsg(lang, 'seo', `territory_${cc}`) || CC;
  const title = rtl
    ? `${name}: الحرائق والحوادث — خريطة شبه فورية`
    : `${name} : incendies et incidents — carte en quasi temps réel`;
  const desc = rtl
    ? `الوضع الحالي في ${name} (${territory}): أرصاد حرارية بالأقمار الاصطناعية، تبليغات المواطنين، أرقام النجدة. مجانًا وبدون حساب.`
    : `La situation actuelle à ${name} (${territory}) : détections satellite, signalements citoyens, numéros d'urgence. Gratuit, sans compte.`;
  const c = zoneCounts(CC, zone.bbox);
  const fmt = (iso) => (iso ? fmtDateTime(iso, { language: lang, countryCode: CC }) : null);
  const path = (l) => `/${l}/${cc}/incendies/${zone.slug}`;
  const emg = emergencyLine(CC, lang, 'fire') || '';
  const srcDict = getNamespace(lang, 'sources') || {};
  const fireDict = getNamespace(lang, 'fire') || {};

  const detLine = c.det24.n > 0
    ? (rtl ? `رُصد ${c.det24.n} شذوذًا حراريًا بالأقمار الاصطناعية حول ${name} خلال الـ24 ساعة الأخيرة (آخر رصد: ${fmt(c.det24.last)}).`
      : `${c.det24.n} anomalie(s) thermique(s) observée(s) par satellite autour de ${name} ces dernières 24 heures (dernière : ${fmt(c.det24.last)}).`)
    : (rtl ? `لا أرصاد حرارية بالأقمار الاصطناعية حول ${name} خلال الـ24 ساعة الأخيرة.`
      : `Aucune anomalie thermique satellite observée autour de ${name} ces dernières 24 heures.`);
  const actLine = c.actives > 0
    ? (rtl ? `${c.actives} تبليغ نشط من المواطنين في المنطقة${c.fires > 0 ? ` (منها ${c.fires} حريق)` : ''}.`
      : `${c.actives} signalement(s) citoyen(s) actif(s) dans la zone${c.fires > 0 ? ` (dont ${c.fires} incendie(s))` : ''}.`)
    : (rtl ? 'لا تبليغات نشطة من المواطنين في المنطقة حاليًا.'
      : 'Aucun signalement citoyen actif dans la zone en ce moment.');

  const appUrl = `/?country=${CC}&lang=${lang}&types=fire&lat=${zone.center[0]}&lng=${zone.center[1]}&z=${zone.zoom || 10}`;
  const now = fmt(new Date().toISOString());
  return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${BASE}${path(lang)}">
<link rel="alternate" hreflang="fr-${CC}" href="${BASE}${path('fr')}">
<link rel="alternate" hreflang="ar-${CC}" href="${BASE}${path('ar')}">
<link rel="alternate" hreflang="x-default" href="${BASE}${path('fr')}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${BASE}/img/og-image.png"><meta property="og:type" content="website">
<link rel="icon" href="/img/logo-icon.svg" type="image/svg+xml">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Dataset',
    name: title, description: desc, url: `${BASE}${path(lang)}`,
    creator: { '@type': 'Organization', name: 'Kifeh', url: BASE },
    isAccessibleForFree: true, spatialCoverage: `${name}, ${territory}`,
  })}</script>
<style>body{font-family:'IBM Plex Sans',-apple-system,sans-serif;background:#FAF7F1;color:#1E2A4D;line-height:1.6;margin:0}
main{max-width:680px;margin:0 auto;padding:1.25rem 1rem 3rem}h1{font-size:1.45rem;line-height:1.3}h2{font-size:1.05rem;margin-top:1.4rem}
.cta{display:inline-block;background:#E8432E;color:#fff;text-decoration:none;padding:.75rem 1.25rem;border-radius:14px;font-weight:600;margin:.5rem 0}
.facts{background:#fff;border:1px solid #E7E1D6;border-radius:14px;padding:1rem;margin:1rem 0}
.muted{color:#5C6B79;font-size:.85rem}.emergency{background:#1E2A4D;color:#fff;border-radius:14px;padding:.75rem 1rem;margin:1rem 0}
a{color:#1E2A4D}.emergency a{color:#fff}</style>
</head>
<body><main>
<nav class="muted"><a href="/">Kifeh كيفاه</a> › <a href="/${lang}/${cc}/incendies">${esc(territory)}</a> › ${esc(name)}</nav>
<h1>${esc(title)}</h1>
<p>${esc(desc)}</p>
<p class="emergency"><strong>${esc(emg)}</strong><br><span>${esc(nsMsg(lang, 'fire', 'emergency_reminder') || '')}</span></p>
<div class="facts">
  <h2 style="margin-top:0">${esc(nsMsg(lang, 'fire', 'situation_title') || '')}</h2>
  <p>${esc(detLine)}</p>
  <p>${esc(actLine)}</p>
  <p class="muted">${rtl ? 'الأعداد محسوبة على منطقة تقريبية حول ' : 'Comptes calculés sur une emprise approximative autour de '}${esc(name)} — ${rtl ? 'آخر تحديث: ' : 'page actualisée le '}<span dir="ltr">${esc(now)}</span>.</p>
</div>
<a class="cta" href="${appUrl}">${rtl ? `افتح الخريطة على ${name}` : `Ouvrir la carte sur ${name}`} →</a>
<h2>${rtl ? 'كيف تُقرأ هذه البيانات؟' : 'Comment lire ces données ?'}</h2>
<p>${esc(fireDict.detection_note || '')} ${esc(srcDict.thermal_limitations || '')}</p>
<p><a href="/${lang}/${cc}/incendies/comprendre/detections-satellite">${rtl ? '→ فهم الأرصاد الفضائية' : '→ Comprendre les détections satellite'}</a>${cc === 'fr' ? ` · <a href="/${lang}/fr/incendies/comprendre/reperes-dfci">${rtl ? 'ما هو مربّع DFCI؟' : 'Qu’est-ce qu’un repère DFCI ?'}</a>` : ''}</p>
<p><a href="/${lang}/${cc}/incendies">${rtl ? `→ صفحة ${territory} الكاملة` : `→ La page ${territory} complète`}</a></p>
<p class="muted">Kifeh كيفاه — ${esc(nsMsg(lang, 'common', 'tagline') || '')}</p>
</main></body></html>`;
}

for (const lang of LANGS) {
  for (const cc of CCS) {
    const zones = getProfile(cc.toUpperCase())?.seoZones || [];
    for (const zone of zones) {
      seoRouter.get(`/${lang}/${cc}/incendies/${zone.slug}`, (req, res) => {
        const key = `${lang}/${cc}/z/${zone.slug}`;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < CACHE_MS) return res.set('Cache-Control', 'public, max-age=300').type('html').send(hit.html);
        const html = zonePageHtml(lang, cc, zone);
        if (!html) return res.status(404).end();
        cache.set(key, { html, at: Date.now() });
        res.set('Cache-Control', 'public, max-age=300').type('html').send(html);
      });
    }
  }
}

// ── Pages « comprendre » par source (#83) : pédagogie honnête ───────────────
// detections-satellite (FR + TN) · reperes-dfci (FRANCE UNIQUEMENT — le
// carroyage DFCI est un concept français : la variante tunisienne N'EXISTE
// PAS, elle répond 404, conformément au registre de capacités).
function comprendreHtml(lang, cc, topic) {
  const CC = cc.toUpperCase();
  const caps = getCapabilities({ countryCode: CC, language: lang });
  if (!caps) return null;
  if (topic === 'reperes-dfci' && caps.layers.emergencyGrid?.enabled !== true) return null;
  const rtl = lang === 'ar';
  const territory = nsMsg(lang, 'seo', `territory_${cc}`) || CC;
  const srcDict = getNamespace(lang, 'sources') || {};
  const fireDict = getNamespace(lang, 'fire') || {};
  let h1, desc, body;
  if (topic === 'detections-satellite') {
    h1 = rtl ? 'كيف تُقرأ الأرصاد الفضائية للحرائق؟' : 'Comment lire une détection satellite de feu ?';
    desc = rtl ? 'ما الذي يراه القمر الاصطناعي فعلًا، ما دلالة الثقة وFRP، وما حدود هذه البيانات.'
      : 'Ce que le satellite observe vraiment, ce que signifient la confiance et la FRP, et les limites honnêtes de cette donnée.';
    body = `
<h2>${rtl ? 'ما الذي يُرصد؟' : 'Ce qui est observé'}</h2>
<p>${rtl ? 'ترصد أقمار وكالة ناسا (أجهزة MODIS وVIIRS) شذوذات حرارية على سطح الأرض عدة مرات يوميًا. الشذوذ الحراري نقطة أكثر سخونة من محيطها — غالبًا حريق، لكنه قد يكون أيضًا شعلة صناعية أو انعكاس شمس.'
    : 'Les satellites de la NASA (instruments MODIS et VIIRS) repèrent des anomalies thermiques à la surface, plusieurs fois par jour. Une anomalie est un point plus chaud que son environnement — souvent un feu, mais parfois aussi une torchère industrielle ou un reflet solaire.'}</p>
<p><strong>${esc(fireDict.detection_note || '')}</strong></p>
<h2>${rtl ? 'الثقة' : 'La confiance'}</h2>
<p>${rtl ? 'يرفق كل رصد بدرجة ثقة (ضعيفة، متوسطة، مرتفعة) تحسبها ناسا. الثقة المرتفعة تعني شذوذًا واضحًا — لا تعني تأكيدًا رسميًا لحريق.'
    : 'Chaque détection porte un niveau de confiance (faible, nominal, élevé) calculé par la NASA. Une confiance élevée signifie une anomalie nette — jamais une confirmation officielle d’incendie.'}</p>
<h2>${rtl ? 'FRP: شدة وليست مساحة' : 'La FRP : une intensité, pas une surface'}</h2>
<p>${rtl ? 'القدرة الإشعاعية (FRP) تقيس بالميغاواط شدة الإشعاع الحراري لحظة المرور. لا تقول شيئًا عن مساحة الحريق ولا حجمه ولا محيطه.'
    : 'La puissance radiative (FRP) mesure, en mégawatts, l’intensité du rayonnement thermique au moment du passage. Elle ne dit RIEN de la surface, de la taille ni du périmètre d’un feu.'} ${esc(fireDict.frp_note || '')}</p>
<h2>${rtl ? 'الحدود' : 'Les limites'}</h2>
<p>${rtl ? 'بين مرورين للقمر قد تمضي ساعات؛ الغيوم والدخان الكثيف يحجبان الرصد؛ النقطة المعروضة تقريبية (بضع مئات من الأمتار). لهذا تعرض كيفاه دائمًا وقت الرصد، وتخفّف ألوان الأرصاد القديمة.'
    : 'Entre deux passages, des heures peuvent s’écouler ; les nuages et une fumée dense masquent l’observation ; le point affiché est approximatif (quelques centaines de mètres). C’est pourquoi Kifeh affiche toujours l’heure d’observation et estompe les détections anciennes.'} ${esc(srcDict.thermal_limitations || '')}</p>`;
  } else {
    h1 = rtl ? 'ما هو مربّع DFCI؟' : 'Qu’est-ce qu’un repère DFCI ?';
    desc = rtl ? 'شبكة تربيع يستعملها رجال الإطفاء في فرنسا لتحديد المواقع — وكيف تعرضها كيفاه بدقة كيلومترين إرشادية.'
      : 'Le carroyage utilisé par les services de lutte contre l’incendie en France pour se localiser — et comment Kifeh l’affiche, avec une précision indicative de 2 km.';
    body = `
<h2>${rtl ? 'الفكرة' : 'Le principe'}</h2>
<p>${rtl ? 'DFCI (الدفاع عن الغابات ضد الحرائق) شبكة مربعات تغطي فرنسا، يتواصل بها المتدخلون ميدانيًا: بدل إحداثيات طويلة، رمز قصير مثل KD64D6 يعيّن مربعًا بعينه.'
    : 'Le carroyage DFCI (Défense des Forêts Contre l’Incendie) découpe la France en carreaux. Les intervenants se le partagent sur le terrain : plutôt que de longues coordonnées, un code court comme KD64D6 désigne un carreau précis.'}</p>
<h2>${rtl ? 'في كيفاه' : 'Dans Kifeh'}</h2>
<p>${rtl ? 'تعرض كيفاه رمز المربّع (بدقة كيلومترين) في بطاقات الأحداث الفرنسية، للمساعدة على التواصل مع المصالح — الحساب يتم على الخادم انطلاقًا من الموقع الدقيق، الذي لا يُنشر أبدًا للعموم.'
    : 'Kifeh affiche le carreau (précision 2 km) dans les fiches d’incidents en France, comme aide à la communication avec les services — le calcul se fait côté serveur depuis la position exacte, qui n’est jamais publiée.'}</p>
<h2>${rtl ? 'حدود صريحة' : 'Des limites assumées'}</h2>
<p>${rtl ? 'الرمز إرشادي: لا يعوّض تحديد الموقع الذي تطلبه مصالح النجدة أثناء المكالمة. عند الاتصال بـ112 أو 18، اتبعوا تعليمات المُجيب.'
    : 'Le repère est indicatif : il ne remplace jamais la localisation demandée par les secours pendant l’appel. Au 112 ou au 18, suivez les consignes de l’opérateur.'}</p>`;
  }
  const path = (l) => `/${l}/${cc}/incendies/comprendre/${topic}`;
  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(h1)} — Kifeh</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${BASE}${path(lang)}">
<link rel="alternate" hreflang="fr-${CC}" href="${BASE}${path('fr')}">
<link rel="alternate" hreflang="ar-${CC}" href="${BASE}${path('ar')}">
<link rel="alternate" hreflang="x-default" href="${BASE}${path('fr')}">
<meta property="og:title" content="${esc(h1)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${BASE}/img/og-image.png"><meta property="og:type" content="article">
<link rel="icon" href="/img/logo-icon.svg" type="image/svg+xml">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Article',
    headline: h1, description: desc, inLanguage: lang,
    author: { '@type': 'Organization', name: 'Kifeh', url: BASE },
  })}</script>
<style>body{font-family:'IBM Plex Sans',-apple-system,sans-serif;background:#FAF7F1;color:#1E2A4D;line-height:1.65;margin:0}
main{max-width:680px;margin:0 auto;padding:1.25rem 1rem 3rem}h1{font-size:1.4rem;line-height:1.3}h2{font-size:1.05rem;margin-top:1.4rem}
.muted{color:#5C6B79;font-size:.85rem}a{color:#1E2A4D}</style>
</head><body><main>
<nav class="muted"><a href="/">Kifeh كيفاه</a> › <a href="/${lang}/${cc}/incendies">${esc(territory)}</a></nav>
<h1>${esc(h1)}</h1>
${body}
<p><a href="/${lang}/${cc}/incendies">${rtl ? '→ خريطة الحرائق' : '→ Carte des feux'} — ${esc(territory)}</a> · <a href="/?country=${CC}&lang=${lang}">${rtl ? 'التطبيق' : 'l’application'}</a></p>
<p class="muted">Kifeh كيفاه — ${esc(nsMsg(lang, 'common', 'tagline') || '')}</p>
</main></body></html>`;
}

for (const lang of LANGS) {
  for (const cc of CCS) {
    for (const topic of ['detections-satellite', 'reperes-dfci']) {
      seoRouter.get(`/${lang}/${cc}/incendies/comprendre/${topic}`, (req, res) => {
        const key = `${lang}/${cc}/c/${topic}`;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < CACHE_MS) return res.set('Cache-Control', 'public, max-age=600').type('html').send(hit.html);
        const html = comprendreHtml(lang, cc, topic);
        if (!html) return res.status(404).end(); // ex. DFCI côté tunisien : n'existe pas
        cache.set(key, { html, at: Date.now() });
        res.set('Cache-Control', 'public, max-age=600').type('html').send(html);
      });
    }
  }
}
