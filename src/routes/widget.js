// Widget embarquable + kit média (#93) — amplification sans risque UI.
// Deux surfaces AUTONOMES (jamais l'écran de l'application) :
//   · GET /widget : carte de situation COMPACTE, rendue serveur, zéro
//     JavaScript (méta-rafraîchissement 10 min) — encapsulable en iframe par
//     une mairie, une association, un média local. Seule route du site qui
//     AUTORISE l'encapsulation (frame-ancestors *) ; noindex ; jamais de
//     coordonnées exactes (comptes agrégés uniquement).
//   · GET /presse : kit média — Kifeh en bref, chiffres vivants, logos,
//     extraits d'intégration prêts à coller. Contact via GitHub (jamais un
//     courriel personnel publié).
import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { getProfile, enabledCountries } from '../countries/index.js';
import { getCapabilities } from '../services/capabilityRegistry.js';
import { nsMsg } from '../services/i18nNamespaces.js';
import { fmtDateTime } from '../services/localizationFormatter.js';

export const widgetRouter = Router();
const BASE = 'https://kifeh.app';
const multiCountry = () => getSetting('multi_country_enabled') === '1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const cache = new Map();
const CACHE_MS = 5 * 60_000;

// Emprise approximative autour d'un point (jamais une frontière exacte).
function aroundBbox(lat, lng, radiusKm) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

function widgetCounts(CC, b) {
  const g = (sql, ...p) => { try { return db.prepare(sql).get(...p); } catch { return null; } };
  const where = b
    ? 'AND public_lat BETWEEN ? AND ? AND public_lng BETWEEN ? AND ?'
    : '';
  const args = b ? [b.minLat, b.maxLat, b.minLng, b.maxLng] : [];
  return {
    actives: g(`SELECT COUNT(*) AS n FROM incidents WHERE status='active'
                AND COALESCE(country_code,'TN')=? ${where}`, CC, ...args)?.n ?? 0,
    byType: db.prepare(`SELECT type, COUNT(*) AS n FROM incidents WHERE status='active'
                        AND COALESCE(country_code,'TN')=? ${where} GROUP BY type ORDER BY n DESC`)
      .all(CC, ...args),
    det24: b
      ? (g(`SELECT COUNT(*) AS n, MAX(acquired_at) AS last FROM satellite_detections
            WHERE country_code=? AND acquired_at > datetime('now','-1 day')
              AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`, CC, ...args) || { n: 0, last: null })
      : (g(`SELECT COUNT(*) AS n, MAX(acquired_at) AS last FROM satellite_detections
            WHERE country_code=? AND acquired_at > datetime('now','-1 day')`, CC) || { n: 0, last: null }),
  };
}

const TYPE_EMOJI = { fire: '🔥', electricity: '⚡', water: '💧', internet: '📶' };

// ── /widget ──────────────────────────────────────────────────────────────────
widgetRouter.get('/widget', (req, res) => {
  const lang = req.query.lang === 'ar' ? 'ar' : 'fr';
  const rtl = lang === 'ar';
  const countries = multiCountry() ? enabledCountries() : ['TN'];
  const CC = countries.includes(String(req.query.country || '').toUpperCase())
    ? String(req.query.country).toUpperCase() : 'TN';
  const cc = CC.toLowerCase();
  const p = getProfile(CC);
  const caps = getCapabilities({ countryCode: CC, language: lang });
  if (!p || !caps) return res.status(404).end();

  // Zone du registre OU point libre — sinon, tout le territoire.
  let label = nsMsg(lang, 'seo', `territory_${cc}`) || CC;
  let bbox = null;
  let center = null;
  let zoom = p.map.defaultZoom;
  if (req.query.zone) {
    const z = (p.seoZones || []).find((x) => x.slug === String(req.query.zone));
    if (!z) return res.status(404).end(); // zone inconnue : explicite, jamais silencieux
    label = z.name[lang] || z.name.fr;
    bbox = z.bbox;
    center = z.center;
    zoom = z.zoom || 10;
  } else {
    const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      const radiusKm = Math.min(100, Math.max(5, parseFloat(req.query.radiusKm) || 30));
      bbox = aroundBbox(lat, lng, radiusKm);
      center = [lat, lng];
      zoom = 10;
      label = rtl ? `حول نقطتكم (${Math.round(radiusKm)} كم)` : `autour de votre point (${Math.round(radiusKm)} km)`;
    }
  }

  const key = `w/${lang}/${cc}/${req.query.zone || ''}/${center ? center.join(',') : 'all'}/${req.query.radiusKm || ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    allowFraming(res);
    return res.set('Cache-Control', 'public, max-age=300').type('html').send(hit.html);
  }

  const c = widgetCounts(CC, bbox);
  const satOn = caps.layers.thermalDetections?.enabled === true;
  const fmt = (iso) => (iso ? fmtDateTime(iso, { language: lang, countryCode: CC }) : null);
  const appUrl = center
    ? `${BASE}/?country=${CC}&lang=${lang}&lat=${center[0]}&lng=${center[1]}&z=${zoom}&utm_source=widget&utm_medium=embed&utm_campaign=partner_widget`
    : `${BASE}/?country=${CC}&lang=${lang}&utm_source=widget&utm_medium=embed&utm_campaign=partner_widget`;

  const typeBits = c.byType.filter((x) => TYPE_EMOJI[x.type]).slice(0, 4)
    .map((x) => `<span class="tb">${TYPE_EMOJI[x.type]} ${x.n}</span>`).join(' ');
  const activesLine = c.actives > 0
    ? (rtl ? `${c.actives} تبليغ نشط` : `${c.actives} signalement(s) actif(s)`)
    : (rtl ? 'لا تبليغات نشطة' : 'Aucun signalement actif');
  const satLine = !satOn ? '' : (c.det24.n > 0
    ? (rtl ? `🛰️ ${c.det24.n} رصدًا حراريًا خلال 24 ساعة` : `🛰️ ${c.det24.n} détection(s) satellite en 24 h`)
    : (rtl ? '🛰️ لا أرصاد حرارية خلال 24 ساعة' : '🛰️ Aucune détection satellite en 24 h'));
  const updated = fmt(new Date().toISOString());

  const html = `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><!-- surface d'intégration, pas une page -->
<meta http-equiv="refresh" content="600"><!-- rafraîchi toutes les 10 min, sans JS -->
<title>Kifeh — ${esc(label)}</title>
<style>
  html,body{margin:0;padding:0;background:transparent}
  .kw{box-sizing:border-box;font-family:'IBM Plex Sans',-apple-system,'Segoe UI',sans-serif;
    background:#FAF7F1;color:#1E2A4D;border:1px solid #E7E1D6;border-radius:14px;
    padding:12px 14px;max-width:340px;line-height:1.45;font-size:14px}
  .kw a{color:#1E2A4D}
  .hd{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .hd img{width:22px;height:22px}
  .hd strong{font-size:15px}
  .zone{color:#5C6B79;font-size:12.5px;margin-bottom:8px}
  .n{font-weight:700}
  .tb{display:inline-block;background:#fff;border:1px solid #E7E1D6;border-radius:999px;
    padding:1px 8px;margin:2px 2px 2px 0;font-size:12.5px}
  .go{display:inline-block;margin-top:8px;background:#E8432E;color:#fff !important;
    text-decoration:none;padding:6px 12px;border-radius:999px;font-weight:600;font-size:13px}
  .ft{color:#5C6B79;font-size:11px;margin-top:8px}
</style>
</head>
<body>
<div class="kw">
  <div class="hd"><img src="${BASE}/img/logo.svg" alt=""><strong>Kifeh كيفاه</strong></div>
  <div class="zone">${esc(label)}</div>
  <div><span class="n">${esc(activesLine)}</span>${typeBits ? `<br>${typeBits}` : ''}</div>
  ${satLine ? `<div style="margin-top:4px">${esc(satLine)}</div>` : ''}
  <a class="go" href="${appUrl}" target="_blank" rel="noopener">${rtl ? 'افتح الخريطة' : 'Voir la carte'} →</a>
  <div class="ft">${esc(nsMsg(lang, 'common', 'near_realtime') || '')} · ${rtl ? 'حُدّث: ' : 'actualisé : '}<span dir="ltr">${esc(updated)}</span></div>
</div>
</body></html>`;
  cache.set(key, { html, at: Date.now() });
  allowFraming(res);
  res.set('Cache-Control', 'public, max-age=300').type('html').send(html);
});

// Seule surface encapsulable du site : CSP dédiée, X-Frame-Options RETIRÉ
// (jamais une valeur vide — le retrait explicite est le seul comportement sûr).
function allowFraming(res) {
  res.set('Content-Security-Policy',
    "default-src 'none'; img-src https://kifeh.app data:; style-src 'unsafe-inline'; frame-ancestors *");
  res.removeHeader('X-Frame-Options');
}

// ── /presse : kit média ──────────────────────────────────────────────────────
widgetRouter.get('/presse', (req, res) => {
  const lang = req.query.lang === 'ar' ? 'ar' : 'fr';
  const rtl = lang === 'ar';
  const key = `p/${lang}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return res.set('Cache-Control', 'public, max-age=300').type('html').send(hit.html);
  }
  const g = (sql, ...p) => { try { return db.prepare(sql).get(...p); } catch { return null; } };
  const total = g(`SELECT COUNT(*) AS n FROM incidents WHERE status IN ('active','resolved','expired')`)?.n ?? 0;
  const det30 = g(`SELECT COUNT(*) AS n FROM satellite_detections WHERE acquired_at > datetime('now','-30 day')`)?.n ?? 0;
  const countries = (multiCountry() ? enabledCountries() : ['TN']).length;

  const snippet = (attrs) => esc(`<iframe src="${BASE}/widget?${attrs}"
  width="340" height="230" style="border:0" loading="lazy"
  title="Kifeh — situation en quasi temps réel"></iframe>`);

  const title = rtl ? 'كيفاه — الملف الصحفي وأدوات الإدماج' : 'Kifeh — kit média & widget';
  const html = `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${rtl ? 'كيفاه في سطور، أرقام حية، شعارات، ومقتطفات إدماج جاهزة.' : 'Kifeh en bref, chiffres vivants, logos et extraits d’intégration prêts à coller.'}">
<link rel="canonical" href="${BASE}/presse${lang === 'ar' ? '?lang=ar' : ''}">
<link rel="alternate" hreflang="fr" href="${BASE}/presse">
<link rel="alternate" hreflang="ar" href="${BASE}/presse?lang=ar">
<link rel="icon" href="/img/logo.svg" type="image/svg+xml">
<style>body{font-family:'IBM Plex Sans',-apple-system,sans-serif;background:#FAF7F1;color:#1E2A4D;line-height:1.65;margin:0}
main{max-width:680px;margin:0 auto;padding:1.25rem 1rem 3rem}h1{font-size:1.4rem}h2{font-size:1.05rem;margin-top:1.5rem}
.muted{color:#5C6B79;font-size:.85rem}.box{background:#fff;border:1px solid #E7E1D6;border-radius:14px;padding:1rem;margin:1rem 0}
pre{background:#1E2A4D;color:#fff;border-radius:12px;padding:.9rem;overflow-x:auto;font-size:.78rem;direction:ltr;text-align:left}
a{color:#1E2A4D}iframe{max-width:100%}</style>
</head>
<body><main>
<nav class="muted"><a href="/">Kifeh كيفاه</a> › ${rtl ? 'الملف الصحفي' : 'Kit média'}</nav>
<h1>${esc(title)}</h1>
<p>${rtl
    ? 'كيفاه منصة مدنية مفتوحة المصدر ومجانية وبدون حسابات: تجمع تبليغات المواطنين والأرصاد الفضائية والمصادر الرسمية حول الانقطاعات والحرائق، بالفرنسية والعربية، في تونس وفرنسا. البيانات تحمل دائمًا مصدرها ووقتها — شبه فوري، وليس بثًا مباشرًا.'
    : 'Kifeh est une plateforme civique open source, gratuite et sans compte : signalements citoyens, détections satellite et sources officielles autour des coupures et incendies, en français et en arabe, en Tunisie et en France. Chaque donnée porte sa source et son heure — du quasi temps réel, jamais du « direct ».'}</p>
<div class="box">
  <h2 style="margin-top:0">${rtl ? 'أرقام حية' : 'Chiffres vivants'}</h2>
  <p>${rtl
    ? `${total} تبليغًا منشورًا منذ الإطلاق · ${det30} رصدًا حراريًا خلال 30 يومًا · ${countries} بلدان مغطاة · لغتان (فرنسية وعربية RTL)`
    : `${total} signalements publiés depuis le lancement · ${det30} détections thermiques sur 30 jours · ${countries} pays couverts · 2 langues (français et arabe RTL)`}</p>
  <p class="muted">${rtl ? 'محدثة عند كل زيارة لهذه الصفحة.' : 'Actualisés à chaque visite de cette page.'}</p>
</div>
<h2>${rtl ? 'الودجة القابلة للإدماج' : 'Le widget embarquable'}</h2>
<p>${rtl
    ? 'بطاقة وضع مدمجة، بدون جافاسكريبت، تتحدث كل 10 دقائق — لبلدية أو جمعية أو وسيلة إعلام محلية. الصقوا المقتطف وحددوا المنطقة:'
    : 'Une carte de situation compacte, sans JavaScript, rafraîchie toutes les 10 minutes — pour une mairie, une association, un média local. Collez l’extrait, choisissez la zone :'}</p>
<div class="box">
  <p><strong>${rtl ? 'مثال — جيروند:' : 'Exemple — Gironde :'}</strong></p>
  <pre>${snippet('country=FR&lang=fr&zone=gironde')}</pre>
  <p><strong>${rtl ? 'مثال — تونس (بالعربية):' : 'Exemple — Tunis (en arabe) :'}</strong></p>
  <pre>${snippet('country=TN&lang=ar&zone=tunis')}</pre>
  <p><strong>${rtl ? 'حول نقطة (خط عرض/طول + نصف قطر):' : 'Autour d’un point (lat/lng + rayon) :'}</strong></p>
  <pre>${snippet('country=FR&lang=fr&lat=44.84&lng=-0.58&radiusKm=30')}</pre>
  <p class="muted">${rtl ? 'معاينة مباشرة:' : 'Aperçu en direct :'}</p>
  <iframe src="/widget?country=${lang === 'ar' ? 'TN&lang=ar&zone=tunis' : 'FR&lang=fr&zone=gironde'}" width="340" height="230" style="border:0" loading="lazy" title="Kifeh widget"></iframe>
</div>
<h2>${rtl ? 'الشعارات والأصول' : 'Logos et visuels'}</h2>
<p><a href="/img/logo.svg" download>logo.svg</a> · <a href="/img/icon-512.png" download>icon-512.png</a> · <a href="/img/og-image.png" download>og-image.png</a></p>
<p class="muted">${rtl ? 'الاسم يُكتب: Kifeh كيفاه. لا تعدّلوا الألوان.' : 'Le nom s’écrit : Kifeh كيفاه. Merci de ne pas altérer les couleurs.'}</p>
<h2>${rtl ? 'تواصل' : 'Contact'}</h2>
<p>${rtl ? 'عبر مستودع المشروع المفتوح:' : 'Via le dépôt open source :'} <a href="https://github.com/fch1/kifeh">github.com/fch1/kifeh</a></p>
<p class="muted">Kifeh كيفاه — ${esc(nsMsg(lang, 'common', 'tagline') || '')}</p>
</main></body></html>`;
  cache.set(key, { html, at: Date.now() });
  res.set('Cache-Control', 'public, max-age=300').type('html').send(html);
});
